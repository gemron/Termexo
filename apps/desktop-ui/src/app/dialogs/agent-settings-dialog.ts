import { Component, effect, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  AccountProfile,
  AccountProfileInput,
  AgentInstallation,
  CLAUDE_PROVIDER_PRESETS,
  CliOperationPlan,
  CliOperationRequest,
  CliOperationResult,
  McpProfile,
  McpProfileInput,
  ModelProfile,
  ModelProfileInput,
  NetworkProfile,
  NetworkProfileInput,
  NetworkProfileScope,
  NetworkTestResult,
  NativeAgentType,
} from '../core/models/agent.models';
import { IconComponent } from '../shared/icon/icon';

type SettingsTab = 'diagnostics' | 'cli' | 'accounts' | 'models' | 'mcp' | 'network';

@Component({
  selector: 'app-agent-settings-dialog',
  imports: [FormsModule, IconComponent],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancelled.emit()">
      <section
        class="agent-dialog settings-dialog modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-settings-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div class="dialog-title">
            <span class="title-icon"><app-icon name="settings" [size]="17" /></span>
            <div>
              <h2 id="agent-settings-title">Agent 与开发环境设置</h2>
              <p>Agent、模型、MCP、网络与安全凭据</p>
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

        <nav class="settings-tabs tabs tabs-border" aria-label="设置分类">
          <button
            type="button"
            class="tab"
            [class.active]="tab() === 'diagnostics'"
            (click)="selectTab('diagnostics')"
          >
            诊断
          </button>
          <button
            type="button"
            class="tab"
            [class.active]="tab() === 'cli'"
            (click)="selectTab('cli')"
          >
            CLI 安装与升级
          </button>
          <button
            type="button"
            class="tab"
            [class.active]="tab() === 'accounts'"
            (click)="selectTab('accounts')"
          >
            登录账号
          </button>
          <button
            type="button"
            class="tab"
            [class.active]="tab() === 'models'"
            (click)="selectTab('models')"
          >
            模型 Profile
          </button>
          <button
            type="button"
            class="tab"
            [class.active]="tab() === 'mcp'"
            (click)="selectTab('mcp')"
          >
            MCP Profile
          </button>
          <button
            type="button"
            class="tab"
            [class.active]="tab() === 'network'"
            (click)="selectTab('network')"
          >
            网络与 npm
          </button>
        </nav>

        <div class="settings-body">
          @switch (tab()) {
            @case ('diagnostics') {
              <section class="diagnostic-panel card">
                <div class="diagnostic-status alert" [class.unavailable]="!installation()?.healthy">
                  <span><app-icon name="shield" [size]="18" /></span>
                  <div>
                    <strong>{{
                      installation()?.healthy ? 'Claude Code 可用' : 'Claude Code 不可用'
                    }}</strong>
                    <small>{{ installation()?.diagnostic ?? '等待检测' }}</small>
                  </div>
                  <code>{{ installation()?.version ?? '未检测' }}</code>
                </div>
                <div
                  class="diagnostic-status alert"
                  [class.unavailable]="!codexInstallation()?.healthy"
                >
                  <span><app-icon name="terminal" [size]="18" /></span>
                  <div>
                    <strong>{{
                      codexInstallation()?.healthy ? 'Codex CLI 可用' : 'Codex CLI 不可用'
                    }}</strong>
                    <small>{{ codexInstallation()?.diagnostic ?? '等待检测' }}</small>
                  </div>
                  <code>{{ codexInstallation()?.version ?? '未检测' }}</code>
                </div>
                <dl>
                  <div>
                    <dt>Claude</dt>
                    <dd>{{ installation()?.executablePath ?? '未找到' }}</dd>
                  </div>
                  <div>
                    <dt>Codex</dt>
                    <dd>{{ codexInstallation()?.executablePath ?? '未找到' }}</dd>
                  </div>
                  <div>
                    <dt>凭据存储</dt>
                    <dd>Windows Credential Manager</dd>
                  </div>
                  <div>
                    <dt>会话策略</dt>
                    <dd>只读扫描 Claude JSONL 与 Codex rollout</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  class="secondary inline-command btn btn-outline btn-sm"
                  (click)="detectRequested.emit()"
                >
                  <app-icon name="refresh" [size]="13" />重新检测两个 CLI
                </button>
              </section>
            }
            @case ('cli') {
              <section class="cli-manager">
                <div class="cli-manager-intro">
                  <div>
                    <strong>托管 Agent CLI</strong>
                    <span>安装前预览官方包、目标版本、npm 与当前生效代理，确认后才会执行。</span>
                  </div>
                  <span class="scope-chip">WORKSPACE</span>
                </div>

                <div class="cli-agent-selector" role="group" aria-label="选择 Agent CLI">
                  <button
                    type="button"
                    [class.active]="cliAgentType === 'claude'"
                    (click)="selectCliAgent('claude')"
                  >
                    <span><app-icon name="bot" [size]="16" /></span>
                    <strong>Claude Code</strong>
                    <small>{{
                      installation()?.healthy ? (installation()?.version ?? '已安装') : '未检测到'
                    }}</small>
                  </button>
                  <button
                    type="button"
                    [class.active]="cliAgentType === 'codex'"
                    (click)="selectCliAgent('codex')"
                  >
                    <span><app-icon name="terminal" [size]="16" /></span>
                    <strong>Codex CLI</strong>
                    <small>{{
                      codexInstallation()?.healthy
                        ? (codexInstallation()?.version ?? '已安装')
                        : '未检测到'
                    }}</small>
                  </button>
                </div>

                <div class="cli-version-row">
                  <label>
                    <span>目标版本或 dist-tag</span>
                    <input
                      aria-label="CLI 目标版本"
                      placeholder="latest、next 或 0.145.0"
                      [(ngModel)]="cliTargetVersion"
                      (ngModelChange)="cliConfirmed = false"
                    />
                  </label>
                  <button
                    type="button"
                    class="secondary"
                    [disabled]="busy() || !cliTargetVersion.trim()"
                    (click)="previewCli()"
                  >
                    <app-icon name="refresh" [size]="13" />生成安装计划
                  </button>
                </div>

                @if (cliPlanMatches()) {
                  <div class="cli-plan" [class.unavailable]="!cliPlan()?.ready">
                    <div class="cli-plan-heading">
                      <span><app-icon name="shield" [size]="17" /></span>
                      <div>
                        <strong>
                          {{ cliPlan()?.action === 'install' ? '准备安装' : '准备升级' }}
                          {{ cliPlan()?.displayName }}
                        </strong>
                        <small>{{ cliPlan()?.diagnostic }}</small>
                      </div>
                      <code>{{ cliPlan()?.targetVersion }}</code>
                    </div>
                    <dl>
                      <div>
                        <dt>官方 npm 包</dt>
                        <dd>{{ cliPlan()?.packageSpec }}</dd>
                      </div>
                      <div>
                        <dt>当前版本</dt>
                        <dd>{{ cliPlan()?.currentVersion ?? '未安装' }}</dd>
                      </div>
                      <div>
                        <dt>npm</dt>
                        <dd>
                          {{ cliPlan()?.npmVersion ?? '不可用' }} ·
                          {{ cliPlan()?.npmPath ?? '未找到' }}
                        </dd>
                      </div>
                      <div>
                        <dt>生效代理</dt>
                        <dd>{{ cliPlan()?.networkProfileName ?? '直连（未选择代理）' }}</dd>
                      </div>
                      <div>
                        <dt>registry</dt>
                        <dd>{{ cliPlan()?.npmRegistry ?? 'npm 默认 registry' }}</dd>
                      </div>
                    </dl>
                    <code class="cli-command-preview">{{ cliPlan()?.commandPreview }}</code>

                    <label class="checkbox-control cli-confirmation">
                      <input
                        type="checkbox"
                        [(ngModel)]="cliConfirmed"
                        [disabled]="busy() || !cliPlan()?.ready"
                      />
                      <span>我已确认安装源、目标版本和生效网络配置</span>
                    </label>
                    <div class="cli-actions">
                      <span>失败时会重新检测原 CLI，并保留完整诊断。</span>
                      <button
                        type="button"
                        class="primary"
                        [disabled]="busy() || !cliConfirmed || !cliPlan()?.ready"
                        (click)="executeCli()"
                      >
                        {{ cliPlan()?.action === 'install' ? '确认并安装' : '确认并升级' }}
                      </button>
                    </div>
                  </div>
                } @else {
                  <div class="cli-empty-state">
                    <app-icon name="terminal" [size]="18" />
                    <span>选择 CLI 和目标版本，然后生成安装计划。</span>
                  </div>
                }

                @if (cliResult(); as result) {
                  <div class="cli-result" [class.unavailable]="!result.success">
                    <app-icon [name]="result.success ? 'check' : 'shield'" [size]="15" />
                    <span>
                      <strong>{{ result.diagnostic }}</strong>
                      <small>
                        {{ result.installation.diagnostic }} · {{ result.durationMs }} ms
                      </small>
                      @if (result.stderr) {
                        <code>{{ result.stderr }}</code>
                      }
                    </span>
                  </div>
                }
              </section>
            }
            @case ('accounts') {
              <div class="settings-split account-settings">
                <div class="profile-nav">
                  @for (profile of accountProfiles(); track profile.id) {
                    <button
                      type="button"
                      [class.active]="profile.id === accountId()"
                      (click)="editAccount(profile)"
                    >
                      <strong>
                        {{ profile.name }}
                        @if (profile.isDefault) {
                          <span class="scope-chip">DEFAULT</span>
                        }
                      </strong>
                      <small>
                        {{ profile.agentType === 'claude' ? 'Claude Code' : 'ChatGPT / Codex' }}
                        · {{ profile.authenticated ? '已登录' : '未登录' }}
                      </small>
                    </button>
                  }
                  <button type="button" class="new-profile" (click)="newAccount()">
                    <app-icon name="plus" [size]="13" />添加隔离账号
                  </button>
                </div>
                <div class="profile-editor account-editor">
                  <div class="network-intro">
                    <div>
                      <strong>多账号隔离登录</strong>
                      <span>每个账号使用独立配置目录；登录凭据不会与其他托管账号混用。</span>
                    </div>
                    <span class="scope-chip">{{
                      accountAgentType === 'claude' ? 'CLAUDE' : 'CHATGPT'
                    }}</span>
                  </div>

                  <div class="two-columns">
                    <label><span>账号名称</span><input [(ngModel)]="accountName" /></label>
                    <label>
                      <span>CLI 类型</span>
                      <select [(ngModel)]="accountAgentType" [disabled]="accountSystem()">
                        <option value="claude">Claude Code</option>
                        <option value="codex">ChatGPT / Codex</option>
                      </select>
                    </label>
                  </div>

                  @if (selectedAccount(); as profile) {
                    <div class="account-status alert" [class.unavailable]="!profile.authenticated">
                      <app-icon [name]="profile.authenticated ? 'check' : 'shield'" [size]="16" />
                      <span>
                        <strong>{{ profile.authenticated ? '账号已登录' : '账号尚未登录' }}</strong>
                        <small>{{ profile.diagnostic }}</small>
                      </span>
                    </div>
                    <label>
                      <span>隔离配置目录</span>
                      <input readonly [value]="profile.configDir ?? '使用 CLI 当前系统账号目录'" />
                    </label>
                  } @else {
                    <div class="account-status alert">
                      <app-icon name="shield" [size]="16" />
                      <span>
                        <strong>保存后即可登录</strong>
                        <small>Termexo 会自动创建独立配置目录并隔离凭据。</small>
                      </span>
                    </div>
                  }

                  <label class="checkbox-control editor-checkbox">
                    <input type="checkbox" [(ngModel)]="accountDefault" />
                    <span>设为此 CLI 的默认登录账号</span>
                  </label>

                  <p class="workspace-binding">
                    登录会在新终端中打开官方 CLI 流程。删除 Profile 不会删除磁盘凭据目录。
                  </p>

                  <div class="editor-actions account-actions">
                    @if (accountId() && !accountSystem()) {
                      <button
                        type="button"
                        class="danger"
                        [disabled]="busy()"
                        (click)="deleteAccountRequested.emit(accountId())"
                      >
                        <app-icon name="trash" [size]="13" />删除
                      </button>
                    }
                    <span></span>
                    @if (accountId()) {
                      <button
                        type="button"
                        class="secondary"
                        [disabled]="busy()"
                        (click)="accountRefreshRequested.emit(accountId())"
                      >
                        <app-icon name="refresh" [size]="13" />刷新状态
                      </button>
                      <button
                        type="button"
                        class="secondary"
                        [disabled]="busy()"
                        (click)="accountLoginRequested.emit(accountId())"
                      >
                        <app-icon name="terminal" [size]="13" />登录 / 切换
                      </button>
                    }
                    <button
                      type="button"
                      class="primary"
                      [disabled]="busy() || !accountName.trim()"
                      (click)="saveAccount()"
                    >
                      保存账号
                    </button>
                  </div>
                </div>
              </div>
            }
            @case ('models') {
              <div class="settings-split">
                <div class="profile-nav">
                  @for (profile of modelProfiles(); track profile.id) {
                    <button
                      type="button"
                      [class.active]="profile.id === modelId()"
                      (click)="editModel(profile)"
                    >
                      <strong>{{ profile.name }}</strong>
                      <small>{{ profile.provider }} · {{ profile.model }}</small>
                    </button>
                  }
                  <button type="button" class="new-profile" (click)="newModel()">
                    <app-icon name="plus" [size]="13" />新建 Profile
                  </button>
                </div>
                <div class="profile-editor">
                  <div class="two-columns">
                    <label><span>名称</span><input [(ngModel)]="modelName" /></label>
                    <label>
                      <span>模型供应商</span>
                      <select [ngModel]="modelProvider" (ngModelChange)="selectProvider($event)">
                        @for (preset of providerPresets; track preset.provider) {
                          <option [value]="preset.provider">{{ preset.provider }}</option>
                        }
                        @if (!isPresetProvider(modelProvider)) {
                          <option [value]="modelProvider">{{ modelProvider }}</option>
                        }
                      </select>
                    </label>
                    <label><span>模型</span><input [(ngModel)]="modelNameValue" /></label>
                  </div>
                  <label>
                    <span>Anthropic 兼容 Endpoint</span>
                    <input placeholder="留空使用 Anthropic 官方 Endpoint" [(ngModel)]="baseUrl" />
                  </label>
                  <label>
                    <span>API Key</span>
                    <input
                      type="password"
                      [placeholder]="hasCredential() ? '已安全保存，留空表示不修改' : '可选'"
                      [(ngModel)]="apiKey"
                    />
                  </label>
                  <label class="checkbox-control editor-checkbox">
                    <input type="checkbox" [(ngModel)]="isDefault" />
                    <span>设为默认 Claude Profile</span>
                  </label>
                  @if (hasCredential()) {
                    <label class="checkbox-control editor-checkbox">
                      <input type="checkbox" [(ngModel)]="clearCredential" />
                      <span>清除已保存的 API Key</span>
                    </label>
                  }
                  <div class="editor-actions">
                    @if (modelId() && modelId() !== 'claude-default') {
                      <button
                        type="button"
                        class="danger"
                        (click)="deleteModelRequested.emit(modelId())"
                      >
                        <app-icon name="trash" [size]="13" />删除
                      </button>
                    }
                    <span></span>
                    <button
                      type="button"
                      class="primary"
                      [disabled]="!modelName.trim() || !modelNameValue.trim()"
                      (click)="saveModel()"
                    >
                      保存 Profile
                    </button>
                  </div>
                </div>
              </div>
            }
            @case ('mcp') {
              <div class="settings-split">
                <div class="profile-nav">
                  @for (profile of mcpProfiles(); track profile.id) {
                    <button
                      type="button"
                      [class.active]="profile.id === mcpId()"
                      (click)="editMcp(profile)"
                    >
                      <strong>{{ profile.name }}</strong>
                      <small>独立 MCP 配置</small>
                    </button>
                  }
                  <button type="button" class="new-profile" (click)="newMcp()">
                    <app-icon name="plus" [size]="13" />新建 MCP Profile
                  </button>
                </div>
                <div class="profile-editor">
                  <label><span>名称</span><input [(ngModel)]="mcpName" /></label>
                  <label class="json-field">
                    <span>配置 JSON</span>
                    <textarea spellcheck="false" [(ngModel)]="mcpConfig"></textarea>
                  </label>
                  <div class="editor-actions">
                    @if (mcpId()) {
                      <button
                        type="button"
                        class="danger"
                        (click)="deleteMcpRequested.emit(mcpId())"
                      >
                        <app-icon name="trash" [size]="13" />删除
                      </button>
                    }
                    <span></span>
                    <button
                      type="button"
                      class="primary"
                      [disabled]="!mcpName.trim() || !mcpConfig.trim()"
                      (click)="saveMcp()"
                    >
                      保存 MCP Profile
                    </button>
                  </div>
                </div>
              </div>
            }
            @case ('network') {
              <div class="settings-split network-settings">
                <div class="profile-nav">
                  @for (profile of networkProfiles(); track profile.id) {
                    <button
                      type="button"
                      [class.active]="profile.id === networkId()"
                      (click)="editNetwork(profile)"
                    >
                      <strong>{{ profile.name }}</strong>
                      <small>
                        {{ profile.scope === 'global' ? '全局' : 'Workspace' }}
                        · {{ profile.enabled ? '已启用' : '已停用' }}
                      </small>
                    </button>
                  }
                  <button type="button" class="new-profile" (click)="newNetwork()">
                    <app-icon name="plus" [size]="13" />新建代理 Profile
                  </button>
                </div>
                <div class="profile-editor network-editor">
                  <div class="network-intro">
                    <div>
                      <strong>开发网络与 npm 代理</strong>
                      <span
                        >仅向托管 Agent 和后续 CLI 安装流程注入，不修改系统或全局 npm 配置。</span
                      >
                    </div>
                    <span class="scope-chip">{{
                      networkScope === 'global' ? 'GLOBAL' : 'WORKSPACE'
                    }}</span>
                  </div>

                  <div class="two-columns">
                    <label><span>名称</span><input [(ngModel)]="networkName" /></label>
                    <label>
                      <span>作用域</span>
                      <select [(ngModel)]="networkScope" (ngModelChange)="changeNetworkScope()">
                        <option value="workspace">当前 Workspace</option>
                        <option value="global">全局默认</option>
                      </select>
                    </label>
                  </div>
                  @if (networkScope === 'workspace') {
                    <p class="workspace-binding">绑定：{{ networkWorkspaceLabel() }}</p>
                  }

                  <div class="network-section">
                    <h3>系统与 Agent 代理</h3>
                    <div class="two-columns">
                      <label>
                        <span>HTTP_PROXY</span>
                        <input placeholder="http://proxy.internal:8080" [(ngModel)]="httpProxy" />
                      </label>
                      <label>
                        <span>HTTPS_PROXY</span>
                        <input placeholder="http://proxy.internal:8080" [(ngModel)]="httpsProxy" />
                      </label>
                      <label>
                        <span>ALL_PROXY / SOCKS</span>
                        <input placeholder="socks5://127.0.0.1:1080" [(ngModel)]="allProxy" />
                      </label>
                      <label>
                        <span>NO_PROXY</span>
                        <input placeholder="localhost,.internal.example" [(ngModel)]="noProxy" />
                      </label>
                    </div>
                  </div>

                  <div class="network-section">
                    <h3>npm</h3>
                    <label>
                      <span>registry</span>
                      <input placeholder="https://registry.npmjs.org/" [(ngModel)]="npmRegistry" />
                    </label>
                    <div class="two-columns">
                      <label>
                        <span>proxy</span>
                        <input placeholder="http://proxy.internal:8080" [(ngModel)]="npmProxy" />
                      </label>
                      <label>
                        <span>https-proxy</span>
                        <input
                          placeholder="http://proxy.internal:8080"
                          [(ngModel)]="npmHttpsProxy"
                        />
                      </label>
                    </div>
                    <label>
                      <span>企业 CA 文件</span>
                      <input placeholder="C:\\certs\\internal-ca.pem" [(ngModel)]="npmCaPath" />
                    </label>
                  </div>

                  <div class="network-section">
                    <h3>代理凭据</h3>
                    <div class="two-columns">
                      <label><span>用户名</span><input [(ngModel)]="proxyUsername" /></label>
                      <label>
                        <span>密码</span>
                        <input
                          type="password"
                          [placeholder]="
                            hasNetworkCredential()
                              ? '已安全保存，留空表示不修改'
                              : '可选，保存到系统凭据库'
                          "
                          [(ngModel)]="proxyPassword"
                        />
                      </label>
                    </div>
                    @if (hasNetworkCredential()) {
                      <label class="checkbox-control editor-checkbox">
                        <input type="checkbox" [(ngModel)]="clearNetworkCredential" />
                        <span>清除已保存的代理密码</span>
                      </label>
                    }
                  </div>

                  <div class="network-options">
                    <label class="checkbox-control">
                      <input type="checkbox" [(ngModel)]="networkEnabled" />
                      <span>启用此 Profile</span>
                    </label>
                    <label class="checkbox-control">
                      <input type="checkbox" [(ngModel)]="networkDefault" />
                      <span>设为此作用域默认</span>
                    </label>
                    <label class="checkbox-control">
                      <input type="checkbox" [(ngModel)]="npmStrictSsl" />
                      <span>npm strict-ssl</span>
                    </label>
                  </div>

                  @if (networkTestResult() && networkTestResult()?.profileId === networkId()) {
                    <div
                      class="network-test-result"
                      [class.unavailable]="!networkTestResult()?.healthy"
                    >
                      <app-icon
                        [name]="networkTestResult()?.healthy ? 'check' : 'shield'"
                        [size]="14"
                      />
                      <span>
                        <strong>{{ networkTestResult()?.message }}</strong>
                        <small>
                          {{ networkTestResult()?.target }} ·
                          {{ networkTestResult()?.latencyMs }} ms
                        </small>
                      </span>
                    </div>
                  }

                  <div class="editor-actions network-actions">
                    @if (networkId()) {
                      <button
                        type="button"
                        class="danger"
                        [disabled]="busy()"
                        (click)="deleteNetworkRequested.emit(networkId())"
                      >
                        <app-icon name="trash" [size]="13" />删除
                      </button>
                    }
                    <span></span>
                    <button
                      type="button"
                      class="secondary"
                      [disabled]="busy() || !networkId()"
                      (click)="networkTestRequested.emit(networkId())"
                    >
                      <app-icon name="radio" [size]="13" />测试连接
                    </button>
                    <button
                      type="button"
                      class="primary"
                      [disabled]="busy() || !canSaveNetwork()"
                      (click)="saveNetwork()"
                    >
                      保存代理 Profile
                    </button>
                  </div>
                </div>
              </div>
            }
          }
        </div>
      </section>
    </div>
  `,
  styleUrl: './agent-dialog.scss',
})
export class AgentSettingsDialogComponent {
  readonly installation = input<AgentInstallation | null>(null);
  readonly codexInstallation = input<AgentInstallation | null>(null);
  readonly modelProfiles = input<ModelProfile[]>([]);
  readonly mcpProfiles = input<McpProfile[]>([]);
  readonly networkProfiles = input<NetworkProfile[]>([]);
  readonly accountProfiles = input<AccountProfile[]>([]);
  readonly activeWorkspaceId = input('');
  readonly activeWorkspaceName = input('当前 Workspace');
  readonly networkTestResult = input<NetworkTestResult | null>(null);
  readonly cliPlan = input<CliOperationPlan | null>(null);
  readonly cliResult = input<CliOperationResult | null>(null);
  readonly busy = input(false);
  readonly cancelled = output<void>();
  readonly detectRequested = output<void>();
  readonly cliPreviewRequested = output<CliOperationRequest>();
  readonly cliExecuteRequested = output<CliOperationRequest>();
  readonly modelSaved = output<ModelProfileInput>();
  readonly deleteModelRequested = output<string>();
  readonly mcpSaved = output<McpProfileInput>();
  readonly deleteMcpRequested = output<string>();
  readonly networkSaved = output<NetworkProfileInput>();
  readonly deleteNetworkRequested = output<string>();
  readonly networkTestRequested = output<string>();
  readonly accountSaved = output<AccountProfileInput>();
  readonly deleteAccountRequested = output<string>();
  readonly accountLoginRequested = output<string>();
  readonly accountRefreshRequested = output<string>();

  protected readonly tab = signal<SettingsTab>('diagnostics');
  protected readonly modelId = signal('claude-default');
  protected readonly hasCredential = signal(false);
  protected readonly mcpId = signal('');
  protected readonly networkId = signal('');
  protected readonly accountId = signal('');
  protected readonly accountSystem = signal(false);
  protected readonly hasNetworkCredential = signal(false);
  protected readonly providerPresets = CLAUDE_PROVIDER_PRESETS;
  protected cliAgentType: NativeAgentType = 'claude';
  protected cliTargetVersion = 'latest';
  protected cliConfirmed = false;
  protected modelName = 'Claude Sonnet';
  protected modelProvider = 'Anthropic';
  protected modelNameValue = 'sonnet';
  protected baseUrl = '';
  protected apiKey = '';
  protected isDefault = true;
  protected clearCredential = false;
  protected mcpName = '';
  protected mcpConfig = '{\n  "mcpServers": {}\n}';
  protected networkName = '当前 Workspace 代理';
  protected networkScope: NetworkProfileScope = 'workspace';
  protected networkWorkspaceId = '';
  protected networkEnabled = true;
  protected networkDefault = true;
  protected httpProxy = '';
  protected httpsProxy = '';
  protected allProxy = '';
  protected noProxy = 'localhost,127.0.0.1,::1';
  protected npmRegistry = '';
  protected npmProxy = '';
  protected npmHttpsProxy = '';
  protected npmStrictSsl = true;
  protected npmCaPath = '';
  protected proxyUsername = '';
  protected proxyPassword = '';
  protected clearNetworkCredential = false;
  protected accountName = '';
  protected accountAgentType: NativeAgentType = 'claude';
  protected accountDefault = false;
  private modelProfilesInitialized = false;
  private mcpProfilesInitialized = false;
  private networkProfilesInitialized = false;
  private accountProfilesInitialized = false;

  constructor() {
    effect(() => this.syncModelProfileEditor(this.modelProfiles()));
    effect(() => this.syncMcpProfileEditor(this.mcpProfiles()));
    effect(() => this.syncNetworkProfileEditor(this.networkProfiles()));
    effect(() => this.syncAccountProfileEditor(this.accountProfiles()));
  }

  protected selectTab(tab: SettingsTab): void {
    this.tab.set(tab);
    if (tab === 'accounts') {
      this.syncAccountProfileEditor(this.accountProfiles());
    } else if (tab === 'models') {
      this.syncModelProfileEditor(this.modelProfiles());
    } else if (tab === 'mcp') {
      this.syncMcpProfileEditor(this.mcpProfiles());
    } else if (tab === 'network') {
      this.syncNetworkProfileEditor(this.networkProfiles());
    }
  }

  protected selectCliAgent(agentType: NativeAgentType): void {
    this.cliAgentType = agentType;
    this.cliConfirmed = false;
  }

  protected selectedAccount(): AccountProfile | undefined {
    return this.accountProfiles().find((profile) => profile.id === this.accountId());
  }

  protected editAccount(profile: AccountProfile): void {
    this.accountId.set(profile.id);
    this.accountName = profile.name;
    this.accountAgentType = profile.agentType;
    this.accountDefault = profile.isDefault;
    this.accountSystem.set(profile.isSystem);
  }

  protected newAccount(): void {
    this.accountId.set('');
    this.accountName = '';
    this.accountAgentType = 'claude';
    this.accountDefault = false;
    this.accountSystem.set(false);
  }

  protected saveAccount(): void {
    const profileId = this.accountId() || crypto.randomUUID();
    this.accountId.set(profileId);
    this.accountSaved.emit({
      id: profileId,
      name: this.accountName.trim(),
      agentType: this.accountAgentType,
      isDefault: this.accountDefault,
    });
  }

  protected previewCli(): void {
    this.cliConfirmed = false;
    this.cliPreviewRequested.emit(this.cliRequest());
  }

  protected executeCli(): void {
    if (this.cliConfirmed && this.cliPlanMatches()) {
      this.cliExecuteRequested.emit({ ...this.cliRequest(), confirmed: true });
      this.cliConfirmed = false;
    }
  }

  protected cliPlanMatches(): boolean {
    const plan = this.cliPlan();
    return (
      plan?.agentType === this.cliAgentType &&
      plan.targetVersion === (this.cliTargetVersion.trim() || 'latest')
    );
  }

  private cliRequest(): CliOperationRequest {
    return {
      agentType: this.cliAgentType,
      targetVersion: this.cliTargetVersion.trim() || 'latest',
      workspaceId: this.activeWorkspaceId() || undefined,
    };
  }

  protected editModel(profile: ModelProfile): void {
    this.modelId.set(profile.id);
    this.modelName = profile.name;
    this.modelProvider = profile.provider;
    this.modelNameValue = profile.model;
    this.baseUrl = profile.baseUrl ?? '';
    this.apiKey = '';
    this.isDefault = profile.isDefault;
    this.clearCredential = false;
    this.hasCredential.set(profile.hasCredential);
  }

  protected newModel(): void {
    this.modelId.set('');
    this.selectProvider('Anthropic');
    this.apiKey = '';
    this.isDefault = false;
    this.clearCredential = false;
    this.hasCredential.set(false);
  }

  protected saveModel(): void {
    const profileId = this.modelId() || crypto.randomUUID();
    this.modelId.set(profileId);
    this.modelSaved.emit({
      id: profileId,
      name: this.modelName.trim(),
      provider: this.modelProvider.trim(),
      model: this.modelNameValue.trim(),
      baseUrl: this.baseUrl.trim() || undefined,
      apiKey: this.apiKey || undefined,
      clearCredential: this.clearCredential,
      isDefault: this.isDefault,
    });
  }

  protected selectProvider(provider: string): void {
    this.modelProvider = provider;
    const preset = this.providerPresets.find((item) => item.provider === provider);
    if (!preset) {
      return;
    }
    this.modelName = preset.name;
    this.modelNameValue = preset.model;
    this.baseUrl = preset.baseUrl;
  }

  protected isPresetProvider(provider: string): boolean {
    return this.providerPresets.some((item) => item.provider === provider);
  }

  protected editMcp(profile: McpProfile): void {
    this.mcpId.set(profile.id);
    this.mcpName = profile.name;
    this.mcpConfig = profile.configJson;
  }

  protected newMcp(): void {
    this.mcpId.set('');
    this.mcpName = '';
    this.mcpConfig = '{\n  "mcpServers": {}\n}';
  }

  protected saveMcp(): void {
    const profileId = this.mcpId() || crypto.randomUUID();
    this.mcpId.set(profileId);
    this.mcpSaved.emit({
      id: profileId,
      name: this.mcpName.trim(),
      configJson: this.mcpConfig,
    });
  }

  protected editNetwork(profile: NetworkProfile): void {
    this.networkId.set(profile.id);
    this.networkName = profile.name;
    this.networkScope = profile.scope;
    this.networkWorkspaceId = profile.workspaceId ?? '';
    this.networkEnabled = profile.enabled;
    this.networkDefault = profile.isDefault;
    this.httpProxy = profile.httpProxy ?? '';
    this.httpsProxy = profile.httpsProxy ?? '';
    this.allProxy = profile.allProxy ?? '';
    this.noProxy = profile.noProxy ?? '';
    this.npmRegistry = profile.npmRegistry ?? '';
    this.npmProxy = profile.npmProxy ?? '';
    this.npmHttpsProxy = profile.npmHttpsProxy ?? '';
    this.npmStrictSsl = profile.npmStrictSsl;
    this.npmCaPath = profile.npmCaPath ?? '';
    this.proxyUsername = profile.proxyUsername ?? '';
    this.proxyPassword = '';
    this.clearNetworkCredential = false;
    this.hasNetworkCredential.set(profile.hasCredential);
  }

  protected newNetwork(): void {
    this.networkId.set('');
    this.networkName = this.activeWorkspaceId() ? '当前 Workspace 代理' : '全局开发代理';
    this.networkScope = this.activeWorkspaceId() ? 'workspace' : 'global';
    this.networkWorkspaceId = this.activeWorkspaceId();
    this.networkEnabled = true;
    this.networkDefault = true;
    this.httpProxy = '';
    this.httpsProxy = '';
    this.allProxy = '';
    this.noProxy = 'localhost,127.0.0.1,::1';
    this.npmRegistry = '';
    this.npmProxy = '';
    this.npmHttpsProxy = '';
    this.npmStrictSsl = true;
    this.npmCaPath = '';
    this.proxyUsername = '';
    this.proxyPassword = '';
    this.clearNetworkCredential = false;
    this.hasNetworkCredential.set(false);
  }

  protected changeNetworkScope(): void {
    if (this.networkScope === 'workspace' && !this.networkWorkspaceId) {
      this.networkWorkspaceId = this.activeWorkspaceId();
    }
  }

  protected networkWorkspaceLabel(): string {
    if (!this.networkWorkspaceId) {
      return '未选择 Workspace';
    }
    return this.networkWorkspaceId === this.activeWorkspaceId()
      ? this.activeWorkspaceName()
      : this.networkWorkspaceId;
  }

  protected canSaveNetwork(): boolean {
    return Boolean(
      this.networkName.trim() &&
      (this.networkScope === 'global' ||
        this.networkWorkspaceId.trim() ||
        this.activeWorkspaceId().trim()),
    );
  }

  protected saveNetwork(): void {
    const profileId = this.networkId() || crypto.randomUUID();
    this.networkId.set(profileId);
    if (this.proxyPassword && !this.clearNetworkCredential) {
      this.hasNetworkCredential.set(true);
    } else if (this.clearNetworkCredential || !this.proxyUsername.trim()) {
      this.hasNetworkCredential.set(false);
    }
    this.networkSaved.emit({
      id: profileId,
      name: this.networkName.trim(),
      scope: this.networkScope,
      workspaceId:
        this.networkScope === 'workspace'
          ? this.networkWorkspaceId || this.activeWorkspaceId()
          : undefined,
      enabled: this.networkEnabled,
      isDefault: this.networkDefault,
      httpProxy: this.httpProxy.trim() || undefined,
      httpsProxy: this.httpsProxy.trim() || undefined,
      allProxy: this.allProxy.trim() || undefined,
      noProxy: this.noProxy.trim() || undefined,
      npmRegistry: this.npmRegistry.trim() || undefined,
      npmProxy: this.npmProxy.trim() || undefined,
      npmHttpsProxy: this.npmHttpsProxy.trim() || undefined,
      npmStrictSsl: this.npmStrictSsl,
      npmCaPath: this.npmCaPath.trim() || undefined,
      proxyUsername: this.proxyUsername.trim() || undefined,
      proxyPassword: this.proxyPassword || undefined,
      clearCredential: this.clearNetworkCredential,
    });
  }

  private syncModelProfileEditor(profiles: ModelProfile[]): void {
    const selectedId = untracked(this.modelId);
    const selectedProfile = profiles.find((profile) => profile.id === selectedId);
    if (
      !this.modelProfilesInitialized ||
      (!selectedId && profiles.length > 0) ||
      (selectedId && !selectedProfile)
    ) {
      const fallback =
        selectedProfile ?? profiles.find((profile) => profile.isDefault) ?? profiles[0];
      fallback ? this.editModel(fallback) : this.newModel();
      this.modelProfilesInitialized = true;
    }
  }

  private syncMcpProfileEditor(profiles: McpProfile[]): void {
    const selectedId = untracked(this.mcpId);
    const selectedProfile = profiles.find((profile) => profile.id === selectedId);
    if (
      !this.mcpProfilesInitialized ||
      (!selectedId && profiles.length > 0) ||
      (selectedId && !selectedProfile)
    ) {
      const fallback = selectedProfile ?? profiles[0];
      fallback ? this.editMcp(fallback) : this.newMcp();
      this.mcpProfilesInitialized = true;
    }
  }

  private syncNetworkProfileEditor(profiles: NetworkProfile[]): void {
    const selectedId = untracked(this.networkId);
    const selectedProfile = profiles.find((profile) => profile.id === selectedId);
    if (
      !this.networkProfilesInitialized ||
      (!selectedId && profiles.length > 0) ||
      (selectedId && !selectedProfile)
    ) {
      const fallback =
        selectedProfile ??
        profiles.find(
          (profile) =>
            profile.scope === 'workspace' &&
            profile.workspaceId === this.activeWorkspaceId() &&
            profile.isDefault,
        ) ??
        profiles.find((profile) => profile.scope === 'global' && profile.isDefault) ??
        profiles[0];
      fallback ? this.editNetwork(fallback) : this.newNetwork();
      this.networkProfilesInitialized = true;
    }
  }

  private syncAccountProfileEditor(profiles: AccountProfile[]): void {
    const selectedId = untracked(this.accountId);
    const selectedProfile = profiles.find((profile) => profile.id === selectedId);
    if (
      !this.accountProfilesInitialized ||
      (!selectedId && profiles.length > 0) ||
      (selectedId && !selectedProfile)
    ) {
      const fallback =
        selectedProfile ?? profiles.find((profile) => profile.isDefault) ?? profiles[0];
      fallback ? this.editAccount(fallback) : this.newAccount();
      this.accountProfilesInitialized = true;
    }
  }
}
