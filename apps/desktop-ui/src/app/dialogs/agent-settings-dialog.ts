import { Component, effect, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  AgentInstallation,
  McpProfile,
  McpProfileInput,
  ModelProfile,
  ModelProfileInput,
} from '../core/models/agent.models';
import { IconComponent } from '../shared/icon/icon';

type SettingsTab = 'diagnostics' | 'models' | 'mcp';

@Component({
  selector: 'app-agent-settings-dialog',
  imports: [FormsModule, IconComponent],
  template: `
    <div class="backdrop" (mousedown)="cancelled.emit()">
      <section
        class="agent-dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-settings-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div class="dialog-title">
            <span class="title-icon"><app-icon name="settings" [size]="17" /></span>
            <div>
              <h2 id="agent-settings-title">Claude Code 设置</h2>
              <p>本地运行配置与安全凭据</p>
            </div>
          </div>
          <button type="button" title="关闭" aria-label="关闭" (click)="cancelled.emit()">
            <app-icon name="x" [size]="15" />
          </button>
        </header>

        <nav class="settings-tabs" aria-label="设置分类">
          <button
            type="button"
            [class.active]="tab() === 'diagnostics'"
            (click)="selectTab('diagnostics')"
          >
            诊断
          </button>
          <button type="button" [class.active]="tab() === 'models'" (click)="selectTab('models')">
            模型 Profile
          </button>
          <button type="button" [class.active]="tab() === 'mcp'" (click)="selectTab('mcp')">
            MCP Profile
          </button>
        </nav>

        <div class="settings-body">
          @switch (tab()) {
            @case ('diagnostics') {
              <section class="diagnostic-panel">
                <div class="diagnostic-status" [class.unavailable]="!installation()?.healthy">
                  <span><app-icon name="shield" [size]="18" /></span>
                  <div>
                    <strong>{{
                      installation()?.healthy ? 'Claude Code 可用' : 'Claude Code 不可用'
                    }}</strong>
                    <small>{{ installation()?.diagnostic ?? '等待检测' }}</small>
                  </div>
                  <code>{{ installation()?.version ?? '未检测' }}</code>
                </div>
                <dl>
                  <div>
                    <dt>可执行文件</dt>
                    <dd>{{ installation()?.executablePath ?? '未找到' }}</dd>
                  </div>
                  <div>
                    <dt>凭据存储</dt>
                    <dd>Windows Credential Manager</dd>
                  </div>
                  <div>
                    <dt>会话策略</dt>
                    <dd>只读扫描 Claude JSONL</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  class="secondary inline-command"
                  (click)="detectRequested.emit()"
                >
                  <app-icon name="refresh" [size]="13" />重新检测
                </button>
              </section>
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
          }
        </div>
      </section>
    </div>
  `,
  styleUrl: './agent-dialog.scss',
})
export class AgentSettingsDialogComponent {
  readonly installation = input<AgentInstallation | null>(null);
  readonly modelProfiles = input<ModelProfile[]>([]);
  readonly mcpProfiles = input<McpProfile[]>([]);
  readonly cancelled = output<void>();
  readonly detectRequested = output<void>();
  readonly modelSaved = output<ModelProfileInput>();
  readonly deleteModelRequested = output<string>();
  readonly mcpSaved = output<McpProfileInput>();
  readonly deleteMcpRequested = output<string>();

  protected readonly tab = signal<SettingsTab>('diagnostics');
  protected readonly modelId = signal('claude-default');
  protected readonly hasCredential = signal(false);
  protected readonly mcpId = signal('');
  protected modelName = 'Claude Sonnet';
  protected modelNameValue = 'sonnet';
  protected baseUrl = '';
  protected apiKey = '';
  protected isDefault = true;
  protected clearCredential = false;
  protected mcpName = '';
  protected mcpConfig = '{\n  "mcpServers": {}\n}';
  private modelProfilesInitialized = false;
  private mcpProfilesInitialized = false;

  constructor() {
    effect(() => this.syncModelProfileEditor(this.modelProfiles()));
    effect(() => this.syncMcpProfileEditor(this.mcpProfiles()));
  }

  protected selectTab(tab: SettingsTab): void {
    this.tab.set(tab);
    if (tab === 'models') {
      this.syncModelProfileEditor(this.modelProfiles());
    } else if (tab === 'mcp') {
      this.syncMcpProfileEditor(this.mcpProfiles());
    }
  }

  protected editModel(profile: ModelProfile): void {
    this.modelId.set(profile.id);
    this.modelName = profile.name;
    this.modelNameValue = profile.model;
    this.baseUrl = profile.baseUrl ?? '';
    this.apiKey = '';
    this.isDefault = profile.isDefault;
    this.clearCredential = false;
    this.hasCredential.set(profile.hasCredential);
  }

  protected newModel(): void {
    this.modelId.set('');
    this.modelName = '';
    this.modelNameValue = 'sonnet';
    this.baseUrl = '';
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
      provider: 'Anthropic',
      model: this.modelNameValue.trim(),
      baseUrl: this.baseUrl.trim() || undefined,
      apiKey: this.apiKey || undefined,
      clearCredential: this.clearCredential,
      isDefault: this.isDefault,
    });
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
}
