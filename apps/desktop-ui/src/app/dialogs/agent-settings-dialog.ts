import { ProfileDrafts, type ProfileSaveCompleted } from './profile-drafts';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  AccountAgentType,
  AccountProfile,
  AccountProfileInput,
  AgentInstallation,
  CliOperationPlan,
  CliOperationRequest,
  CliOperationResult,
  CLAUDE_EFFORT_LEVELS,
  CODEX_REASONING_EFFORT_LEVELS,
  CUSTOM_PROVIDER,
  findProviderPreset,
  groupProfilesByProvider,
  McpProfile,
  McpProfileInput,
  ModelProfile,
  ModelProfileInput,
  NetworkProfile,
  NetworkProfileInput,
  NetworkProfileScope,
  NetworkTestResult,
  type CliInstaller,
  MANAGED_AGENT_INSTALLERS,
  ManagedAgentType,
  PROVIDER_PRESETS,
} from '../core/models/agent.models';
import { createId } from '../core/models/identifiers';
import { UpdateCheck } from '../core/services/update.service';
import { ModalFocusDirective } from '../shared/modal-focus.directive';
import { IconComponent } from '../shared/icon/icon';
import { RemoteAccessPanelComponent } from './remote-access-panel';
import { AntigravityStatusToggleComponent } from './antigravity-status-toggle';
import { StoragePanelComponent } from './storage-panel';
import { AGENT_ICONS } from '../core/models/workspace.models';

export type SettingsTab =
  'diagnostics' | 'cli' | 'accounts' | 'models' | 'mcp' | 'network' | 'remote' | 'storage';

interface ModelEditorDraft {
  modelName: string;
  modelProvider: string;
  claudeEnabled: boolean;
  claudeModel: string;
  claudeBaseUrl: string;
  codexEnabled: boolean;
  codexModel: string;
  codexBaseUrl: string;
  claudeContext1m: boolean;
  claudeEffort: string;
  codexReasoningEffort: string;
  apiKey: string;
  isDefault: boolean;
  clearCredential: boolean;
  modelPlanAlertThreshold: number;
}

/** Matches the backend default for a profile that has never had a threshold set. */
const DEFAULT_ALERT_THRESHOLD = 80;

@Component({
  selector: 'app-agent-settings-dialog',
  imports: [
    ModalFocusDirective,
    FormsModule,
    IconComponent,
    AntigravityStatusToggleComponent,
    RemoteAccessPanelComponent,
    StoragePanelComponent,
    TranslatePipe,
  ],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="requestClose()">
      <section
        class="agent-dialog settings-dialog modal-box"
        appModal
        (dismissModal)="requestClose()"
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
            (click)="requestClose()"
          >
            <app-icon name="x" [size]="15" />
          </button>
        </header>

        <nav class="settings-tabs tabs tabs-border" [attr.aria-label]="'settings.categories' | t">
          @for (category of categories; track category.id) {
            <button
              type="button"
              class="tab"
              [class.active]="tab() === category.id"
              [attr.aria-current]="tab() === category.id ? 'page' : null"
              (click)="selectTab(category.id)"
            >
              {{ category.label | t }}
            </button>
          }
        </nav>
        <select
          class="settings-category-select"
          [attr.aria-label]="'settings.categories' | t"
          [ngModel]="tab()"
          (ngModelChange)="selectTab($event)"
        >
          @for (category of categories; track category.id) {
            <option [value]="category.id">{{ category.label | t }}</option>
          }
        </select>
        @if (confirmClose()) {
          <div class="unsaved-notice" role="alert">
            <span>{{ 'settings.unsavedClose' | t }}</span>
            <button type="button" class="secondary" (click)="confirmClose.set(false)">
              {{ 'settings.keepEditing' | t }}
            </button>
            <button type="button" class="danger" (click)="discardChanges()" [disabled]="saving()">
              {{ 'settings.discardClose' | t }}
            </button>
          </div>
        }
        <div class="settings-body">
          @switch (tab()) {
            @case ('diagnostics') {
              <section class="diagnostic-panel card">
                <div class="diagnostic-status alert" [class.unavailable]="!installation()?.healthy">
                  <span><app-icon [name]="agentIcons.claude" [size]="18" /></span>
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
                  <span><app-icon [name]="agentIcons.codex" [size]="18" /></span>
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
                <div
                  class="diagnostic-status alert"
                  [class.unavailable]="!openCodeInstallation()?.healthy"
                >
                  <span><app-icon [name]="agentIcons.opencode" [size]="18" /></span>
                  <div>
                    <strong>{{
                      openCodeInstallation()?.healthy
                        ? ('settings.available' | t: { name: 'OpenCode' })
                        : ('settings.unavailable' | t: { name: 'OpenCode' })
                    }}</strong>
                    <small>{{
                      openCodeInstallation()?.diagnostic ?? ('settings.awaitingDetection' | t)
                    }}</small>
                  </div>
                  <code>{{ openCodeInstallation()?.version ?? ('common.notDetected' | t) }}</code>
                </div>
                <div
                  class="diagnostic-status alert"
                  [class.unavailable]="!antigravityInstallation()?.healthy"
                >
                  <span><app-icon [name]="agentIcons.antigravity" [size]="18" /></span>
                  <div>
                    <strong>{{
                      antigravityInstallation()?.healthy
                        ? ('settings.available' | t: { name: 'Antigravity' })
                        : ('settings.unavailable' | t: { name: 'Antigravity' })
                    }}</strong>
                    <small>{{
                      antigravityInstallation()?.diagnostic ?? ('settings.awaitingDetection' | t)
                    }}</small>
                  </div>
                  <code>{{
                    antigravityInstallation()?.version ?? ('common.notDetected' | t)
                  }}</code>
                </div>
                <app-antigravity-status-toggle />
                <details class="diagnostic-details">
                  <summary>{{ 'settings.diagnosticDetails' | t }}</summary>
                  <dl>
                    <div>
                      <dt>Claude</dt>
                      <dd>{{ installation()?.executablePath ?? ('settings.notFound' | t) }}</dd>
                    </div>
                    <div>
                      <dt>Codex</dt>
                      <dd>
                        {{ codexInstallation()?.executablePath ?? ('settings.notFound' | t) }}
                      </dd>
                    </div>
                    <div>
                      <dt>OpenCode</dt>
                      <dd>
                        {{ openCodeInstallation()?.executablePath ?? ('settings.notFound' | t) }}
                      </dd>
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
                </details>
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
                    @if (updateResult(); as result) {
                      @if (result.updateAvailable) {
                        <!-- An npm build can replace itself; an installed one goes to the page. -->
                        @if (result.installedViaNpm) {
                          <button
                            type="button"
                            class="primary btn btn-primary btn-sm"
                            [disabled]="updateInstalling()"
                            (click)="updateNpmRequested.emit()"
                          >
                            @if (updateInstalling()) {
                              <span class="cli-spinner" aria-hidden="true"></span>
                            }
                            {{ (updateInstalling() ? 'update.installing' : 'update.install') | t }}
                          </button>
                        }
                        <button
                          type="button"
                          class="secondary inline-command btn btn-outline btn-sm"
                          (click)="updateDownloadRequested.emit()"
                        >
                          {{ 'update.download' | t }}
                        </button>
                      }
                    }
                  </div>
                  @if (updateResult()?.updateAvailable && updateResult()?.installedViaNpm) {
                    <small class="update-npm-note">{{ 'update.installHint' | t }}</small>
                  }
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
                    <span><app-icon [name]="agentIcons.claude" [size]="16" /></span>
                    <strong>Claude Code</strong>
                    <small>{{
                      installation()?.healthy
                        ? (installation()?.version ?? ('settings.installed' | t))
                        : ('common.notDetected' | t)
                    }}</small>
                  </button>
                  <button
                    type="button"
                    [class.active]="cliAgentType === 'opencode'"
                    (click)="selectCliAgent('opencode')"
                  >
                    <span><app-icon [name]="agentIcons.opencode" [size]="16" /></span>
                    <strong>OpenCode</strong>
                    <small>{{
                      openCodeInstallation()?.healthy
                        ? (openCodeInstallation()?.version ?? ('settings.installed' | t))
                        : ('common.notDetected' | t)
                    }}</small>
                  </button>
                  <button
                    type="button"
                    [class.active]="cliAgentType === 'codex'"
                    (click)="selectCliAgent('codex')"
                  >
                    <span><app-icon [name]="agentIcons.codex" [size]="16" /></span>
                    <strong>Codex CLI</strong>
                    <small>{{
                      codexInstallation()?.healthy
                        ? (codexInstallation()?.version ?? ('settings.installed' | t))
                        : ('common.notDetected' | t)
                    }}</small>
                  </button>
                  <button
                    type="button"
                    [class.active]="cliAgentType === 'antigravity'"
                    (click)="selectCliAgent('antigravity')"
                  >
                    <span><app-icon [name]="agentIcons.antigravity" [size]="16" /></span>
                    <strong>Antigravity</strong>
                    <small>{{
                      antigravityInstallation()?.healthy
                        ? (antigravityInstallation()?.version ?? ('settings.installed' | t))
                        : ('common.notDetected' | t)
                    }}</small>
                  </button>
                </div>

                <div class="cli-version-row">
                  @if (cliInstallers().length > 1) {
                    <div
                      class="cli-installer"
                      role="tablist"
                      [attr.aria-label]="'settings.installVia' | t"
                    >
                      @for (installer of cliInstallers(); track installer) {
                        <button
                          type="button"
                          role="tab"
                          [class.active]="cliInstaller === installer"
                          [attr.aria-selected]="cliInstaller === installer"
                          (click)="selectCliInstaller(installer)"
                        >
                          {{
                            (installer === 'script'
                              ? 'settings.installerScript'
                              : 'settings.installerNpm'
                            ) | t
                          }}
                        </button>
                      }
                    </div>
                  }
                  @if (cliTakesVersion()) {
                    <label>
                      <span>{{ 'settings.targetVersion' | t }}</span>
                      <input
                        [attr.aria-label]="'settings.targetVersionAria' | t"
                        [placeholder]="'settings.targetVersionPlaceholder' | t"
                        [(ngModel)]="cliTargetVersion"
                        (ngModelChange)="cliConfirmed = false"
                      />
                    </label>
                  } @else {
                    <small class="cli-installer-note">{{
                      'settings.scriptInstallerHelp' | t
                    }}</small>
                  }
                  <button
                    type="button"
                    class="secondary"
                    [disabled]="busy() || (cliTakesVersion() && !cliTargetVersion.trim())"
                    (click)="previewCli()"
                  >
                    <app-icon name="refresh" [size]="13" />{{ 'settings.generatePlan' | t }}
                  </button>
                </div>

                @if (cliPlanMatches()) {
                  <div
                    class="cli-plan"
                    [class.unavailable]="!cliPlan()?.ready"
                    [class.up-to-date]="cliPlan()?.upToDate"
                  >
                    <div class="cli-plan-heading">
                      <span>
                        <app-icon [name]="cliPlan()?.upToDate ? 'check' : 'shield'" [size]="17" />
                      </span>
                      <div>
                        <strong>
                          {{ planHeadline() }}
                          {{ cliPlan()?.displayName }}
                        </strong>
                        <small>{{ cliPlan()?.diagnostic }}</small>
                      </div>
                      @if (cliPlan()?.installer !== 'script') {
                        <code>{{ cliPlan()?.resolvedVersion ?? cliPlan()?.targetVersion }}</code>
                      }
                    </div>
                    <dl>
                      <div>
                        <dt>
                          {{
                            (cliPlan()?.installer === 'script'
                              ? 'settings.officialInstaller'
                              : 'settings.officialPackage'
                            ) | t
                          }}
                        </dt>
                        <dd>{{ cliPlan()?.packageSpec }}</dd>
                      </div>
                      <div>
                        <dt>{{ 'settings.currentVersion' | t }}</dt>
                        <dd>{{ cliPlan()?.currentVersion ?? ('settings.notInstalled' | t) }}</dd>
                      </div>
                      @if (cliPlan()?.resolvedVersion) {
                        <div>
                          <dt>{{ 'settings.latestVersion' | t }}</dt>
                          <dd>{{ cliPlan()?.resolvedVersion }}</dd>
                        </div>
                      }
                      @if (cliPlan()?.installer !== 'script') {
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
                      }
                    </dl>
                    <code class="cli-command-preview">{{ cliPlan()?.commandPreview }}</code>

                    <label class="checkbox-control cli-confirmation">
                      <input
                        type="checkbox"
                        [(ngModel)]="cliConfirmed"
                        [disabled]="busy() || !cliPlan()?.ready"
                      />
                      <span>{{
                        (cliPlan()?.installer === 'script'
                          ? 'settings.confirmScriptSource'
                          : 'settings.confirmCliSource'
                        ) | t
                      }}</span>
                    </label>
                    <div class="cli-actions">
                      <span>{{
                        (cliPlan()?.installer === 'script'
                          ? 'settings.scriptFailureHelp'
                          : 'settings.cliFailureHelp'
                        ) | t
                      }}</span>
                      <button
                        type="button"
                        class="primary"
                        [disabled]="busy() || !cliConfirmed || !cliPlan()?.ready"
                        (click)="executeCli()"
                      >
                        @if (busy()) {
                          <span class="cli-spinner" aria-hidden="true"></span>
                        }
                        {{ confirmLabel() }}
                      </button>
                    </div>

                    @if (busy()) {
                      <!-- npm reports no percentage, so the bar animates rather than fills. -->
                      <div
                        class="cli-progress"
                        role="progressbar"
                        [attr.aria-label]="'settings.cliRunning' | t"
                      >
                        <i></i>
                      </div>
                      <small class="cli-progress-note">{{ 'settings.cliRunningHelp' | t }}</small>
                    }
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
                  <div class="profile-fields">
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
                      <div
                        class="account-status alert"
                        [class.unavailable]="!profile.authenticated"
                      >
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

                    @if (accountId() && copySourceCandidates().length > 0) {
                      <div class="account-copy">
                        <label>
                          <span>{{ 'settings.copyConfig' | t }}</span>
                          <select
                            [ngModel]="copySourceId()"
                            (ngModelChange)="copySourceId.set($event)"
                          >
                            <option value="">{{ 'settings.copyConfigPick' | t }}</option>
                            @for (candidate of copySourceCandidates(); track candidate.id) {
                              <option [value]="candidate.id">{{ candidate.name }}</option>
                            }
                          </select>
                        </label>
                        <button
                          type="button"
                          class="secondary"
                          [disabled]="busy() || !copySourceId()"
                          (click)="requestConfigCopy()"
                        >
                          <app-icon name="download" [size]="13" />{{
                            'settings.copyConfigAction' | t
                          }}
                        </button>
                        <small>{{ 'settings.copyConfigHelp' | t }}</small>
                      </div>
                    }

                    <p class="workspace-binding">
                      {{ 'settings.accountSafety' | t }}
                    </p>
                  </div>
                  <div class="editor-actions account-actions">
                    @if (accountDirty()) {
                      <small class="draft-status" role="status">{{ 'settings.unsaved' | t }}</small>
                    }
                    @if (accountId() && !accountSystem()) {
                      @if (pendingAccountDelete() === accountId()) {
                        <div class="inline-confirm" role="alert">
                          <p>{{ 'settings.deleteAccountConfirm' | t }}</p>
                          <div class="inline-confirm-actions">
                            <button
                              type="button"
                              class="secondary"
                              [disabled]="busy()"
                              (click)="pendingAccountDelete.set(null)"
                            >
                              {{ 'common.cancel' | t }}
                            </button>
                            <button
                              type="button"
                              class="danger"
                              [disabled]="busy()"
                              (click)="confirmDeleteAccount()"
                            >
                              {{ 'common.delete' | t }}
                            </button>
                          </div>
                        </div>
                      } @else {
                        <button
                          type="button"
                          class="danger"
                          [disabled]="busy()"
                          (click)="pendingAccountDelete.set(accountId())"
                        >
                          <app-icon name="trash" [size]="13" />{{ 'common.delete' | t }}
                        </button>
                      }
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
                  @for (group of groupedProfiles(); track group.provider) {
                    <p class="provider-group">{{ group.label }}</p>
                    @for (profile of group.profiles; track profile.id) {
                      <button
                        type="button"
                        [class.active]="profile.id === modelId()"
                        [class.credential-missing]="profileMissingKey(profile)"
                        (click)="editModel(profile)"
                      >
                        <strong>{{ profile.name }}</strong>
                        <small class="agent-badges">
                          @if (profile.claudeEnabled) {
                            <em>Claude · {{ profile.claudeModel }}</em>
                          }
                          @if (profile.codexEnabled) {
                            <em>Codex · {{ profile.codexModel }}</em>
                          }
                        </small>
                        @if (profileUsesEndpoint(profile)) {
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
                  }
                  <button type="button" class="new-profile" (click)="newModel()">
                    <app-icon name="plus" [size]="13" />{{ 'settings.newProfile' | t }}
                  </button>
                </div>
                <div class="profile-editor">
                  <div class="profile-fields">
                    <div class="two-columns">
                      <label
                        ><span>{{ 'settings.name' | t }}</span
                        ><input [(ngModel)]="modelName"
                      /></label>
                      <label>
                        <span>{{ 'settings.modelProvider' | t }}</span>
                        <select [ngModel]="modelProvider" (ngModelChange)="selectProvider($event)">
                          @for (preset of allPresets; track preset.provider) {
                            <option [value]="preset.provider">{{ preset.label }}</option>
                          }
                          @if (!isPresetProvider(modelProvider)) {
                            <option [value]="modelProvider">{{ modelProvider }}</option>
                          }
                        </select>
                      </label>
                    </div>
                    @if (presetDocsUrl()) {
                      <small class="preset-source">{{
                        'settings.presetSource' | t: { url: presetDocsUrl() }
                      }}</small>
                    }

                    <!-- One provider, two protocols: each agent gets its own endpoint and switch. -->
                    <fieldset class="agent-endpoint" [class.disabled]="!claudeEnabled">
                      <label class="checkbox-control">
                        <input type="checkbox" [(ngModel)]="claudeEnabled" />
                        <span>{{ 'settings.enableForClaude' | t }}</span>
                      </label>
                      <div class="two-columns">
                        <label
                          ><span>{{ 'settings.model' | t }}</span
                          ><input [disabled]="!claudeEnabled" [(ngModel)]="claudeModel"
                        /></label>
                        <label
                          ><span>{{ 'settings.endpointAnthropic' | t }}</span
                          ><input
                            [disabled]="!claudeEnabled"
                            [placeholder]="'settings.endpointPlaceholder' | t"
                            [(ngModel)]="claudeBaseUrl"
                        /></label>
                      </div>
                      <div class="two-columns">
                        <label
                          ><span>{{ 'settings.effortLevel' | t }}</span
                          ><select [disabled]="!claudeEnabled" [(ngModel)]="claudeEffort">
                            <option value="">{{ 'settings.effortDefault' | t }}</option>
                            @for (level of claudeEffortLevels; track level) {
                              <option [value]="level">{{ level }}</option>
                            }
                          </select>
                        </label>
                        <label class="checkbox-control" [title]="'settings.context1mHelp' | t"
                          ><input
                            type="checkbox"
                            [disabled]="!claudeEnabled"
                            [(ngModel)]="claudeContext1m"
                          /><span>{{ 'settings.context1m' | t }}</span></label
                        >
                      </div>
                    </fieldset>
                    <fieldset class="agent-endpoint" [class.disabled]="!codexEnabled">
                      <label class="checkbox-control">
                        <input type="checkbox" [(ngModel)]="codexEnabled" />
                        <span>{{ 'settings.enableForCodex' | t }}</span>
                      </label>
                      <div class="two-columns">
                        <label
                          ><span>{{ 'settings.model' | t }}</span
                          ><input [disabled]="!codexEnabled" [(ngModel)]="codexModel"
                        /></label>
                        <label
                          ><span>{{ 'settings.endpointOpenAI' | t }}</span
                          ><input
                            [disabled]="!codexEnabled"
                            [placeholder]="'settings.endpointPlaceholder' | t"
                            [(ngModel)]="codexBaseUrl"
                        /></label>
                      </div>
                      <div class="two-columns">
                        <label
                          ><span>{{ 'settings.effortLevel' | t }}</span
                          ><select [disabled]="!codexEnabled" [(ngModel)]="codexReasoningEffort">
                            <option value="">{{ 'settings.effortDefault' | t }}</option>
                            @for (level of codexEffortLevels; track level) {
                              <option [value]="level">{{ level }}</option>
                            }
                          </select>
                        </label>
                      </div>
                    </fieldset>
                    <label>
                      <span>API Key</span>
                      <input
                        type="password"
                        [disabled]="clearCredential"
                        [placeholder]="
                          hasCredential()
                            ? ('settings.keySavedPlaceholder' | t)
                            : usesEndpoint()
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
                    <fieldset class="agent-endpoint">
                      <legend>{{ 'settings.planMonitoring' | t }}</legend>
                      <label
                        ><span>{{ 'settings.planAlertThreshold' | t }}</span
                        ><input
                          type="number"
                          min="1"
                          max="100"
                          [(ngModel)]="modelPlanAlertThreshold"
                      /></label>
                      <small class="preset-source">{{ 'settings.planQuotaHelp' | t }}</small>
                    </fieldset>
                    <label class="checkbox-control editor-checkbox">
                      <input type="checkbox" [(ngModel)]="isDefault" />
                      <span>{{ 'settings.defaultProfile' | t }}</span>
                    </label>
                    @if (hasCredential()) {
                      <label class="checkbox-control editor-checkbox">
                        <input type="checkbox" [(ngModel)]="clearCredential" />
                        <span>{{ 'settings.clearKey' | t }}</span>
                      </label>
                    }
                  </div>
                  <div class="editor-actions">
                    @if (modelDirty()) {
                      <small class="draft-status" role="status">{{ 'settings.unsaved' | t }}</small>
                    }
                    @if (modelId() && modelId() !== 'claude-default') {
                      @if (pendingModelDelete() === modelId()) {
                        <div class="inline-confirm" role="alert">
                          <p>{{ 'settings.deleteModelConfirm' | t }}</p>
                          <div class="inline-confirm-actions">
                            <button
                              type="button"
                              class="secondary"
                              [disabled]="busy()"
                              (click)="pendingModelDelete.set(null)"
                            >
                              {{ 'common.cancel' | t }}
                            </button>
                            <button
                              type="button"
                              class="danger"
                              [disabled]="busy()"
                              (click)="confirmDeleteModel()"
                            >
                              {{ 'common.delete' | t }}
                            </button>
                          </div>
                        </div>
                      } @else {
                        <button
                          type="button"
                          class="danger"
                          [disabled]="busy()"
                          (click)="pendingModelDelete.set(modelId())"
                        >
                          <app-icon name="trash" [size]="13" />{{ 'common.delete' | t }}
                        </button>
                      }
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
                  <div class="profile-fields">
                    <label
                      ><span>{{ 'settings.name' | t }}</span
                      ><input [(ngModel)]="mcpName"
                    /></label>
                    <label class="json-field">
                      <span>{{ 'settings.configJson' | t }}</span>
                      <textarea
                        spellcheck="false"
                        [(ngModel)]="mcpConfig"
                        [attr.aria-invalid]="mcpError() ? true : null"
                        [attr.aria-describedby]="mcpError() ? 'mcp-error' : null"
                      ></textarea>
                      @if (mcpError(); as error) {
                        <small id="mcp-error" class="field-error" role="alert">{{ error }}</small>
                      }
                    </label>
                  </div>
                  <div class="editor-actions">
                    @if (mcpDirty()) {
                      <small class="draft-status" role="status">{{ 'settings.unsaved' | t }}</small>
                    }
                    @if (mcpId()) {
                      @if (pendingMcpDelete() === mcpId()) {
                        <div class="inline-confirm" role="alert">
                          <p>{{ 'settings.deleteMcpConfirm' | t }}</p>
                          <div class="inline-confirm-actions">
                            <button
                              type="button"
                              class="secondary"
                              [disabled]="busy()"
                              (click)="pendingMcpDelete.set(null)"
                            >
                              {{ 'common.cancel' | t }}
                            </button>
                            <button
                              type="button"
                              class="danger"
                              [disabled]="busy()"
                              (click)="confirmDeleteMcp()"
                            >
                              {{ 'common.delete' | t }}
                            </button>
                          </div>
                        </div>
                      } @else {
                        <button
                          type="button"
                          class="danger"
                          [disabled]="busy()"
                          (click)="pendingMcpDelete.set(mcpId())"
                        >
                          <app-icon name="trash" [size]="13" />{{ 'common.delete' | t }}
                        </button>
                      }
                    }
                    <span></span>
                    <button
                      type="button"
                      class="primary"
                      [disabled]="busy() || !mcpName.trim() || !!mcpError()"
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
                  <div class="profile-fields">
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
                          <input
                            placeholder="http://proxy.internal:8080"
                            [(ngModel)]="httpsProxy"
                          />
                          <small class="field-hint">{{ 'settings.httpsProxyHint' | t }}</small>
                        </label>
                        <label>
                          <span>ALL_PROXY / SOCKS</span>
                          <input placeholder="socks5://127.0.0.1:1080" [(ngModel)]="allProxy" />
                        </label>
                        <label>
                          <span>NO_PROXY</span>
                          <input placeholder="localhost,.internal.example" [(ngModel)]="noProxy" />
                          <small class="field-hint">{{ 'settings.noProxyHint' | t }}</small>
                        </label>
                      </div>
                    </div>

                    <div class="network-section">
                      <h3>npm</h3>
                      <label>
                        <span>registry</span>
                        <input
                          placeholder="https://registry.npmjs.org/"
                          [(ngModel)]="npmRegistry"
                        />
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
                  </div>
                  <div class="editor-actions network-actions">
                    @if (networkDirty()) {
                      <small class="draft-status" role="status">{{ 'settings.unsaved' | t }}</small>
                    }
                    @if (networkId()) {
                      @if (pendingNetworkDelete() === networkId()) {
                        <div class="inline-confirm" role="alert">
                          <p>{{ 'settings.deleteNetworkConfirm' | t }}</p>
                          <div class="inline-confirm-actions">
                            <button
                              type="button"
                              class="secondary"
                              [disabled]="busy()"
                              (click)="pendingNetworkDelete.set(null)"
                            >
                              {{ 'common.cancel' | t }}
                            </button>
                            <button
                              type="button"
                              class="danger"
                              [disabled]="busy()"
                              (click)="confirmDeleteNetwork()"
                            >
                              {{ 'common.delete' | t }}
                            </button>
                          </div>
                        </div>
                      } @else {
                        <button
                          type="button"
                          class="danger"
                          [disabled]="busy()"
                          (click)="pendingNetworkDelete.set(networkId())"
                        >
                          <app-icon name="trash" [size]="13" />{{ 'common.delete' | t }}
                        </button>
                      }
                    }
                    <span></span>
                    <button
                      type="button"
                      class="secondary"
                      [disabled]="busy()"
                      [title]="'settings.detectSystemProxyHint' | t"
                      (click)="networkSystemProxyRequested.emit()"
                    >
                      <app-icon name="radio" [size]="13" />{{ 'settings.detectSystemProxy' | t }}
                    </button>
                    <button
                      type="button"
                      class="secondary"
                      [disabled]="busy()"
                      [title]="'settings.importProxyHint' | t"
                      (click)="networkImportRequested.emit()"
                    >
                      <app-icon name="upload" [size]="13" />{{ 'settings.importProxy' | t }}
                    </button>
                    <button
                      type="button"
                      class="secondary"
                      [disabled]="busy() || networkProfiles().length === 0"
                      [title]="'settings.exportProxyHint' | t"
                      (click)="networkExportRequested.emit()"
                    >
                      <app-icon name="download" [size]="13" />{{ 'settings.exportProxy' | t }}
                    </button>
                    <button
                      type="button"
                      class="secondary"
                      [disabled]="busy() || !networkId() || networkDirty()"
                      [title]="networkDirty() ? ('settings.saveBeforeTest' | t) : ''"
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
            @case ('storage') {
              @defer (on immediate) {
                <app-storage-panel />
              } @placeholder {
                <section class="profile-editor"></section>
              }
            }
            @case ('remote') {
              @defer (on immediate) {
                <app-remote-access-panel />
              } @placeholder {
                <div class="profile-editor">
                  <p class="field-hint">{{ 'common.loading' | t }}</p>
                </div>
              }
            }
          }
        </div>
      </section>
    </div>
  `,
  styleUrls: ['./agent-dialog.scss', './settings-layout.scss'],
})
export class AgentSettingsDialogComponent {
  private readonly i18n = inject(I18nService);
  readonly installation = input<AgentInstallation | null>(null);
  readonly codexInstallation = input<AgentInstallation | null>(null);
  readonly openCodeInstallation = input<AgentInstallation | null>(null);
  readonly antigravityInstallation = input<AgentInstallation | null>(null);
  /** The agents' own marks, for the template. */
  protected readonly agentIcons = AGENT_ICONS;
  readonly modelProfiles = input<ModelProfile[]>([]);
  readonly profileSaveCompleted = input<ProfileSaveCompleted | null>(null);
  readonly mcpProfiles = input<McpProfile[]>([]);
  readonly networkProfiles = input<NetworkProfile[]>([]);
  readonly accountProfiles = input<AccountProfile[]>([]);
  readonly activeWorkspaceId = input('');
  readonly activeWorkspaceName = input('');
  readonly initialTab = input<SettingsTab>('diagnostics');
  /** The agent the CLI tab opens on, when something sent the user here to install it. */
  readonly initialCliAgent = input<ManagedAgentType | ''>('');
  readonly initialModelProfileId = input('');
  readonly networkTestResult = input<NetworkTestResult | null>(null);
  readonly cliPlan = input<CliOperationPlan | null>(null);
  readonly cliResult = input<CliOperationResult | null>(null);
  readonly busy = input(false);
  /** A profile save is in flight; its result lands in this dialog, so it cannot close meanwhile. */
  readonly saving = input(false);
  readonly updateResult = input<UpdateCheck | null>(null);
  readonly updateChecking = input(false);
  readonly updateInstalling = input(false);
  readonly updateError = input<string | null>(null);
  readonly autoCheckUpdates = input(true);
  readonly cancelled = output<void>();
  readonly detectRequested = output<void>();
  readonly updateCheckRequested = output<void>();
  readonly updateDownloadRequested = output<void>();
  readonly updateNpmRequested = output<void>();
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
  readonly networkExportRequested = output<void>();
  readonly networkImportRequested = output<void>();
  readonly networkSystemProxyRequested = output<void>();
  readonly accountSaved = output<AccountProfileInput>();
  readonly deleteAccountRequested = output<string>();
  readonly accountLoginRequested = output<string>();
  readonly accountRefreshRequested = output<string>();
  readonly accountConfigCopyRequested = output<{ sourceId: string; targetId: string }>();

  protected readonly confirmClose = signal(false);

  /**
   * Each editor asks for the id of the profile it's about to delete, so the panel can replace the
   * row with an inline confirmation block until the user confirms or backs out. `null` keeps the
   * normal delete button visible. The shared `inline-confirm` styling in `dialog.scss` keeps the
   * four editors looking the same.
   */
  protected readonly pendingModelDelete = signal<string | null>(null);
  protected readonly pendingAccountDelete = signal<string | null>(null);
  protected readonly pendingMcpDelete = signal<string | null>(null);
  protected readonly pendingNetworkDelete = signal<string | null>(null);
  protected readonly categories: readonly { id: SettingsTab; label: string }[] = [
    { id: 'diagnostics', label: 'settings.tabDiagnostics' },
    { id: 'cli', label: 'settings.tabCli' },
    { id: 'accounts', label: 'settings.tabAccounts' },
    { id: 'models', label: 'settings.tabModels' },
    { id: 'mcp', label: 'settings.tabMcp' },
    { id: 'network', label: 'settings.tabNetwork' },
    { id: 'remote', label: 'settings.tabRemote' },
    { id: 'storage', label: 'settings.tabStorage' },
  ];
  private readonly modelDrafts = new ProfileDrafts<ModelEditorDraft>();
  private readonly accountDrafts = new ProfileDrafts<ReturnType<typeof this.captureAccountDraft>>();
  private readonly mcpDrafts = new ProfileDrafts<ReturnType<typeof this.captureMcpDraft>>();
  private readonly networkDrafts = new ProfileDrafts<ReturnType<typeof this.captureNetworkDraft>>();
  protected readonly tab = signal<SettingsTab>('diagnostics');
  protected readonly modelId = signal('claude-default');
  protected readonly hasCredential = signal(false);
  protected readonly mcpId = signal('');
  protected readonly networkId = signal('');
  protected readonly accountId = signal('');
  protected readonly accountSystem = signal(false);
  protected readonly copySourceId = signal('');
  /**
   * Accounts the selected one can copy from: same agent, and not itself.
   *
   * Credentials never travel, so copying from the system account — where the user's real
   * settings and plugins usually live — is the common case rather than a special one.
   */
  protected readonly copySourceCandidates = computed(() => {
    const target = this.accountProfiles().find((profile) => profile.id === this.accountId());
    if (!target) {
      return [];
    }
    return this.accountProfiles().filter(
      (profile) => profile.id !== target.id && profile.agentType === target.agentType,
    );
  });
  protected readonly hasNetworkCredential = signal(false);
  protected readonly allPresets = PROVIDER_PRESETS;
  protected cliAgentType: ManagedAgentType = 'claude';
  /** Which of the agent's installers to use; the first it offers until the user picks. */
  protected cliInstaller: CliInstaller = MANAGED_AGENT_INSTALLERS.claude[0];
  protected cliTargetVersion = 'latest';
  protected cliConfirmed = false;
  protected modelName = 'Claude Sonnet';
  protected modelProvider = 'Anthropic';
  protected claudeEnabled = true;
  protected claudeModel = 'sonnet';
  protected claudeBaseUrl = '';
  protected codexEnabled = false;
  protected codexModel = '';
  protected codexBaseUrl = '';
  protected claudeContext1m = false;
  protected claudeEffort = '';
  protected codexReasoningEffort = '';
  protected readonly claudeEffortLevels = CLAUDE_EFFORT_LEVELS;
  protected readonly codexEffortLevels = CODEX_REASONING_EFFORT_LEVELS;
  protected apiKey = '';
  protected isDefault = true;
  protected clearCredential = false;
  protected modelPlanAlertThreshold = DEFAULT_ALERT_THRESHOLD;
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
  protected accountAgentType: AccountAgentType = 'claude';
  protected accountDefault = false;
  private initialSelectionApplied = false;

  constructor() {
    effect(() => {
      const saved = this.profileSaveCompleted();
      if (saved) untracked(() => this.acknowledgeProfileSave(saved));
    });
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
      const requestedAgent = this.initialCliAgent();
      if (requestedAgent) {
        this.selectCliAgent(requestedAgent);
      }
      if (requestedProfile) {
        this.editModel(requestedProfile);
      }
    });
    effect(() => {
      const profiles = this.modelProfiles();
      untracked(() => this.syncModelProfileEditor(profiles));
    });
    effect(() => {
      const profiles = this.mcpProfiles();
      untracked(() => this.syncMcpProfileEditor(profiles));
    });
    effect(() => {
      const profiles = this.networkProfiles();
      untracked(() => this.syncNetworkProfileEditor(profiles));
    });
    effect(() => {
      const profiles = this.accountProfiles();
      untracked(() => this.syncAccountProfileEditor(profiles));
    });
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

  protected selectCliAgent(agentType: ManagedAgentType): void {
    this.cliAgentType = agentType;
    // The installer belonged to the agent being left; this one may not even offer it.
    this.cliInstaller = MANAGED_AGENT_INSTALLERS[agentType][0];
    this.cliConfirmed = false;
  }

  protected selectCliInstaller(installer: CliInstaller): void {
    this.cliInstaller = installer;
    this.cliConfirmed = false;
  }

  /** The ways the selected agent can be installed. */
  protected cliInstallers(): readonly CliInstaller[] {
    return MANAGED_AGENT_INSTALLERS[this.cliAgentType];
  }

  protected selectedAccount(): AccountProfile | undefined {
    return this.accountProfiles().find((profile) => profile.id === this.accountId());
  }

  protected editAccount(profile: AccountProfile): void {
    this.accountDrafts.remember(this.accountId(), this.captureAccountDraft());
    this.accountId.set(profile.id);
    this.accountName = profile.name;
    this.accountAgentType = profile.agentType;
    this.accountDefault = profile.isDefault;
    this.accountSystem.set(profile.isSystem);
    // The previous pick belongs to the account being left, not this one.
    this.copySourceId.set('');
    Object.assign(this, this.accountDrafts.restore(this.accountId(), this.captureAccountDraft()));
  }

  protected requestConfigCopy(): void {
    const sourceId = this.copySourceId();
    const targetId = this.accountId();
    if (!sourceId || !targetId) {
      return;
    }
    this.accountConfigCopyRequested.emit({ sourceId, targetId });
  }

  protected newAccount(): void {
    this.accountDrafts.remember(this.accountId(), this.captureAccountDraft());
    this.accountId.set('');
    this.accountName = '';
    this.accountAgentType = 'claude';
    this.accountDefault = false;
    this.accountSystem.set(false);
    Object.assign(this, this.accountDrafts.restore(this.accountId(), this.captureAccountDraft()));
  }

  protected saveAccount(): void {
    if (this.busy() || !this.accountName.trim()) return;
    const profileId = this.accountId() || createId();
    this.accountDrafts.beginSave(this.accountId(), profileId, this.captureAccountDraft());
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

  /**
   * Confirms inside the editor clear the pending flag and re-emit the original event so the
   * surrounding `App` handler runs unchanged. The pending signals themselves are the truth the
   * templates read, so the busy input stays the single source of "saving in progress".
   */
  protected confirmDeleteModel(): void {
    const id = this.pendingModelDelete();
    if (!id) return;
    this.pendingModelDelete.set(null);
    this.deleteModelRequested.emit(id);
  }

  protected confirmDeleteAccount(): void {
    const id = this.pendingAccountDelete();
    if (!id) return;
    this.pendingAccountDelete.set(null);
    this.deleteAccountRequested.emit(id);
  }

  protected confirmDeleteMcp(): void {
    const id = this.pendingMcpDelete();
    if (!id) return;
    this.pendingMcpDelete.set(null);
    this.deleteMcpRequested.emit(id);
  }

  protected confirmDeleteNetwork(): void {
    const id = this.pendingNetworkDelete();
    if (!id) return;
    this.pendingNetworkDelete.set(null);
    this.deleteNetworkRequested.emit(id);
  }

  /** Heading verb: an already-current CLI must not read as an available upgrade. */
  protected planHeadline(): string {
    const action = this.cliPlan()?.action;
    if (action === 'install') {
      return this.i18n.t('settings.prepareInstall');
    }
    return this.i18n.t(
      action === 'reinstall' ? 'settings.prepareReinstall' : 'settings.prepareUpgrade',
    );
  }

  protected confirmLabel(): string {
    if (this.busy()) {
      return this.i18n.t('settings.cliRunning');
    }
    const action = this.cliPlan()?.action;
    if (action === 'install') {
      return this.i18n.t('settings.confirmInstall');
    }
    return this.i18n.t(
      action === 'reinstall' ? 'settings.confirmReinstall' : 'settings.confirmUpgrade',
    );
  }

  protected cliPlanMatches(): boolean {
    const plan = this.cliPlan();
    if (plan?.agentType !== this.cliAgentType || plan.installer !== this.cliInstaller) {
      return false;
    }
    // A script install has no version to match on: the plan is for the agent, not for a version.
    return (
      !plan.supportsVersion || plan.targetVersion === (this.cliTargetVersion.trim() || 'latest')
    );
  }

  /** Whether the chosen installer takes a version at all; a script install always takes latest. */
  protected cliTakesVersion(): boolean {
    return this.cliInstaller === 'npm';
  }

  private cliRequest(): CliOperationRequest {
    return {
      agentType: this.cliAgentType,
      installer: this.cliInstaller,
      targetVersion: this.cliTakesVersion() ? this.cliTargetVersion.trim() || 'latest' : undefined,
      workspaceId: this.activeWorkspaceId() || undefined,
    };
  }

  private captureModelDraft(): ModelEditorDraft {
    return {
      modelName: this.modelName,
      modelProvider: this.modelProvider,
      claudeEnabled: this.claudeEnabled,
      claudeModel: this.claudeModel,
      claudeBaseUrl: this.claudeBaseUrl,
      codexEnabled: this.codexEnabled,
      codexModel: this.codexModel,
      codexBaseUrl: this.codexBaseUrl,
      claudeContext1m: this.claudeContext1m,
      claudeEffort: this.claudeEffort,
      codexReasoningEffort: this.codexReasoningEffort,
      apiKey: this.apiKey,
      isDefault: this.isDefault,
      clearCredential: this.clearCredential,
      modelPlanAlertThreshold: this.modelPlanAlertThreshold,
    };
  }

  private captureAccountDraft() {
    return {
      accountName: this.accountName,
      accountAgentType: this.accountAgentType,
      accountDefault: this.accountDefault,
    };
  }

  protected accountDirty(): boolean {
    return this.accountDrafts.dirty(this.accountId(), this.captureAccountDraft());
  }

  private captureMcpDraft() {
    return {
      mcpName: this.mcpName,
      mcpConfig: this.mcpConfig,
    };
  }

  protected mcpDirty(): boolean {
    return this.mcpDrafts.dirty(this.mcpId(), this.captureMcpDraft());
  }

  private captureNetworkDraft() {
    return {
      networkName: this.networkName,
      networkScope: this.networkScope,
      networkWorkspaceId: this.networkWorkspaceId,
      networkEnabled: this.networkEnabled,
      networkDefault: this.networkDefault,
      httpProxy: this.httpProxy,
      httpsProxy: this.httpsProxy,
      allProxy: this.allProxy,
      noProxy: this.noProxy,
      npmRegistry: this.npmRegistry,
      npmProxy: this.npmProxy,
      npmHttpsProxy: this.npmHttpsProxy,
      npmStrictSsl: this.npmStrictSsl,
      npmCaPath: this.npmCaPath,
      proxyUsername: this.proxyUsername,
      proxyPassword: this.proxyPassword,
      clearNetworkCredential: this.clearNetworkCredential,
    };
  }

  protected networkDirty(): boolean {
    return this.networkDrafts.dirty(this.networkId(), this.captureNetworkDraft());
  }

  private rememberModelDraft(): void {
    this.modelDrafts.remember(this.modelId(), this.captureModelDraft());
  }

  private restoreModelDraft(): void {
    Object.assign(this, this.modelDrafts.restore(this.modelId(), this.captureModelDraft()));
  }

  protected modelDirty(): boolean {
    return this.modelDrafts.dirty(this.modelId(), this.captureModelDraft());
  }

  private acknowledgeProfileSave(saved: ProfileSaveCompleted): void {
    this.rememberAllDrafts();
    switch (saved.kind) {
      case 'models': {
        const draft = this.modelDrafts.acknowledge(saved.id, (value) => ({
          ...value,
          apiKey: '',
          clearCredential: false,
        }));
        if (draft && this.modelId() === saved.id) {
          Object.assign(this, draft);
          this.hasCredential.set(
            this.modelProfiles().find((profile) => profile.id === saved.id)?.hasCredential ?? false,
          );
        }
        break;
      }
      case 'accounts': {
        const draft = this.accountDrafts.acknowledge(saved.id, (value) => value);
        if (draft && this.accountId() === saved.id) Object.assign(this, draft);
        break;
      }
      case 'mcp': {
        const draft = this.mcpDrafts.acknowledge(saved.id, (value) => value);
        if (draft && this.mcpId() === saved.id) Object.assign(this, draft);
        break;
      }
      case 'network': {
        const draft = this.networkDrafts.acknowledge(saved.id, (value) => ({
          ...value,
          proxyPassword: '',
          clearNetworkCredential: false,
        }));
        if (draft && this.networkId() === saved.id) {
          Object.assign(this, draft);
          this.hasNetworkCredential.set(
            this.networkProfiles().find((profile) => profile.id === saved.id)?.hasCredential ??
              false,
          );
        }
        break;
      }
    }
  }

  private rememberAllDrafts(): void {
    this.rememberModelDraft();
    this.accountDrafts.remember(this.accountId(), this.captureAccountDraft());
    this.mcpDrafts.remember(this.mcpId(), this.captureMcpDraft());
    this.networkDrafts.remember(this.networkId(), this.captureNetworkDraft());
  }

  protected requestClose(): void {
    // Only a profile save holds the dialog open, since its result updates the drafts shown here.
    // Detection and CLI installs run on in the background, so they must not trap the user inside.
    if (this.saving()) return;
    this.rememberAllDrafts();
    if (
      [this.modelDrafts, this.accountDrafts, this.mcpDrafts, this.networkDrafts].some((drafts) =>
        drafts.hasChanges(),
      )
    ) {
      this.confirmClose.set(true);
      return;
    }
    this.cancelled.emit();
  }

  protected discardChanges(): void {
    if (!this.saving()) this.cancelled.emit();
  }

  protected editModel(profile: ModelProfile): void {
    this.rememberModelDraft();
    this.modelId.set(profile.id);
    this.modelName = profile.name;
    this.modelProvider = profile.provider;
    this.claudeEnabled = profile.claudeEnabled;
    this.claudeModel = profile.claudeModel;
    this.claudeBaseUrl = profile.claudeBaseUrl ?? '';
    this.codexEnabled = profile.codexEnabled;
    this.codexModel = profile.codexModel;
    this.codexBaseUrl = profile.codexBaseUrl ?? '';
    this.claudeContext1m = profile.claudeContext1m ?? false;
    this.claudeEffort = profile.claudeEffort ?? '';
    this.codexReasoningEffort = profile.codexReasoningEffort ?? '';
    this.apiKey = '';
    this.isDefault = profile.isDefault;
    this.clearCredential = false;
    this.hasCredential.set(profile.hasCredential);
    this.modelPlanAlertThreshold = profile.planAlertThreshold || DEFAULT_ALERT_THRESHOLD;
    this.restoreModelDraft();
  }

  protected newModel(): void {
    this.rememberModelDraft();
    this.modelId.set('');
    this.selectProvider(PROVIDER_PRESETS[0].provider);
    this.apiKey = '';
    this.isDefault = false;
    this.clearCredential = false;
    this.hasCredential.set(false);
    this.modelPlanAlertThreshold = DEFAULT_ALERT_THRESHOLD;
    this.claudeContext1m = false;
    this.claudeEffort = '';
    this.codexReasoningEffort = '';
    this.restoreModelDraft();
  }

  protected saveModel(): void {
    if (this.busy() || !this.canSaveModel()) {
      return;
    }
    const profileId = this.modelId() || createId();
    this.modelDrafts.beginSave(this.modelId(), profileId, this.captureModelDraft());
    this.modelId.set(profileId);
    this.modelSaved.emit({
      id: profileId,
      name: this.modelName.trim(),
      provider: this.modelProvider.trim(),
      apiKey: this.apiKey || undefined,
      clearCredential: this.clearCredential,
      isDefault: this.isDefault,
      claudeEnabled: this.claudeEnabled,
      claudeModel: this.claudeModel.trim(),
      claudeBaseUrl: this.claudeBaseUrl.trim() || undefined,
      codexEnabled: this.codexEnabled,
      codexModel: this.codexModel.trim(),
      claudeContext1m: this.claudeContext1m,
      claudeEffort: this.claudeEffort,
      codexReasoningEffort: this.codexReasoningEffort,
      codexBaseUrl: this.codexBaseUrl.trim() || undefined,
      planAlertThreshold: Math.min(
        100,
        Math.max(1, this.modelPlanAlertThreshold || DEFAULT_ALERT_THRESHOLD),
      ),
    });
  }

  /**
   * Fills both agents from the provider's documented parameters.
   *
   * A side the provider does not publish an endpoint for is switched off rather than left half
   * configured, which is what keeps "enabled" meaning "reachable".
   */
  protected selectProvider(provider: string): void {
    this.modelProvider = provider;
    const preset = findProviderPreset(provider);
    if (!preset) {
      return;
    }
    this.modelName = preset.label;
    this.claudeModel = preset.claudeModel;
    this.claudeBaseUrl = preset.claudeBaseUrl;
    this.codexModel = preset.codexModel;
    this.codexBaseUrl = preset.codexBaseUrl;
    this.claudeEnabled = Boolean(preset.claudeModel) || preset.provider === CUSTOM_PROVIDER;
    this.codexEnabled = Boolean(preset.codexModel) || preset.provider === CUSTOM_PROVIDER;
  }

  protected presetDocsUrl(): string {
    return findProviderPreset(this.modelProvider)?.docsUrl ?? '';
  }

  protected isPresetProvider(provider: string): boolean {
    return Boolean(findProviderPreset(provider));
  }

  protected groupedProfiles(): { provider: string; label: string; profiles: ModelProfile[] }[] {
    return groupProfilesByProvider(this.modelProfiles());
  }

  protected profileUsesEndpoint(profile: ModelProfile): boolean {
    return Boolean(
      (profile.claudeEnabled && profile.claudeBaseUrl) ||
      (profile.codexEnabled && profile.codexBaseUrl),
    );
  }

  protected profileMissingKey(profile: ModelProfile): boolean {
    return this.profileUsesEndpoint(profile) && !profile.hasCredential;
  }

  /** True when either enabled side goes through a compatibility endpoint that needs our key. */
  protected usesEndpoint(): boolean {
    return (
      (this.claudeEnabled && Boolean(this.claudeBaseUrl.trim())) ||
      (this.codexEnabled && Boolean(this.codexBaseUrl.trim()))
    );
  }

  protected modelCredentialMissing(): boolean {
    return (
      this.usesEndpoint() && (!this.hasCredential() || this.clearCredential) && !this.apiKey.trim()
    );
  }

  protected canSaveModel(): boolean {
    if (!this.modelName.trim() || this.modelCredentialMissing()) {
      return false;
    }
    if (!this.claudeEnabled && !this.codexEnabled) {
      return false;
    }
    // An enabled side without a model would launch its agent with nothing to run.
    return (
      (!this.claudeEnabled || Boolean(this.claudeModel.trim())) &&
      (!this.codexEnabled || Boolean(this.codexModel.trim()))
    );
  }

  protected editMcp(profile: McpProfile): void {
    this.mcpDrafts.remember(this.mcpId(), this.captureMcpDraft());
    this.mcpId.set(profile.id);
    this.mcpName = profile.name;
    this.mcpConfig = profile.configJson;
    Object.assign(this, this.mcpDrafts.restore(this.mcpId(), this.captureMcpDraft()));
  }

  protected newMcp(): void {
    this.mcpDrafts.remember(this.mcpId(), this.captureMcpDraft());
    this.mcpId.set('');
    this.mcpName = '';
    this.mcpConfig = '{\n  "mcpServers": {}\n}';
    Object.assign(this, this.mcpDrafts.restore(this.mcpId(), this.captureMcpDraft()));
  }

  protected mcpError(): string {
    try {
      const config: unknown = JSON.parse(this.mcpConfig);
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return this.i18n.t('settings.mcpObjectRequired');
      }
      return '';
    } catch {
      return this.i18n.t('settings.mcpInvalidJson');
    }
  }

  protected saveMcp(): void {
    if (!this.mcpName.trim() || this.mcpError() || this.busy()) return;
    const profileId = this.mcpId() || createId();
    this.mcpDrafts.beginSave(this.mcpId(), profileId, this.captureMcpDraft());
    this.mcpId.set(profileId);
    this.mcpSaved.emit({
      id: profileId,
      name: this.mcpName.trim(),
      configJson: this.mcpConfig,
    });
  }

  protected editNetwork(profile: NetworkProfile): void {
    this.networkDrafts.remember(this.networkId(), this.captureNetworkDraft());
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
    Object.assign(this, this.networkDrafts.restore(this.networkId(), this.captureNetworkDraft()));
  }

  protected newNetwork(): void {
    this.networkDrafts.remember(this.networkId(), this.captureNetworkDraft());
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
    Object.assign(this, this.networkDrafts.restore(this.networkId(), this.captureNetworkDraft()));
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
    if (this.busy() || !this.canSaveNetwork()) return;
    const profileId = this.networkId() || createId();
    this.networkDrafts.beginSave(this.networkId(), profileId, this.captureNetworkDraft());
    this.networkId.set(profileId);
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
      this.modelDrafts.reconcile(
        profiles.map((profile) => profile.id),
        selectedId,
        this.captureModelDraft(),
      )
    ) {
      const fallback =
        selectedProfile ?? profiles.find((profile) => profile.isDefault) ?? profiles[0];
      fallback ? this.editModel(fallback) : this.newModel();
    }
  }

  private syncMcpProfileEditor(profiles: McpProfile[]): void {
    const selectedId = untracked(this.mcpId);
    const selectedProfile = profiles.find((profile) => profile.id === selectedId);
    if (
      this.mcpDrafts.reconcile(
        profiles.map((profile) => profile.id),
        selectedId,
        this.captureMcpDraft(),
      )
    ) {
      const fallback = selectedProfile ?? profiles[0];
      fallback ? this.editMcp(fallback) : this.newMcp();
    }
  }

  private syncNetworkProfileEditor(profiles: NetworkProfile[]): void {
    const selectedId = untracked(this.networkId);
    const selectedProfile = profiles.find((profile) => profile.id === selectedId);
    if (
      this.networkDrafts.reconcile(
        profiles.map((profile) => profile.id),
        selectedId,
        this.captureNetworkDraft(),
      )
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
    }
  }

  private syncAccountProfileEditor(profiles: AccountProfile[]): void {
    const selectedId = untracked(this.accountId);
    const selectedProfile = profiles.find((profile) => profile.id === selectedId);
    if (
      this.accountDrafts.reconcile(
        profiles.map((profile) => profile.id),
        selectedId,
        this.captureAccountDraft(),
      )
    ) {
      const fallback =
        selectedProfile ?? profiles.find((profile) => profile.isDefault) ?? profiles[0];
      fallback ? this.editAccount(fallback) : this.newAccount();
    }
  }
}
