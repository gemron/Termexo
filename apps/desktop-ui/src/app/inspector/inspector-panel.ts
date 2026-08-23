import { Component, computed, inject, input, output, signal } from '@angular/core';

import {
  AgentEvent,
  isNativeModel,
  ModelProfile,
  ProviderQuota,
  QuotaEntry,
} from '../core/models/agent.models';
import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  AGENT_LABELS,
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
  readonly refreshQuotas = output<void>();
  protected readonly showAllQuotas = signal(false);

  /**
   * Shows only the allowance sources used by the active terminal unless the user explicitly asks
   * for the complete list. Model profiles and signed-in Agent accounts have separate readings.
   */
  protected readonly quotaRows = computed(() => {
    const thresholds = new Map(
      this.modelProfiles().map((profile) => [
        profile.id,
        profile.planAlertThreshold ?? DEFAULT_ALERT_THRESHOLD,
      ]),
    );
    const terminal = this.activeTerminal();
    const activeProfile = terminal?.profileId
      ? this.modelProfiles().find((profile) => profile.id === terminal.profileId)
      : undefined;
    const currentQuotaIds = new Set<string>();
    if (
      terminal &&
      (terminal.agentType === 'claude' || terminal.agentType === 'codex') &&
      activeProfile
    ) {
      if (isNativeModel(activeProfile, terminal.agentType)) {
        // Official models spend the subscription belonging to the login account selected for this
        // terminal, not an API-key allowance attached to the model profile.
        if (terminal.accountProfileId) {
          currentQuotaIds.add(`agent:${terminal.accountProfileId}`);
        }
      } else if (terminal.profileId) {
        // Compatibility providers authenticate with the model profile's own API key.
        currentQuotaIds.add(terminal.profileId);
      }
    } else {
      // Keep restored legacy terminals useful when their old model profile no longer exists.
      if (terminal?.profileId) {
        currentQuotaIds.add(terminal.profileId);
      }
      if (terminal?.accountProfileId) {
        currentQuotaIds.add(`agent:${terminal.accountProfileId}`);
      }
    }
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

  protected toggleQuotaScope(): void {
    this.showAllQuotas.update((showAll) => !showAll);
  }

  protected readonly recentEvents = computed(() => {
    const terminalId = this.activeTerminal()?.id;
    return this.events()
      .filter((event) => !terminalId || event.terminalId === terminalId)
      .slice(0, 12);
  });

  protected readonly agentLabels = AGENT_LABELS;

  protected eventLabel(event: AgentEvent): string {
    return this.i18n.t(EVENT_LABELS[event.eventType] ?? 'event.updated');
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

  protected resetLabel(timestamp?: number): string {
    if (!timestamp) return '';
    const remaining = timestamp - Date.now();
    if (remaining <= 0) return this.i18n.t('quota.resetDue');
    const hours = Math.ceil(remaining / 3_600_000);
    return hours < 48
      ? this.i18n.t('quota.resetHours', { count: hours })
      : this.i18n.t('quota.resetDays', { count: Math.ceil(hours / 24) });
  }

  protected checkedLabel(timestamp: number): string {
    return this.i18n.formatTime(timestamp);
  }
}
