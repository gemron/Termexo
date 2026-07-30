import { DatePipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  type AccountProfile,
  type AgentInstallation,
  type AgentSession,
  type McpProfile,
  type ModelProfile,
  type NativeAgentType,
} from '../core/models/agent.models';
import { IconComponent } from '../shared/icon/icon';

export interface ResumeSessionValue {
  session: AgentSession;
  profileId?: string;
  mcpProfileId?: string;
  accountProfileId?: string;
  model?: string;
}

type SessionAgentFilter = 'all' | NativeAgentType;

const AGENT_FILTERS: readonly {
  value: SessionAgentFilter;
  label: string;
}[] = [
  { value: 'all', label: '全部' },
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
];

@Component({
  selector: 'app-session-center-dialog',
  imports: [DatePipe, FormsModule, IconComponent],
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
              <h2 id="session-center-title">Agent 会话中心</h2>
              <p>
                {{ sessions().length }} 个本地会话 ·
                {{ onlyWorkspace() ? '当前工作区' : '全部项目' }}
              </p>
            </div>
          </div>
          <button
            type="button"
            class="btn btn-square btn-ghost btn-sm"
            title="关闭"
            aria-label="关闭"
            (click)="cancelled.emit()"
          >
            <app-icon name="x" [size]="15" />
          </button>
        </header>

        <div class="agent-health-strip" aria-label="Agent 连接状态">
          <article
            class="agent-health card"
            data-agent="claude"
            [class.unavailable]="!installation()?.healthy"
          >
            <span class="agent-health-icon"><app-icon name="bot" [size]="14" /></span>
            <div>
              <strong>Claude Code</strong>
              <small>{{ installation()?.diagnostic ?? '正在检测本机安装' }}</small>
            </div>
            <code>{{ installation()?.version ?? '未连接' }}</code>
          </article>
          <article
            class="agent-health card"
            data-agent="codex"
            [class.unavailable]="!codexInstallation()?.healthy"
          >
            <span class="agent-health-icon"><app-icon name="bot" [size]="14" /></span>
            <div>
              <strong>Codex CLI</strong>
              <small>{{ codexInstallation()?.diagnostic ?? '正在检测本机安装' }}</small>
            </div>
            <code>{{ codexInstallation()?.version ?? '未连接' }}</code>
          </article>
        </div>

        <div class="session-toolbar">
          <label class="dialog-search input input-bordered input-sm">
            <app-icon name="search" [size]="14" />
            <input
              type="search"
              placeholder="搜索名称、路径、分支、模型或会话 ID"
              aria-label="搜索 Agent 会话"
              [ngModel]="search()"
              (ngModelChange)="search.set($event)"
            />
            @if (search()) {
              <button
                type="button"
                class="search-clear"
                title="清除搜索"
                aria-label="清除搜索"
                (click)="search.set('')"
              >
                <app-icon name="x" [size]="11" />
              </button>
            }
          </label>
          <label class="scope-control">
            <input
              type="checkbox"
              [ngModel]="onlyWorkspace()"
              (ngModelChange)="onlyWorkspace.set($event); refresh()"
            />
            <span>仅当前工作区</span>
          </label>
          <button
            type="button"
            class="icon-action btn btn-square btn-ghost btn-sm"
            [class.spinning]="busy()"
            title="重新扫描本机会话"
            aria-label="重新扫描本机会话"
            [disabled]="busy()"
            (click)="refresh()"
          >
            <app-icon name="refresh" [size]="14" />
          </button>
        </div>

        <div class="session-filter-bar">
          <nav class="session-agent-filter tabs tabs-box" role="tablist" aria-label="按 Agent 筛选">
            @for (filter of agentFilters; track filter.value) {
              <button
                type="button"
                role="tab"
                class="tab"
                [class.active]="agentFilter() === filter.value"
                [attr.aria-selected]="agentFilter() === filter.value"
                (click)="agentFilter.set(filter.value)"
              >
                {{ filter.label }}
                <span>{{ countFor(filter.value) }}</span>
              </button>
            }
          </nav>
          <span class="session-result-count">
            显示 {{ filteredSessions().length }} / {{ sessions().length }}
          </span>
        </div>

        @if (error()) {
          <div class="session-error alert alert-error" role="alert">
            <app-icon name="shield" [size]="14" />
            <span>{{ error() }}</span>
            <button type="button" [disabled]="busy()" (click)="refresh()">重试</button>
          </div>
        }

        @if (showsClaudeOptions()) {
          <div class="resume-options">
            <div class="resume-options-copy">
              <span class="session-agent" data-agent="claude">
                <app-icon name="bot" [size]="14" />
              </span>
              <div>
                <strong>Claude 恢复配置</strong>
                <small>完整恢复会加载历史上下文；跨供应商请使用顶部模型切换的新会话</small>
              </div>
            </div>
            <label>
              <span>模型 Profile</span>
              <select [ngModel]="resolvedProfileId()" (ngModelChange)="profileId.set($event)">
                @for (profile of profiles(); track profile.id) {
                  <option [value]="profile.id">{{ profile.name }}</option>
                }
              </select>
            </label>
            <label>
              <span>MCP Profile</span>
              <select [ngModel]="mcpProfileId()" (ngModelChange)="mcpProfileId.set($event)">
                <option value="">Claude 默认配置</option>
                @for (profile of mcpProfiles(); track profile.id) {
                  <option [value]="profile.id">{{ profile.name }}</option>
                }
              </select>
            </label>
            <label>
              <span>Claude 登录账号</span>
              <select
                [ngModel]="resolvedClaudeAccountProfileId()"
                (ngModelChange)="claudeAccountProfileId.set($event)"
              >
                @for (profile of claudeAccounts(); track profile.id) {
                  <option [value]="profile.id">
                    {{ profile.name }} · {{ profile.authenticated ? '已登录' : '未登录' }}
                  </option>
                }
              </select>
            </label>
          </div>
        }

        @if (showsCodexOptions()) {
          <div class="resume-options codex-resume-options">
            <div class="resume-options-copy">
              <span class="session-agent" data-agent="codex">
                <app-icon name="terminal" [size]="14" />
              </span>
              <div>
                <strong>Codex 恢复配置</strong>
                <small>保留原生会话 ID，只读使用 rollout 索引</small>
              </div>
            </div>
            <label>
              <span>ChatGPT 登录账号</span>
              <select
                [ngModel]="resolvedCodexAccountProfileId()"
                (ngModelChange)="codexAccountProfileId.set($event)"
              >
                @for (profile of codexAccounts(); track profile.id) {
                  <option [value]="profile.id">
                    {{ profile.name }} · {{ profile.authenticated ? '已登录' : '未登录' }}
                  </option>
                }
              </select>
            </label>
            <label>
              <span>Codex 模型</span>
              <input
                type="text"
                list="resume-codex-model-suggestions"
                placeholder="留空沿用会话或配置默认模型"
                aria-label="恢复 Codex 模型"
                [ngModel]="codexModel()"
                (ngModelChange)="codexModel.set($event)"
              />
              <datalist id="resume-codex-model-suggestions">
                <option value="gpt-5.6-sol"></option>
                <option value="gpt-5.6-terra"></option>
                <option value="gpt-5.6-luna"></option>
              </datalist>
            </label>
          </div>
        }

        <div class="session-list" [attr.aria-busy]="busy()">
          @if (busy() && sessions().length === 0) {
            <div class="session-loading">
              <app-icon name="refresh" [size]="18" />
              <strong>正在扫描本机会话</strong>
              <span>正在读取 Claude 与 Codex 的原生会话索引…</span>
            </div>
          } @else {
            @for (session of filteredSessions(); track session.id) {
              <article class="session-row card" [attr.data-agent]="session.agentType">
                <span class="session-agent" [attr.data-agent]="session.agentType">
                  <app-icon name="bot" [size]="15" />
                </span>
                <div class="session-copy">
                  <strong [title]="session.title">{{ session.title }}</strong>
                  <small [title]="session.projectPath ?? '未知项目'">
                    {{ session.projectPath ?? '未知项目' }}
                  </small>
                  <div class="session-metadata">
                    <span class="agent-tag" [attr.data-agent]="session.agentType">
                      {{ agentLabel(session) }}
                    </span>
                    <span>{{ session.branch ?? '无分支' }}</span>
                    <span>{{ session.modelName ?? '默认模型' }}</span>
                    <span>{{ session.messageCount }} 条消息</span>
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
                  class="resume-button btn btn-primary btn-sm"
                  [disabled]="busy() || !installationFor(session)?.healthy"
                  [title]="
                    installationFor(session)?.healthy
                      ? '恢复此会话'
                      : agentLabel(session) + ' 当前不可用'
                  "
                  (click)="resume(session)"
                >
                  <app-icon name="play" [size]="12" />
                  {{ installationFor(session)?.healthy ? '恢复' : '不可用' }}
                </button>
              </article>
            } @empty {
              <div class="dialog-empty">
                <app-icon name="history" [size]="22" />
                <strong>{{ emptyTitle() }}</strong>
                <span>{{ emptyDescription() }}</span>
                @if (search()) {
                  <button type="button" class="secondary" (click)="search.set('')">清除搜索</button>
                }
              </div>
            }
          }
        </div>

        <footer class="session-footer">
          <span>原生会话文件保持只读，Termexo 不会修改或删除它们。</span>
          <button type="button" class="secondary btn btn-ghost btn-sm" (click)="cancelled.emit()">
            关闭
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrl: './agent-dialog.scss',
})
export class SessionCenterDialogComponent {
  readonly installation = input<AgentInstallation | null>(null);
  readonly codexInstallation = input<AgentInstallation | null>(null);
  readonly sessions = input<AgentSession[]>([]);
  readonly profiles = input<ModelProfile[]>([]);
  readonly mcpProfiles = input<McpProfile[]>([]);
  readonly accountProfiles = input<AccountProfile[]>([]);
  readonly projectPath = input('');
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly refreshed = output<string | undefined>();
  readonly resumed = output<ResumeSessionValue>();
  readonly cancelled = output<void>();

  protected readonly search = signal('');
  protected readonly onlyWorkspace = signal(true);
  protected readonly agentFilter = signal<SessionAgentFilter>('all');
  protected readonly profileId = signal('');
  protected readonly mcpProfileId = signal('');
  protected readonly claudeAccountProfileId = signal('');
  protected readonly codexAccountProfileId = signal('');
  protected readonly codexModel = signal('');
  protected readonly agentFilters = AGENT_FILTERS;
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
      this.profiles().find((profile) => profile.isDefault)?.id ||
      this.profiles()[0]?.id ||
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
  protected readonly emptyTitle = computed(() => {
    if (this.search().trim()) {
      return '没有匹配的会话';
    }
    if (this.agentFilter() === 'claude') {
      return '没有 Claude 会话';
    }
    if (this.agentFilter() === 'codex') {
      return '没有 Codex 会话';
    }
    return this.onlyWorkspace() ? '当前工作区没有本地会话' : '没有发现本地 Agent 会话';
  });
  protected readonly emptyDescription = computed(() =>
    this.search().trim()
      ? '尝试更换关键词、Agent 或扫描范围。'
      : this.onlyWorkspace()
        ? '关闭“仅当前工作区”可查看其他项目的会话。'
        : '确认对应 CLI 已安装并产生过可恢复的本地会话。',
  );

  protected countFor(filter: SessionAgentFilter): number {
    return this.sessionCounts()[filter];
  }

  protected refresh(): void {
    this.refreshed.emit(this.onlyWorkspace() ? this.projectPath() : undefined);
  }

  protected resume(session: AgentSession): void {
    const isClaude = session.agentType === 'claude';
    this.resumed.emit({
      session,
      profileId: isClaude ? this.resolvedProfileId() || undefined : undefined,
      mcpProfileId: isClaude ? this.mcpProfileId() || undefined : undefined,
      accountProfileId: isClaude
        ? session.accountProfileId || this.resolvedClaudeAccountProfileId() || undefined
        : session.accountProfileId || this.resolvedCodexAccountProfileId() || undefined,
      model: isClaude ? undefined : this.codexModel().trim() || session.modelName || undefined,
    });
  }

  protected installationFor(session: AgentSession): AgentInstallation | null {
    return session.agentType === 'codex' ? this.codexInstallation() : this.installation();
  }

  protected agentLabel(session: AgentSession): string {
    return session.agentType === 'codex' ? 'Codex CLI' : 'Claude Code';
  }

  protected shortSessionId(session: AgentSession): string {
    return session.nativeSessionId.slice(0, 8);
  }

  protected sessionDateTime(session: AgentSession): string {
    return new Date(session.lastUsedAt).toISOString();
  }
}
