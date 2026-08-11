import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  type AccountProfile,
  type AgentInstallation,
  type AgentProtocol,
  type AgentSession,
  CODEX_MODEL_SUGGESTIONS,
  isNativeModel,
  profileModel,
  profileServes,
  type McpProfile,
  type ModelProfile,
  type NativeAgentType,
} from '../core/models/agent.models';
import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { IconComponent } from '../shared/icon/icon';

export interface ResumeSessionValue {
  session: AgentSession;
  profileId?: string;
  mcpProfileId?: string;
  accountProfileId?: string;
  model?: string;
}

/** Profiles a previous run of a session used, or null when it never ran here. */
export type SessionLaunchProfiles = {
  profileId?: string;
  mcpProfileId?: string;
  accountProfileId?: string;
} | null;

type SessionAgentFilter = 'all' | NativeAgentType;

/** Health strip entries, in the order the agents are presented throughout the app. */
const AGENT_HEALTH_ENTRIES: readonly { agentType: NativeAgentType; name: string }[] = [
  { agentType: 'claude', name: 'Claude Code' },
  { agentType: 'codex', name: 'Codex CLI' },
];

const AGENT_FILTERS: readonly {
  value: SessionAgentFilter;
}[] = [{ value: 'all' }, { value: 'claude' }, { value: 'codex' }];

@Component({
  selector: 'app-session-center-dialog',
  imports: [DatePipe, FormsModule, IconComponent, TranslatePipe],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancelled.emit()">
      <section
        class="agent-dialog session-center modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-center-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div class="dialog-title">
            <span class="title-icon"><app-icon name="history" [size]="17" /></span>
            <div>
              <h2 id="session-center-title">{{ 'session.title' | t }}</h2>
              <p>
                {{
                  'session.summary'
                    | t
                      : {
                          count: sessions().length,
                          scope: onlyWorkspace()
                            ? ('session.currentWorkspace' | t)
                            : ('session.allProjects' | t),
                        }
                }}
              </p>
            </div>
          </div>
          <button
            type="button"
            class="btn btn-square btn-ghost btn-sm"
            [title]="'common.close' | t"
            [attr.aria-label]="'common.close' | t"
            (click)="cancelled.emit()"
          >
            <app-icon name="x" [size]="15" />
          </button>
        </header>

        <div class="agent-health-strip" [attr.aria-label]="'session.connectionStatus' | t">
          @for (health of agentHealth(); track health.agentType) {
            <article
              class="agent-health"
              [attr.data-agent]="health.agentType"
              [class.unavailable]="!health.installation?.healthy"
            >
              <span class="agent-health-icon">
                <app-icon [name]="health.agentType === 'codex' ? 'terminal' : 'bot'" [size]="13" />
              </span>
              <strong>{{ health.name }}</strong>
              <code [title]="health.installation?.diagnostic ?? ''">
                {{ health.installation?.version ?? ('common.notConnected' | t) }}
              </code>
            </article>
          }
        </div>

        <div class="session-toolbar">
          <label class="dialog-search input input-bordered input-sm">
            <app-icon name="search" [size]="14" />
            <input
              type="search"
              [placeholder]="'session.searchPlaceholder' | t"
              [attr.aria-label]="'session.searchAria' | t"
              [ngModel]="search()"
              (ngModelChange)="search.set($event)"
            />
            @if (search()) {
              <button
                type="button"
                class="search-clear"
                [title]="'common.clearSearch' | t"
                [attr.aria-label]="'common.clearSearch' | t"
                (click)="search.set('')"
              >
                <app-icon name="x" [size]="11" />
              </button>
            }
          </label>
          <nav
            class="session-agent-filter"
            role="tablist"
            [attr.aria-label]="'session.filterAria' | t"
          >
            @for (filter of agentFilters; track filter.value) {
              <button
                type="button"
                role="tab"
                class="tab"
                [class.active]="agentFilter() === filter.value"
                [attr.aria-selected]="agentFilter() === filter.value"
                (click)="agentFilter.set(filter.value)"
              >
                {{ filterLabel(filter.value) }}
                <span>{{ countFor(filter.value) }}</span>
              </button>
            }
          </nav>
          <label class="scope-control">
            <input
              type="checkbox"
              [ngModel]="onlyWorkspace()"
              (ngModelChange)="onlyWorkspace.set($event); refresh()"
            />
            <span>{{ 'session.onlyWorkspace' | t }}</span>
          </label>
          <button
            type="button"
            class="icon-action"
            [class.spinning]="busy()"
            [title]="'session.rescan' | t"
            [attr.aria-label]="'session.rescan' | t"
            [disabled]="busy()"
            (click)="refresh()"
          >
            <app-icon name="refresh" [size]="14" />
          </button>
        </div>

        @if (error()) {
          <div class="session-error alert alert-error" role="alert">
            <app-icon name="shield" [size]="14" />
            <span>{{ error() }}</span>
            <button type="button" [disabled]="busy()" (click)="refresh()">
              {{ 'common.retry' | t }}
            </button>
          </div>
        }

        @if (showsClaudeOptions() || showsCodexOptions()) {
          <div class="resume-config" [class.expanded]="optionsExpanded()">
            <button
              type="button"
              class="resume-config-toggle"
              [attr.aria-expanded]="optionsExpanded()"
              aria-controls="resume-config-panel"
              (click)="optionsExpanded.set(!optionsExpanded())"
            >
              <app-icon name="settings" [size]="13" />
              <strong>{{ 'session.resumeConfig' | t }}</strong>
              <small>{{ configSummary() }}</small>
              <app-icon class="resume-config-chevron" name="chevron-down" [size]="13" />
            </button>

            @if (optionsExpanded()) {
              <div id="resume-config-panel" class="resume-config-panel">
                @if (showsClaudeOptions()) {
                  <section class="resume-options">
                    <h3>
                      <span class="session-agent" data-agent="claude">
                        <app-icon name="bot" [size]="13" />
                      </span>
                      <span>
                        <strong>{{ 'session.claudeResumeConfig' | t }}</strong>
                        <small>{{ 'session.claudeResumeHelp' | t }}</small>
                      </span>
                    </h3>
                    <label>
                      <span>{{ 'launch.modelProfile' | t }}</span>
                      <select
                        [ngModel]="resolvedProfileId()"
                        (ngModelChange)="profileId.set($event)"
                      >
                        @for (profile of anthropicProfiles(); track profile.id) {
                          <option [value]="profile.id">{{ profileLabel(profile, 'claude') }}</option>
                        }
                      </select>
                    </label>
                    <label>
                      <span>{{ 'launch.mcpProfile' | t }}</span>
                      <select [ngModel]="mcpProfileId()" (ngModelChange)="mcpProfileId.set($event)">
                        <option value="">{{ 'session.claudeDefault' | t }}</option>
                        @for (profile of mcpProfiles(); track profile.id) {
                          <option [value]="profile.id">{{ profile.name }}</option>
                        }
                      </select>
                    </label>
                    <label>
                      <span>Claude {{ 'launch.loginAccount' | t }}</span>
                      <select
                        [ngModel]="resolvedClaudeAccountProfileId()"
                        (ngModelChange)="claudeAccountProfileId.set($event)"
                      >
                        @for (profile of claudeAccounts(); track profile.id) {
                          <option [value]="profile.id">{{ accountLabel(profile) }}</option>
                        }
                      </select>
                    </label>
                  </section>
                }

                @if (showsCodexOptions()) {
                  <section class="resume-options">
                    <h3>
                      <span class="session-agent" data-agent="codex">
                        <app-icon name="terminal" [size]="13" />
                      </span>
                      <span>
                        <strong>{{ 'session.codexResumeConfig' | t }}</strong>
                        <small>{{ 'session.codexResumeHelp' | t }}</small>
                      </span>
                    </h3>
                    <label>
                      <span>{{ 'launch.modelProfile' | t }}</span>
                      <select
                        [ngModel]="resolvedCodexProfileId()"
                        (ngModelChange)="codexProfileId.set($event)"
                      >
                        @for (profile of openaiProfiles(); track profile.id) {
                          <option [value]="profile.id">{{ profileLabel(profile, 'codex') }}</option>
                        }
                      </select>
                    </label>
                    <label>
                      <span>{{ 'launch.chatgptAccount' | t }}</span>
                      <select
                        [ngModel]="resolvedCodexAccountProfileId()"
                        (ngModelChange)="codexAccountProfileId.set($event)"
                      >
                        @for (profile of codexAccounts(); track profile.id) {
                          <option [value]="profile.id">{{ accountLabel(profile) }}</option>
                        }
                      </select>
                    </label>
                    <label>
                      <span>{{ 'launch.codexModel' | t }}</span>
                      <input
                        type="text"
                        list="resume-codex-model-suggestions"
                        [placeholder]="'session.codexModelPlaceholder' | t"
                        [attr.aria-label]="'session.codexModelAria' | t"
                        [ngModel]="codexModel()"
                        (ngModelChange)="codexModel.set($event)"
                      />
                      <datalist id="resume-codex-model-suggestions">
                        @for (suggestion of codexModelSuggestions; track suggestion) {
                          <option [value]="suggestion"></option>
                        }
                      </datalist>
                    </label>
                  </section>
                }
              </div>
            }
          </div>
        }

        <div class="session-list" [attr.aria-busy]="busy()">
          @if (busy() && sessions().length === 0) {
            <div class="session-loading">
              <app-icon name="refresh" [size]="18" />
              <strong>{{ 'session.scanning' | t }}</strong>
              <span>{{ 'session.scanningHelp' | t }}</span>
            </div>
          } @else {
            @for (session of filteredSessions(); track session.id) {
              <article class="session-row" [attr.data-agent]="session.agentType">
                <span class="session-agent" [attr.data-agent]="session.agentType">
                  <app-icon name="bot" [size]="15" />
                </span>
                <div class="session-copy">
                  <strong [title]="session.title">{{ session.title }}</strong>
                  <small [title]="session.projectPath ?? ('common.unknownProject' | t)">
                    {{ session.projectPath ?? ('common.unknownProject' | t) }}
                  </small>
                  <div class="session-metadata">
                    <span class="agent-tag" [attr.data-agent]="session.agentType">
                      {{ agentLabel(session) }}
                    </span>
                    <span class="session-branch">{{
                      session.branch ?? ('common.noBranch' | t)
                    }}</span>
                    <span>{{ session.modelName ?? ('common.defaultModel' | t) }}</span>
                    <span>{{ 'common.messages' | t: { count: session.messageCount } }}</span>
                    <span class="session-id" [title]="session.nativeSessionId">
                      {{ shortSessionId(session) }}
                    </span>
                  </div>
                </div>
                <time
                  [attr.datetime]="sessionDateTime(session)"
                  [title]="session.lastUsedAt | date: 'yyyy-MM-dd HH:mm:ss'"
                >
                  {{ session.lastUsedAt | date: 'MM-dd HH:mm' }}
                </time>
                <button
                  type="button"
                  class="resume-button"
                  [disabled]="busy() || !installationFor(session)?.healthy"
                  [title]="
                    installationFor(session)?.healthy
                      ? ('session.resumeThis' | t)
                      : ('session.agentUnavailable' | t: { agent: agentLabel(session) })
                  "
                  (click)="resume(session)"
                >
                  <app-icon name="play" [size]="12" />
                  {{
                    installationFor(session)?.healthy
                      ? ('terminal.resume' | t)
                      : ('common.unavailable' | t)
                  }}
                </button>
              </article>
            } @empty {
              <div class="dialog-empty">
                <app-icon name="history" [size]="22" />
                <strong>{{ emptyTitle() }}</strong>
                <span>{{ emptyDescription() }}</span>
                @if (search()) {
                  <button type="button" class="secondary" (click)="search.set('')">
                    {{ 'common.clearSearch' | t }}
                  </button>
                }
              </div>
            }
          }
        </div>

        <footer class="session-footer">
          <span class="session-result-count">
            {{
              'session.resultCount'
                | t: { visible: filteredSessions().length, total: sessions().length }
            }}
          </span>
          <span class="session-read-only">{{ 'session.readOnly' | t }}</span>
          <button type="button" class="secondary" (click)="cancelled.emit()">
            {{ 'common.close' | t }}
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrl: './agent-dialog.scss',
})
export class SessionCenterDialogComponent {
  private readonly i18n = inject(I18nService);
  readonly installation = input<AgentInstallation | null>(null);
  readonly codexInstallation = input<AgentInstallation | null>(null);
  readonly sessions = input<AgentSession[]>([]);
  readonly profiles = input<ModelProfile[]>([]);
  readonly mcpProfiles = input<McpProfile[]>([]);
  readonly accountProfiles = input<AccountProfile[]>([]);
  readonly projectPath = input('');
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  /** Resolves the profiles a session last ran with, so resuming keeps them. */
  readonly sessionLaunchProfiles = input<(nativeSessionId: string) => SessionLaunchProfiles>(
    () => null,
  );
  readonly refreshed = output<string | undefined>();
  readonly resumed = output<ResumeSessionValue>();
  readonly cancelled = output<void>();

  protected readonly search = signal('');
  protected readonly onlyWorkspace = signal(true);
  protected readonly agentFilter = signal<SessionAgentFilter>('all');
  protected readonly optionsExpanded = signal(false);
  protected readonly codexModelSuggestions = CODEX_MODEL_SUGGESTIONS;
  protected readonly profileId = signal('');
  protected readonly mcpProfileId = signal('');
  protected readonly claudeAccountProfileId = signal('');
  protected readonly anthropicProfiles = computed(() =>
    this.profiles().filter((profile) => profileServes(profile, 'claude')),
  );
  protected readonly openaiProfiles = computed(() =>
    this.profiles().filter((profile) => profileServes(profile, 'codex')),
  );
  protected readonly codexAccountProfileId = signal('');
  protected readonly codexProfileId = signal('');
  protected readonly codexModel = signal('');
  protected readonly agentFilters = AGENT_FILTERS;
  protected readonly agentHealth = computed(() =>
    AGENT_HEALTH_ENTRIES.map((entry) => ({
      ...entry,
      installation: entry.agentType === 'codex' ? this.codexInstallation() : this.installation(),
    })),
  );
  protected readonly sessionCounts = computed(() => {
    const sessions = this.sessions();
    return {
      all: sessions.length,
      claude: sessions.filter((session) => session.agentType === 'claude').length,
      codex: sessions.filter((session) => session.agentType === 'codex').length,
    };
  });
  protected readonly resolvedProfileId = computed(
    () =>
      this.profileId() ||
      this.anthropicProfiles().find((profile) => profile.isDefault)?.id ||
      this.anthropicProfiles()[0]?.id ||
      '',
  );
  protected readonly claudeAccounts = computed(() =>
    this.accountProfiles().filter((profile) => profile.agentType === 'claude'),
  );
  protected readonly codexAccounts = computed(() =>
    this.accountProfiles().filter((profile) => profile.agentType === 'codex'),
  );
  protected readonly resolvedClaudeAccountProfileId = computed(
    () =>
      this.claudeAccountProfileId() ||
      this.claudeAccounts().find((profile) => profile.isDefault)?.id ||
      this.claudeAccounts()[0]?.id ||
      '',
  );
  protected readonly resolvedCodexAccountProfileId = computed(
    () =>
      this.codexAccountProfileId() ||
      this.codexAccounts().find((profile) => profile.isDefault)?.id ||
      this.codexAccounts()[0]?.id ||
      '',
  );
  protected readonly resolvedCodexProfileId = computed(
    () =>
      this.codexProfileId() ||
      this.openaiProfiles().find((profile) => profile.isDefault)?.id ||
      this.openaiProfiles()[0]?.id ||
      '',
  );
  protected readonly filteredSessions = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    const agentFilter = this.agentFilter();
    return this.sessions().filter((session) => {
      if (agentFilter !== 'all' && session.agentType !== agentFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [
        session.title,
        session.projectPath,
        session.branch,
        session.modelName,
        session.nativeSessionId,
        this.agentLabel(session),
      ]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(query));
    });
  });
  protected readonly showsClaudeOptions = computed(
    () => this.agentFilter() !== 'codex' && this.sessionCounts().claude > 0,
  );
  protected readonly showsCodexOptions = computed(
    () => this.agentFilter() !== 'claude' && this.sessionCounts().codex > 0,
  );
  /** Keeps the active model profiles visible while the configuration panel is collapsed. */
  protected readonly configSummary = computed(() => {
    const nameOf = (profiles: ModelProfile[], id: string) =>
      profiles.find((profile) => profile.id === id)?.name ?? '';
    const names: string[] = [];
    if (this.showsClaudeOptions()) {
      names.push(nameOf(this.anthropicProfiles(), this.resolvedProfileId()));
    }
    if (this.showsCodexOptions()) {
      names.push(
        this.codexModel().trim() || nameOf(this.openaiProfiles(), this.resolvedCodexProfileId()),
      );
    }
    return names.filter(Boolean).join(' · ');
  });
  protected readonly emptyTitle = computed(() => {
    if (this.search().trim()) {
      return this.i18n.t('session.noMatch');
    }
    if (this.agentFilter() === 'claude') {
      return this.i18n.t('session.noClaude');
    }
    if (this.agentFilter() === 'codex') {
      return this.i18n.t('session.noCodex');
    }
    return this.i18n.t(this.onlyWorkspace() ? 'session.noWorkspace' : 'session.noLocal');
  });
  protected readonly emptyDescription = computed(() =>
    this.search().trim()
      ? this.i18n.t('session.tryFilters')
      : this.onlyWorkspace()
        ? this.i18n.t('session.showOtherProjects')
        : this.i18n.t('session.verifyCli'),
  );

  protected filterLabel(filter: SessionAgentFilter): string {
    return filter === 'all'
      ? this.i18n.t('session.filterAll')
      : filter === 'claude'
        ? 'Claude'
        : 'Codex';
  }

  protected countFor(filter: SessionAgentFilter): number {
    return this.sessionCounts()[filter];
  }

  protected refresh(): void {
    this.refreshed.emit(this.onlyWorkspace() ? this.projectPath() : undefined);
  }

  /**
   * Resumes with the profiles the session last ran with, so a third-party model
   * survives a restart. An explicit pick in the settings panel overrides them.
   */
  protected resume(session: AgentSession): void {
    const isClaude = session.agentType === 'claude';
    const previous = this.sessionLaunchProfiles()(session.nativeSessionId);
    const picked = isClaude ? this.profileId() : this.codexProfileId();
    const fallback = isClaude ? this.resolvedProfileId() : this.resolvedCodexProfileId();
    this.resumed.emit({
      session,
      profileId: picked || previous?.profileId || fallback || undefined,
      mcpProfileId: isClaude ? this.mcpProfileId() || previous?.mcpProfileId : undefined,
      accountProfileId:
        session.accountProfileId ||
        previous?.accountProfileId ||
        (isClaude ? this.resolvedClaudeAccountProfileId() : this.resolvedCodexAccountProfileId()) ||
        undefined,
      model: isClaude ? undefined : this.codexModel().trim() || session.modelName || undefined,
    });
  }

  protected installationFor(session: AgentSession): AgentInstallation | null {
    return session.agentType === 'codex' ? this.codexInstallation() : this.installation();
  }

  protected agentLabel(session: AgentSession): string {
    return (
      AGENT_HEALTH_ENTRIES.find((entry) => entry.agentType === session.agentType)?.name ??
      session.agentType
    );
  }

  protected shortSessionId(session: AgentSession): string {
    return session.nativeSessionId.slice(0, 8);
  }

  protected sessionDateTime(session: AgentSession): string {
    return new Date(session.lastUsedAt).toISOString();
  }

  /** Model profiles read as "name · model", with native profiles called out. */
  protected profileLabel(profile: ModelProfile, agent: AgentProtocol): string {
    const model = profileModel(profile, agent);
    const base = profile.name === model ? profile.name : `${profile.name} · ${model}`;
    return isNativeModel(profile, agent) ? `${base} (${this.i18n.t('settings.nativeModel')})` : base;
  }

  protected accountLabel(profile: AccountProfile): string {
    const state = profile.authenticated ? 'common.authenticated' : 'common.unauthenticated';
    return `${profile.name} · ${this.i18n.t(state)}`;
  }
}
