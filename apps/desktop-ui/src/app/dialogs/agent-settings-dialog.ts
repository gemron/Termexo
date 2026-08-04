import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  AccountProfile,
  AccountProfileInput,
  AgentInstallation,
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
  ProviderPreset,
  PROVIDER_PRESETS,
} from '../core/models/agent.models';
import { UpdateCheck } from '../core/services/update.service';
import { IconComponent } from '../shared/icon/icon';

export type SettingsTab = 'diagnostics' | 'cli' | 'accounts' | 'models' | 'mcp' | 'network';

@Component({
  selector: 'app-agent-settings-dialog',
  imports: [FormsModule, IconComponent, TranslatePipe],
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
              <h2 id="agent-settings-title">{{ 'settings.title' | t }}</h2>
              <p>{{ 'settings.subtitle' | t }}</p>
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

        <nav class="settings-tabs tabs tabs-border" [attr.aria-label]="'settings.categories' | t">
          <button
            type="button"
            class="tab"
            [class.active]="tab() === 'diagnostics'"
            (click)="selectTab('diagnostics')"
          >
            {{ 'settings.tabDiagnostics' | t }}
          </button>
          <button
            type="button"
            class="tab"
            [class.active]="tab() === 'cli'"
            (click)="selectTab('cli')"
          >
            {{ 'settings.tabCli' | t }}
          </button>
          <button
            type="button"
            class="tab"
            [class.active]="tab() === 'accounts'"
            (click)="selectTab('accounts')"
          >
            {{ 'settings.tabAccounts' | t }}
          </button>
          <button
            type="button"
            class="tab"
            [class.active]="tab() === 'models'"
            (click)="selectTab('models')"
          >
            {{ 'settings.tabModels' | t }}
          </button>
          <button
            type="button"
            class="tab"
            [class.active]="tab() === 'mcp'"
            (click)="selectTab('mcp')"
          >
            {{ 'settings.tabMcp' | t }}
          </button>
          <button
            type="button"
            class="tab"
            [class.active]="tab() === 'network'"
            (click)="selectTab('network')"
          >
            {{ 'settings.tabNetwork' | t }}
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
                      installation()?.healthy
                        ? ('settings.available' | t: { name: 'Claude Code' })
                        : ('settings.unavailable' | t: { name: 'Claude Code' })
                    }}</strong>
                    <small>{{
                      installation()?.diagnostic ?? ('settings.awaitingDetection' | t)
                    }}</small>
                  </div>
                  <code>{{ installation()?.version ?? ('common.notDetected' | t) }}</code>
                </div>
                <div
                  class="diagnostic-status alert"
                  [class.unavailable]="!codexInstallation()?.healthy"
                >
                  <span><app-icon name="terminal" [size]="18" /></span>
                  <div>
                    <strong>{{
                      codexInstallation()?.healthy
                        ? ('settings.available' | t: { name: 'Codex CLI' })
                        : ('settings.unavailable' | t: { name: 'Codex CLI' })
                    }}</strong>
                    <small>{{
                      codexInstallation()?.diagnostic ?? ('settings.awaitingDetection' | t)
                    }}</small>
                  </div>
                  <code>{{ codexInstallation()?.version ?? ('common.notDetected' | t) }}</code>
                </div>
                <dl>
                  <div>
                    <dt>Claude</dt>
                    <dd>{{ installation()?.executablePath ?? ('settings.notFound' | t) }}</dd>
                  </div>
                  <div>
                    <dt>Codex</dt>
                    <dd>{{ codexInstallation()?.executablePath ?? ('settings.notFound' | t) }}</dd>
                  </div>
                  <div>
                    <dt>{{ 'settings.credentialStorage' | t }}</dt>
                    <dd>Windows Credential Manager</dd>
                  </div>
                  <div>
                    <dt>{{ 'settings.sessionPolicy' | t }}</dt>
                    <dd>{{ 'settings.sessionPolicyValue' | t }}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  class="secondary inline-command btn btn-outline btn-sm"
                  (click)="detectRequested.emit()"
                >
                  <app-icon name="refresh" [size]="13" />{{ 'settings.detectBoth' | t }}
                </button>

                <div class="update-panel">
                  <div class="update-header">
                    <strong>{{ 'update.section' | t }}</strong>
                    <code>{{ updateResult()?.currentVersion ?? '' }}</code>
                  </div>
                  @if (updateError(); as failure) {
                    <small class="update-error">{{ 'update.failed' | t }}: {{ failure }}</small>
                  } @else if (updateResult(); as result) {
                    @if (result.updateAvailable) {
                      <small class="update-available">{{
                        'update.availableBody'
                          | t: { current: result.currentVersion, latest: result.latestVersion }
                      }}</small>
                    } @else {
                      <small>{{ 'update.upToDate' | t }}</small>
                    }
                  }
                  <div class="update-actions">
                    <button
                      type="button"
                      class="secondary inline-command btn btn-outline btn-sm"
                      [disabled]="updateChecking()"
                      (click)="updateCheckRequested.emit()"
                    >
                      <app-icon name="refresh" [size]="13" />{{
                        (updateChecking() ? 'update.checking' : 'update.check') | t
                      }}
                    </button>
                    @if (updateResult()?.updateAvailable) {
                      <button
                        type="button"
                        class="primary btn btn-primary btn-sm"
                        (click)="updateDownloadRequested.emit()"
                      >
                        {{ 'update.download' | t }}
                      </button>
                    }
                  </div>
                  <label class="checkbox-control update-auto">
                    <input
                      type="checkbox"
                      [checked]="autoCheckUpdates()"
                      (change)="autoCheckChanged.emit($any($event.target).checked)"
                    />
                    <span>
                      <strong>{{ 'update.autoCheck' | t }}</strong>
                      <small>{{ 'update.autoCheckHelp' | t }}</small>
                    </span>
                  </label>
                </div>
              </section>
            }
            @case ('cli') {
              <section class="cli-manager">
                <div class="cli-manager-intro">
                  <div>
                    <strong>{{ 'settings.managedCli' | t }}</strong>
                    <span>{{ 'settings.managedCliHelp' | t }}</span>
                  </div>
                  <span class="scope-chip">WORKSPACE</span>
                </div>

                <div
                  class="cli-agent-selector"
                  role="group"
                  [attr.aria-label]="'settings.selectAgentCli' | t"
                >
                  <button
                    type="button"
                    [class.active]="cliAgentType === 'claude'"
                    (click)="selectCliAgent('claude')"
                  >
                    <span><app-icon name="bot" [size]="16" /></span>
                    <strong>Claude Code</strong>
                    <small>{{
                      installation()?.healthy
                        ? (installation()?.version ?? ('settings.installed' | t))
                        : ('common.notDetected' | t)
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
                        ? (codexInstallation()?.version ?? ('settings.installed' | t))
                        : ('common.notDetected' | t)
                    }}</small>
                  </button>
                </div>

                <div class="cli-version-row">
                  <label>
                    <span>{{ 'settings.targetVersion' | t }}</span>
                    <input
                      [attr.aria-label]="'settings.targetVersionAria' | t"
                      [placeholder]="'settings.targetVersionPlaceholder' | t"
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
                    <app-icon name="refresh" [size]="13" />{{ 'settings.generatePlan' | t }}
                  </button>
                </div>

                @if (cliPlanMatches()) {
                  <div class="cli-plan" [class.unavailable]="!cliPlan()?.ready">
                    <div class="cli-plan-heading">
                      <span><app-icon name="shield" [size]="17" /></span>
                      <div>
                        <strong>
                          {{
                            cliPlan()?.action === 'install'
                              ? ('settings.prepareInstall' | t)
                              : ('settings.prepareUpgrade' | t)
                          }}
                          {{ cliPlan()?.displayName }}
                        </strong>
                        <small>{{ cliPlan()?.diagnostic }}</small>
                      </div>
                      <code>{{ cliPlan()?.targetVersion }}</code>
                    </div>
                    <dl>
                      <div>
                        <dt>{{ 'settings.officialPackage' | t }}</dt>
                        <dd>{{ cliPlan()?.packageSpec }}</dd>
                      </div>
                      <div>
                        <dt>{{ 'settings.currentVersion' | t }}</dt>
                        <dd>{{ cliPlan()?.currentVersion ?? ('settings.notInstalled' | t) }}</dd>
                      </div>
                      <div>
                        <dt>npm</dt>
                        <dd>
                          {{ cliPlan()?.npmVersion ?? ('common.unavailable' | t) }} ·
                          {{ cliPlan()?.npmPath ?? ('settings.notFound' | t) }}
                        </dd>
                      </div>
                      <div>
                        <dt>{{ 'settings.activeProxy' | t }}</dt>
                        <dd>
                          {{ cliPlan()?.networkProfileName ?? ('settings.directConnection' | t) }}
                        </dd>
                      </div>
                      <div>
                        <dt>registry</dt>
                        <dd>{{ cliPlan()?.npmRegistry ?? ('settings.defaultRegistry' | t) }}</dd>
                      </div>
                    </dl>
                    <code class="cli-command-preview">{{ cliPlan()?.commandPreview }}</code>

                    <label class="checkbox-control cli-confirmation">
                      <input
                        type="checkbox"
                        [(ngModel)]="cliConfirmed"
                        [disabled]="busy() || !cliPlan()?.ready"
                      />
                      <span>{{ 'settings.confirmCliSource' | t }}</span>
                    </label>
                    <div class="cli-actions">
                      <span>{{ 'settings.cliFailureHelp' | t }}</span>
                      <button
                        type="button"
                        class="primary"
                        [disabled]="busy() || !cliConfirmed || !cliPlan()?.ready"
                        (click)="executeCli()"
                      >
                        {{
                          cliPlan()?.action === 'install'
                            ? ('settings.confirmInstall' | t)
                            : ('settings.confirmUpgrade' | t)
                        }}
                      </button>
                    </div>
                  </div>
                } @else {
                  <div class="cli-empty-state">
                    <app-icon name="terminal" [size]="18" />
                    <span>{{ 'settings.cliEmpty' | t }}</span>
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
                        ·
                        {{
                          profile.authenticated
                            ? ('common.authenticated' | t)
                            : ('common.unauthenticated' | t)
                        }}
                      </small>
                    </button>
                  }
                  <button type="button" class="new-profile" (click)="newAccount()">
                    <app-icon name="plus" [size]="13" />{{ 'settings.addAccount' | t }}
                  </button>
                </div>
                <div class="profile-editor account-editor">
                  <div class="network-intro">
                    <div>
                      <strong>{{ 'settings.accountIsolation' | t }}</strong>
                      <span>{{ 'settings.accountIsolationHelp' | t }}</span>
                    </div>
                    <span class="scope-chip">{{
                      accountAgentType === 'claude' ? 'CLAUDE' : 'CHATGPT'
                    }}</span>
                  </div>

                  <div class="two-columns">
                    <label
                      ><span>{{ 'settings.accountName' | t }}</span
                      ><input [(ngModel)]="accountName"
                    /></label>
                    <label>
                      <span>{{ 'settings.cliType' | t }}</span>
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
                        <strong>{{
                          profile.authenticated
                            ? ('settings.accountSignedIn' | t)
                            : ('settings.accountNotSignedIn' | t)
                        }}</strong>
                        <small>{{ profile.diagnostic }}</small>
                      </span>
                    </div>
                    <label>
                      <span>{{ 'settings.isolatedConfig' | t }}</span>
                      <input
                        readonly
                        [value]="profile.configDir ?? ('settings.systemAccountFolder' | t)"
                      />
                    </label>
                  } @else {
                    <div class="account-status alert">
                      <app-icon name="shield" [size]="16" />
                      <span>
                        <strong>{{ 'settings.loginAfterSave' | t }}</strong>
                        <small>{{ 'settings.loginAfterSaveHelp' | t }}</small>
                      </span>
                    </div>
                  }

                  <label class="checkbox-control editor-checkbox">
                    <input type="checkbox" [(ngModel)]="accountDefault" />
                    <span>{{ 'settings.defaultAccount' | t }}</span>
                  </label>

                  <p class="workspace-binding">
                    {{ 'settings.accountSafety' | t }}
                  </p>

                  <div class="editor-actions account-actions">
                    @if (accountId() && !accountSystem()) {
                      <button
                        type="button"
                        class="danger"
                        [disabled]="busy()"
                        (click)="deleteAccountRequested.emit(accountId())"
                      >
                        <app-icon name="trash" [size]="13" />{{ 'common.delete' | t }}
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
                        <app-icon name="refresh" [size]="13" />{{ 'settings.refreshStatus' | t }}
                      </button>
                      <button
                        type="button"
                        class="secondary"
                        [disabled]="busy()"
                        (click)="accountLoginRequested.emit(accountId())"
                      >
                        <app-icon name="terminal" [size]="13" />{{ 'settings.loginSwitch' | t }}
                      </button>
                    }
                    <button
                      type="button"
                      class="primary"
                      [disabled]="busy() || !accountName.trim()"
                      (click)="saveAccount()"
                    >
                      {{ 'settings.saveAccount' | t }}
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
                      [class.credential-missing]="profile.baseUrl && !profile.hasCredential"
                      (click)="editModel(profile)"
                    >
                      <strong>{{ profile.name }}</strong>
                      <small>{{ profile.provider }} · {{ profile.model }}</small>
                      @if (profile.baseUrl) {
                        <small class="credential-state" [class.ready]="profile.hasCredential">
                          {{
                            profile.hasCredential
                              ? ('settings.keySaved' | t)
                              : ('settings.keyRequired' | t)
                          }}
                        </small>
                      }
                    </button>
                  }
                  <button type="button" class="new-profile" (click)="newModel()">
                    <app-icon name="plus" [size]="13" />{{ 'settings.newProfile' | t }}
                  </button>
                </div>
                <div class="profile-editor">
                  <div class="two-columns">
                    <label
                      ><span>{{ 'settings.name' | t }}</span
                      ><input [(ngModel)]="modelName"
                    /><small class="model-type-label">{{
                        modelName && modelProvider && !baseUrl.trim() && (
                          (modelApiProtocol === 'anthropic' && modelProvider === 'Anthropic') ||
                          (modelApiProtocol === 'openai' && (modelProvider === 'OpenAI' || modelProvider === 'ChatGPT'))
                        )
                          ? ('settings.nativeModel' | t)
                          : ('settings.thirdPartyModel' | t)
                      }}</small></label>
                    <label>
                      <span>{{ 'settings.apiProtocol' | t }}</span>
                      <select
                        [ngModel]="modelApiProtocol"
                        (ngModelChange)="changeApiProtocol($event)"
                      >
                        <option value="anthropic">{{ 'settings.protocolAnthropic' | t }}</option>
                        <option value="openai">{{ 'settings.protocolOpenAI' | t }}</option>
                      </select>
                    </label>
                    <label>
                      <span>{{ 'settings.modelProvider' | t }}</span>
                      <select [ngModel]="modelProvider" (ngModelChange)="selectProvider($event)">
                        @for (preset of filteredPresets(); track preset.provider) {
                          <option [value]="preset.provider">{{ preset.provider }}</option>
                        }
                        @if (!isPresetProvider(modelProvider)) {
                          <option [value]="modelProvider">{{ modelProvider }}</option>
                        }
                      </select>
                    </label>
                    <label
                      ><span>{{ 'settings.model' | t }}</span
                      ><input [(ngModel)]="modelNameValue"
                    /></label>
                  </div>
                  <label>
                    <span>{{ 'settings.endpoint' | t }}</span>
                    <input
                      [placeholder]="'settings.endpointPlaceholder' | t"
                      [(ngModel)]="baseUrl"
                    />
                  </label>
                  <label>
                    <span>API Key</span>
                    <input
                      type="password"
                      [disabled]="clearCredential"
                      [placeholder]="
                        hasCredential()
                          ? ('settings.keySavedPlaceholder' | t)
                          : baseUrl.trim()
                            ? ('settings.keyThirdPartyRequired' | t)
                            : ('settings.keyOfficialOptional' | t)
                      "
                      [(ngModel)]="apiKey"
                    />
                  </label>
                  @if (modelCredentialMissing()) {
                    <div class="credential-warning" role="alert">
                      <app-icon name="triangle-alert" [size]="15" />
                      <div>
                        <strong>{{ 'settings.profileKeyMissing' | t }}</strong>
                        <span>{{ 'settings.profileKeyHelp' | t }}</span>
                      </div>
                    </div>
                  }
                  <label class="checkbox-control editor-checkbox">
                    <input type="checkbox" [(ngModel)]="isDefault" />
                    <span>{{
                      modelApiProtocol === 'anthropic'
                        ? ('settings.defaultClaudeProfile' | t)
                        : ('settings.defaultCodexProfile' | t)
                    }}</span>
                  </label>
                  @if (hasCredential()) {
                    <label class="checkbox-control editor-checkbox">
                      <input type="checkbox" [(ngModel)]="clearCredential" />
                      <span>{{ 'settings.clearKey' | t }}</span>
                    </label>
                  }
                  <div class="editor-actions">
                    @if (modelId() && modelId() !== 'claude-default') {
                      <button
                        type="button"
                        class="danger"
                        (click)="deleteModelRequested.emit(modelId())"
                      >
                        <app-icon name="trash" [size]="13" />{{ 'common.delete' | t }}
                      </button>
                    }
                    <span></span>
                    <button
                      type="button"
                      class="primary"
                      [disabled]="busy() || !canSaveModel()"
                      (click)="saveModel()"
                    >
                      {{ 'settings.saveProfile' | t }}
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
                      <small>{{ 'settings.independentMcp' | t }}</small>
                    </button>
                  }
                  <button type="button" class="new-profile" (click)="newMcp()">
                    <app-icon name="plus" [size]="13" />{{ 'settings.newMcp' | t }}
                  </button>
                </div>
                <div class="profile-editor">
                  <label
                    ><span>{{ 'settings.name' | t }}</span
                    ><input [(ngModel)]="mcpName"
                  /></label>
                  <label class="json-field">
                    <span>{{ 'settings.configJson' | t }}</span>
                    <textarea spellcheck="false" [(ngModel)]="mcpConfig"></textarea>
                  </label>
                  <div class="editor-actions">
                    @if (mcpId()) {
                      <button
                        type="button"
                        class="danger"
                        (click)="deleteMcpRequested.emit(mcpId())"
                      >
                        <app-icon name="trash" [size]="13" />{{ 'common.delete' | t }}
                      </button>
                    }
                    <span></span>
                    <button
                      type="button"
                      class="primary"
                      [disabled]="!mcpName.trim() || !mcpConfig.trim()"
                      (click)="saveMcp()"
                    >
                      {{ 'settings.saveMcp' | t }}
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
                        {{ profile.scope === 'global' ? ('settings.global' | t) : 'Workspace' }}
                        ·
                        {{ profile.enabled ? ('settings.enabled' | t) : ('settings.disabled' | t) }}
                      </small>
                    </button>
                  }
                  <button type="button" class="new-profile" (click)="newNetwork()">
                    <app-icon name="plus" [size]="13" />{{ 'settings.newProxy' | t }}
                  </button>
                </div>
                <div class="profile-editor network-editor">
                  <div class="network-intro">
                    <div>
                      <strong>{{ 'settings.devNetwork' | t }}</strong>
                      <span>{{ 'settings.devNetworkHelp' | t }}</span>
                    </div>
                    <span class="scope-chip">{{
                      networkScope === 'global' ? 'GLOBAL' : 'WORKSPACE'
                    }}</span>
                  </div>

                  <div class="two-columns">
                    <label
                      ><span>{{ 'settings.name' | t }}</span
                      ><input [(ngModel)]="networkName"
                    /></label>
                    <label>
                      <span>{{ 'settings.scope' | t }}</span>
                      <select [(ngModel)]="networkScope" (ngModelChange)="changeNetworkScope()">
                        <option value="workspace">{{ 'settings.currentWorkspace' | t }}</option>
                        <option value="global">{{ 'settings.globalDefault' | t }}</option>
                      </select>
                    </label>
                  </div>
                  @if (networkScope === 'workspace') {
                    <p class="workspace-binding">
                      {{ 'settings.boundTo' | t: { name: networkWorkspaceLabel() } }}
                    </p>
                  }

                  <div class="network-section">
                    <h3>{{ 'settings.systemAgentProxy' | t }}</h3>
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
                      <span>{{ 'settings.enterpriseCa' | t }}</span>
                      <input placeholder="C:\\certs\\internal-ca.pem" [(ngModel)]="npmCaPath" />
                    </label>
                  </div>

                  <div class="network-section">
                    <h3>{{ 'settings.proxyCredentials' | t }}</h3>
                    <div class="two-columns">
                      <label
                        ><span>{{ 'settings.username' | t }}</span
                        ><input [(ngModel)]="proxyUsername"
                      /></label>
                      <label>
                        <span>{{ 'settings.password' | t }}</span>
                        <input
                          type="password"
                          [placeholder]="
                            hasNetworkCredential()
                              ? ('settings.keySavedPlaceholder' | t)
                              : ('settings.passwordOptional' | t)
                          "
                          [(ngModel)]="proxyPassword"
                        />
                      </label>
                    </div>
                    @if (hasNetworkCredential()) {
                      <label class="checkbox-control editor-checkbox">
                        <input type="checkbox" [(ngModel)]="clearNetworkCredential" />
                        <span>{{ 'settings.clearProxyPassword' | t }}</span>
                      </label>
                    }
                  </div>

                  <div class="network-options">
                    <label class="checkbox-control">
                      <input type="checkbox" [(ngModel)]="networkEnabled" />
                      <span>{{ 'settings.enableProfile' | t }}</span>
                    </label>
                    <label class="checkbox-control">
                      <input type="checkbox" [(ngModel)]="networkDefault" />
                      <span>{{ 'settings.defaultForScope' | t }}</span>
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
                        <app-icon name="trash" [size]="13" />{{ 'common.delete' | t }}
                      </button>
                    }
                    <span></span>
                    <button
                      type="button"
                      class="secondary"
                      [disabled]="busy() || !networkId()"
                      (click)="networkTestRequested.emit(networkId())"
                    >
                      <app-icon name="radio" [size]="13" />{{ 'settings.testConnection' | t }}
                    </button>
                    <button
                      type="button"
                      class="primary"
                      [disabled]="busy() || !canSaveNetwork()"
                      (click)="saveNetwork()"
                    >
                      {{ 'settings.saveProxy' | t }}
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
  private readonly i18n = inject(I18nService);
  readonly installation = input<AgentInstallation | null>(null);
  readonly codexInstallation = input<AgentInstallation | null>(null);
  readonly modelProfiles = input<ModelProfile[]>([]);
  readonly mcpProfiles = input<McpProfile[]>([]);
  readonly networkProfiles = input<NetworkProfile[]>([]);
  readonly accountProfiles = input<AccountProfile[]>([]);
  readonly activeWorkspaceId = input('');
  readonly activeWorkspaceName = input('');
  readonly initialTab = input<SettingsTab>('diagnostics');
  readonly initialModelProfileId = input('');
  readonly networkTestResult = input<NetworkTestResult | null>(null);
  readonly cliPlan = input<CliOperationPlan | null>(null);
  readonly cliResult = input<CliOperationResult | null>(null);
  readonly busy = input(false);
  readonly updateResult = input<UpdateCheck | null>(null);
  readonly updateChecking = input(false);
  readonly updateError = input<string | null>(null);
  readonly autoCheckUpdates = input(true);
  readonly cancelled = output<void>();
  readonly detectRequested = output<void>();
  readonly updateCheckRequested = output<void>();
  readonly updateDownloadRequested = output<void>();
  readonly autoCheckChanged = output<boolean>();
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
  protected readonly allPresets = PROVIDER_PRESETS;
  protected cliAgentType: NativeAgentType = 'claude';
  protected cliTargetVersion = 'latest';
  protected cliConfirmed = false;
  protected modelName = 'Claude Sonnet';
  protected modelProvider = 'Anthropic';
  protected modelNameValue = 'sonnet';
  protected modelApiProtocol: 'anthropic' | 'openai' = 'anthropic';
  protected baseUrl = '';
  protected apiKey = '';
  protected isDefault = true;
  protected clearCredential = false;
  protected mcpName = '';
  protected mcpConfig = '{\n  "mcpServers": {}\n}';
  protected networkName = this.i18n.t('settings.workspaceProxy');
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
  private initialSelectionApplied = false;

  constructor() {
    effect(() => {
      if (this.initialSelectionApplied) {
        return;
      }
      const requestedTab = this.initialTab();
      const requestedModelId = this.initialModelProfileId();
      const profiles = this.modelProfiles();
      const requestedProfile = requestedModelId
        ? profiles.find((profile) => profile.id === requestedModelId)
        : undefined;
      if (requestedModelId && !requestedProfile) {
        return;
      }
      this.initialSelectionApplied = true;
      this.tab.set(requestedTab);
      if (requestedProfile) {
        this.editModel(requestedProfile);
      }
    });
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
    this.modelApiProtocol = profile.apiProtocol;
    this.baseUrl = profile.baseUrl ?? '';
    this.apiKey = '';
    this.isDefault = profile.isDefault;
    this.clearCredential = false;
    this.hasCredential.set(profile.hasCredential);
  }

  protected newModel(): void {
    this.modelId.set('');
    this.modelApiProtocol = 'anthropic';
    this.selectProvider('Anthropic');
    this.apiKey = '';
    this.isDefault = false;
    this.clearCredential = false;
    this.hasCredential.set(false);
  }

  protected saveModel(): void {
    if (!this.canSaveModel()) {
      return;
    }
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
      apiProtocol: this.modelApiProtocol,
      isDefault: this.isDefault,
    });
  }

  protected selectProvider(provider: string): void {
    this.modelProvider = provider;
    const preset = this.allPresets.find(
      (item) => item.provider === provider && item.apiProtocol === this.modelApiProtocol,
    );
    if (!preset) {
      return;
    }
    this.modelName = preset.name;
    this.modelNameValue = preset.model;
    this.baseUrl = preset.baseUrl;
  }

  protected changeApiProtocol(protocol: 'anthropic' | 'openai'): void {
    this.modelApiProtocol = protocol;
    const currentPreset = this.allPresets.find(
      (item) => item.provider === this.modelProvider && item.apiProtocol === protocol,
    );
    if (currentPreset) {
      this.selectProvider(currentPreset.provider);
    } else {
      const firstPreset = this.filteredPresets()[0];
      if (firstPreset) {
        this.selectProvider(firstPreset.provider);
      }
    }
  }

  protected filteredPresets(): readonly ProviderPreset[] {
    return this.allPresets.filter((item) => item.apiProtocol === this.modelApiProtocol);
  }

  protected isPresetProvider(provider: string): boolean {
    return this.allPresets.some(
      (item) => item.provider === provider && item.apiProtocol === this.modelApiProtocol,
    );
  }

  protected modelCredentialMissing(): boolean {
    return (
      Boolean(this.baseUrl.trim()) &&
      (!this.hasCredential() || this.clearCredential) &&
      !this.apiKey.trim()
    );
  }

  protected canSaveModel(): boolean {
    return (
      Boolean(this.modelName.trim()) &&
      Boolean(this.modelNameValue.trim()) &&
      !this.modelCredentialMissing()
    );
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
    this.networkName = this.i18n.t(
      this.activeWorkspaceId() ? 'settings.workspaceProxy' : 'settings.globalProxy',
    );
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
      return this.i18n.t('settings.noWorkspace');
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
