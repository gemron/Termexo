import { Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';

import {
  AccountProfile,
  AgentEvent,
  isNativeModel,
  ModelProfile,
  ProviderQuota,
  QuotaEntry,
  terminalAccountName,
} from '../core/models/agent.models';
import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { RepositoryOverview, repositoryChangeStatus } from '../core/models/git.models';
import {
  AGENT_LABELS,
  type AgentType,
  TerminalSession,
  TerminalStatus,
  Workspace,
} from '../core/models/workspace.models';
import { IconComponent } from '../shared/icon/icon';

const EVENT_LABELS: Readonly<Record<string, string>> = {
  'session.started': 'event.sessionStarted',
  'agent.thinking': 'event.agentThinking',
  'tool.started': 'event.toolStarted',
  'tool.completed': 'event.toolCompleted',
  'tool.failed': 'event.toolFailed',
  'approval.required': 'event.approvalRequired',
  'user.input.required': 'event.inputRequired',
  'agent.rate_limited': 'event.rateLimited',
  'agent.timeout': 'event.timeout',
  'task.completed': 'event.taskCompleted',
  'agent.failed': 'event.agentFailed',
  'session.ended': 'event.sessionEnded',
};

/** Matches the backend default for a profile that has never had a threshold set. */
const DEFAULT_ALERT_THRESHOLD = 80;

/** The collapsible sections below the overview; the overview itself is always open. */
type SectionKey = 'agents' | 'details' | 'changes' | 'quota' | 'activity';

/** What opens on a first run: the code changes, since that is what a working Agent produces. */
const DEFAULT_SECTIONS: Record<SectionKey, boolean> = {
  agents: false,
  details: false,
  changes: true,
  quota: false,
  activity: false,
};

/** Statuses that count an Agent as working, for the "running" figure in the overview. */
const ACTIVE_STATUSES: readonly TerminalStatus[] = [
  'STARTING',
  'RUNNING',
  'THINKING',
  'WAITING_INPUT',
  'WAITING_APPROVAL',
];

const SECTION_STATE_KEY = 'termexo.inspector.sections.v1';

/** Reads the remembered open/closed state, falling back to the defaults for anything missing. */
function readStoredSections(): Record<SectionKey, boolean> {
  try {
    const raw = window.localStorage.getItem(SECTION_STATE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') {
      return { ...DEFAULT_SECTIONS, ...(parsed as Partial<Record<SectionKey, boolean>>) };
    }
  } catch {
    // A restricted or corrupt store only costs the remembered layout, not the panel.
  }
  return { ...DEFAULT_SECTIONS };
}

const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const DAY_MINUTES = 24 * HOUR_MINUTES;
/** Keeps the minute-precision countdown honest without re-rendering every second. */
const COUNTDOWN_TICK_MS = 20_000;

@Component({
  selector: 'app-inspector-panel',
  imports: [IconComponent, TranslatePipe],
  templateUrl: './inspector-panel.html',
  styleUrl: './inspector-panel.scss',
})
export class InspectorPanelComponent {
  private readonly i18n = inject(I18nService);
  readonly workspace = input<Workspace | null>(null);
  readonly activeTerminal = input<TerminalSession | null>(null);
  readonly events = input<AgentEvent[]>([]);
  readonly quotas = input<ProviderQuota[]>([]);
  readonly quotaLoading = input(false);
  readonly modelProfiles = input<ModelProfile[]>([]);
  readonly accountProfiles = input<AccountProfile[]>([]);
  readonly repository = input<RepositoryOverview | null>(null);
  readonly refreshQuotas = output<void>();
  readonly gitRequested = output<void>();
  readonly collapseRequested = output<void>();
  protected readonly showAllQuotas = signal(false);
  /** Empty for a plain shell or OpenCode, which run on no account of their own. */
  protected readonly activeAccountName = computed(() => {
    const terminal = this.activeTerminal();
    return terminal
      ? terminalAccountName(this.accountProfiles(), terminal.agentType, terminal.accountProfileId)
      : '';
  });
  /** Drives the reset countdown so a panel left open does not keep showing a stale minute. */
  private readonly now = signal(Date.now());

  constructor() {
    const ticker = setInterval(() => this.now.set(Date.now()), COUNTDOWN_TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(ticker));
  }

  /**
   * Shows only the allowance sources used by the active terminal unless the user explicitly asks
   * for the complete list. Model profiles and signed-in Agent accounts have separate readings.
   */
  /** Alert thresholds by profile id, so a reading can be judged against the profile that owns it. */
  private readonly thresholds = computed(
    () =>
      new Map(
        this.modelProfiles().map((profile) => [
          profile.id,
          profile.planAlertThreshold ?? DEFAULT_ALERT_THRESHOLD,
        ]),
      ),
  );

  /** The allowance sources the active terminal actually spends, used to scope the current view. */
  private readonly currentQuotaIds = computed<Set<string>>(() => {
    const terminal = this.activeTerminal();
    const ids = new Set<string>();
    if (!terminal) {
      return ids;
    }
    const activeProfile = terminal.profileId
      ? this.modelProfiles().find((profile) => profile.id === terminal.profileId)
      : undefined;
    if ((terminal.agentType === 'claude' || terminal.agentType === 'codex') && activeProfile) {
      if (isNativeModel(activeProfile, terminal.agentType)) {
        // Official models spend the subscription belonging to the login account selected for this
        // terminal, not an API-key allowance attached to the model profile.
        if (terminal.accountProfileId) {
          ids.add(`agent:${terminal.accountProfileId}`);
        }
      } else if (terminal.profileId) {
        // Compatibility providers authenticate with the model profile's own API key.
        ids.add(terminal.profileId);
      }
    } else {
      // Keep restored legacy terminals useful when their old model profile no longer exists.
      if (terminal.profileId) {
        ids.add(terminal.profileId);
      }
      if (terminal.accountProfileId) {
        ids.add(`agent:${terminal.accountProfileId}`);
      }
    }
    return ids;
  });

  /**
   * Shows only the allowance sources used by the active terminal unless the user explicitly asks
   * for the complete list. Model profiles and signed-in Agent accounts have separate readings.
   */
  protected readonly quotaRows = computed(() => {
    const thresholds = this.thresholds();
    const currentQuotaIds = this.currentQuotaIds();
    const quotas = this.showAllQuotas()
      ? this.quotas()
      : this.quotas().filter((quota) => currentQuotaIds.has(quota.profileId));

    return quotas.map((quota) => {
      const threshold = thresholds.get(quota.profileId) ?? DEFAULT_ALERT_THRESHOLD;
      return {
        quota,
        entries: quota.entries.map((entry) => ({
          entry,
          alerting: entry.percent !== undefined && entry.percent >= threshold,
        })),
      };
    });
  });

  /**
   * The tightest allowance the active terminal spends, for the overview headline.
   *
   * Always scoped to the current terminal regardless of the "show all" toggle: the headline is
   * about what this session is running on. `percent` is consumption, so the lowest remaining is
   * the highest used, and that is the one worth surfacing.
   */
  protected readonly overviewQuota = computed<{ remaining: number; alerting: boolean } | null>(
    () => {
      const ids = this.currentQuotaIds();
      const thresholds = this.thresholds();
      let worst: { remaining: number; alerting: boolean } | null = null;
      for (const quota of this.quotas()) {
        if (!ids.has(quota.profileId)) {
          continue;
        }
        const threshold = thresholds.get(quota.profileId) ?? DEFAULT_ALERT_THRESHOLD;
        for (const entry of quota.entries) {
          if (entry.percent === undefined) {
            continue;
          }
          const remaining = Math.max(0, Math.round(100 - entry.percent));
          if (worst === null || remaining < worst.remaining) {
            worst = { remaining, alerting: entry.percent >= threshold };
          }
        }
      }
      return worst;
    },
  );

  /** Agents actively working right now, for the overview figure; a plain shell is not counted. */
  protected readonly runningAgentCount = computed(
    () =>
      (this.workspace()?.terminals ?? []).filter(
        (terminal) => terminal.agentType !== 'shell' && ACTIVE_STATUSES.includes(terminal.status),
      ).length,
  );

  protected readonly changeCount = computed(() => this.repository()?.changes.length ?? 0);

  /** The branch shown in the overview: the repository's when known, else the terminal's record. */
  protected readonly overviewBranch = computed(
    () => this.repository()?.branch || this.activeTerminal()?.branch || '',
  );

  /** Which collapsible sections are open; seeded from the last visit and remembered on change. */
  protected readonly sections = signal<Record<SectionKey, boolean>>(readStoredSections());

  protected isOpen(key: SectionKey): boolean {
    return this.sections()[key];
  }

  protected toggleSection(key: SectionKey): void {
    this.setSection(key, !this.sections()[key]);
  }

  /** Opens a section without closing it if it was already open; used by the overview shortcuts. */
  protected openSection(key: SectionKey): void {
    if (!this.sections()[key]) {
      this.setSection(key, true);
    }
  }

  private setSection(key: SectionKey, open: boolean): void {
    const next = { ...this.sections(), [key]: open };
    this.sections.set(next);
    try {
      window.localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(next));
    } catch {
      // The choice simply will not survive a restart when storage is unavailable.
    }
  }

  protected toggleQuotaScope(): void {
    this.showAllQuotas.update((showAll) => !showAll);
  }

  protected readonly recentEvents = computed(() => {
    const terminalId = this.activeTerminal()?.id;
    return this.events()
      .filter((event) => !terminalId || event.terminalId === terminalId)
      .slice(0, 12);
  });
  protected readonly recentCodeChanges = computed(
    () => this.repository()?.changes.slice(0, 8) ?? [],
  );
  protected readonly repositoryChangeStatus = repositoryChangeStatus;

  protected readonly agentLabels = AGENT_LABELS;

  /** OpenCode and a plain shell are terminal-shaped; only the two hosted Agents get the bot mark. */
  protected agentIcon(agentType: AgentType): string {
    return agentType === 'claude' || agentType === 'codex' ? 'bot' : 'terminal';
  }

  protected eventLabel(event: AgentEvent): string {
    return this.i18n.t(EVENT_LABELS[event.eventType] ?? 'event.updated', {
      name: AGENT_LABELS[event.agentType],
    });
  }

  protected statusLabel(status: TerminalStatus): string {
    const keys: Record<TerminalStatus, string> = {
      STARTING: 'status.starting',
      RUNNING: 'status.running',
      THINKING: 'status.thinking',
      WAITING_INPUT: 'status.waitingInput',
      WAITING_APPROVAL: 'status.waitingApproval',
      RATE_LIMITED: 'status.rateLimited',
      IDLE: 'status.idle',
      COMPLETED: 'status.completed',
      FAILED: 'status.failed',
      STOPPED: 'status.stopped',
      DISCONNECTED: 'status.disconnected',
    };
    return this.i18n.t(keys[status]);
  }

  protected eventDetail(event: AgentEvent): string {
    const detail = event.detail;
    return String(
      detail['tool_name'] ??
        detail['notification_type'] ??
        detail['error_details'] ??
        detail['error'] ??
        detail['message'] ??
        detail['source'] ??
        event.nativeSessionId ??
        AGENT_LABELS[event.agentType],
    );
  }

  protected eventTime(event: AgentEvent): string {
    return this.i18n.formatTime(event.createdAt);
  }

  protected formatTokens(value: number): string {
    return new Intl.NumberFormat(this.i18n.activeLanguage(), {
      notation: value >= 10_000 ? 'compact' : 'standard',
      maximumFractionDigits: 1,
    }).format(value);
  }

  /** Renders an amount in whichever unit the provider charges against. */
  protected formatAmount(entry: QuotaEntry, value?: number): string {
    // Subscriptions report only a share, so what is left is the inverse of what was consumed.
    if (entry.unit === 'percent') {
      return entry.percent === undefined ? '—' : `${Math.round(100 - entry.percent)}%`;
    }
    if (value === undefined) {
      return '—';
    }
    if (entry.unit !== 'currency') {
      return this.formatTokens(value);
    }
    try {
      return new Intl.NumberFormat(this.i18n.activeLanguage(), {
        style: 'currency',
        currency: entry.currency ?? 'USD',
      }).format(value);
    } catch {
      // A provider is free to report a currency code Intl does not know.
      return `${this.formatTokens(value)} ${entry.currency ?? ''}`.trim();
    }
  }

  /** Counts down to the minute; providers publish reset moments that are minutes apart. */
  protected resetLabel(timestamp?: number): string {
    if (!timestamp) return '';
    const remaining = timestamp - this.now();
    if (remaining <= 0) return this.i18n.t('quota.resetDue');
    // Whole minutes elapsed, so the reading never overstates what is left; a final partial
    // minute still shows as one rather than collapsing to zero.
    const totalMinutes = Math.max(1, Math.floor(remaining / MINUTE_MS));
    const minutes = totalMinutes % HOUR_MINUTES;
    if (totalMinutes < HOUR_MINUTES) {
      return this.i18n.t('quota.resetMinutes', { minutes: totalMinutes });
    }
    if (totalMinutes < DAY_MINUTES) {
      return this.i18n.t('quota.resetHoursMinutes', {
        hours: Math.floor(totalMinutes / HOUR_MINUTES),
        minutes,
      });
    }
    return this.i18n.t('quota.resetDaysHoursMinutes', {
      days: Math.floor(totalMinutes / DAY_MINUTES),
      hours: Math.floor((totalMinutes % DAY_MINUTES) / HOUR_MINUTES),
      minutes,
    });
  }

  /** The countdown is relative, so the tooltip pins the exact moment it refers to. */
  protected resetTooltip(timestamp?: number): string {
    if (!timestamp) return '';
    return this.i18n.t('quota.resetAt', { time: this.i18n.formatDateTime(timestamp) });
  }

  protected usedLabel(percent: number): string {
    return this.i18n.t('quota.used', { percent: Math.round(percent) });
  }

  /** Providers occasionally report an overage, which must not overflow the meter track. */
  protected meterValue(percent: number): number {
    return Math.min(100, Math.max(0, Math.round(percent)));
  }

  protected checkedLabel(timestamp: number): string {
    return this.i18n.formatTime(timestamp);
  }
}
