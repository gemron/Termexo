import { effect, inject, Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save } from '@tauri-apps/plugin-dialog';

import { I18nService } from '../i18n/i18n.service';
import {
  AccountLoginRequest,
  AccountProfile,
  AccountProfileInput,
  AgentEvent,
  AgentInstallation,
  AgentLaunchSpec,
  AgentSession,
  ClaudeLaunchRequest,
  CliOperationPlan,
  CliOperationRequest,
  CliOperationResult,
  CodexLaunchRequest,
  ImportSummary,
  McpProfile,
  McpProfileInput,
  ModelProfile,
  ModelProfileInput,
  NetworkProfile,
  NetworkProfileInput,
  NetworkTestResult,
} from '../models/agent.models';
import { isTauriRuntime } from './tauri-runtime';

const EVENT_POLL_INTERVAL_MS = 1_000;
const MAX_RECENT_EVENTS = 250;

@Injectable({ providedIn: 'root' })
export class AgentService {
  private readonly i18n = inject(I18nService);
  private readonly installationState = signal<AgentInstallation | null>(null);
  private readonly codexInstallationState = signal<AgentInstallation | null>(null);
  private readonly sessionItems = signal<AgentSession[]>([]);
  private readonly eventItems = signal<AgentEvent[]>([]);
  private readonly modelProfileItems = signal<ModelProfile[]>([]);
  private readonly mcpProfileItems = signal<McpProfile[]>([]);
  private readonly networkProfileItems = signal<NetworkProfile[]>([]);
  private readonly accountProfileItems = signal<AccountProfile[]>([]);
  private readonly busyState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private initialized = false;
  private pendingOperations = 0;
  private pollingHandle: number | null = null;

  readonly installation = this.installationState.asReadonly();
  readonly codexInstallation = this.codexInstallationState.asReadonly();
  readonly sessions = this.sessionItems.asReadonly();
  readonly events = this.eventItems.asReadonly();
  readonly modelProfiles = this.modelProfileItems.asReadonly();
  readonly mcpProfiles = this.mcpProfileItems.asReadonly();
  readonly networkProfiles = this.networkProfileItems.asReadonly();
  readonly accountProfiles = this.accountProfileItems.asReadonly();
  readonly busy = this.busyState.asReadonly();
  readonly error = this.errorState.asReadonly();

  constructor() {
    effect(() => {
      this.i18n.activeLanguage();
      if (this.initialized && !isTauriRuntime()) {
        this.initializeBrowserPreview();
      }
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    if (!isTauriRuntime()) {
      this.initializeBrowserPreview();
      return;
    }

    await Promise.all([
      this.detectClaude(),
      this.detectCodex(),
      this.loadProfiles(),
      this.loadSessions(),
    ]);
    void this.refreshAccountStatuses();
    await this.syncEvents();
    await this.loadEvents();
    this.pollingHandle = window.setInterval(() => {
      void this.syncEvents();
    }, EVENT_POLL_INTERVAL_MS);
  }

  async detectClaude(): Promise<void> {
    if (!isTauriRuntime()) {
      this.installationState.set(this.browserInstallation('claude'));
      return;
    }
    await this.run(async () => {
      this.installationState.set(await invoke<AgentInstallation>('detect_claude'));
    });
  }

  async detectCodex(): Promise<void> {
    if (!isTauriRuntime()) {
      this.codexInstallationState.set(this.browserInstallation('codex'));
      return;
    }
    await this.run(async () => {
      this.codexInstallationState.set(await invoke<AgentInstallation>('detect_codex'));
    });
  }

  async refreshSessions(projectPath?: string): Promise<void> {
    if (!isTauriRuntime()) {
      this.sessionItems.set([]);
      return;
    }
    await this.run(async () => {
      const results = await Promise.allSettled([
        invoke<AgentSession[]>('scan_claude_sessions', {
          projectPath: projectPath || null,
        }),
        invoke<AgentSession[]>('scan_codex_sessions', {
          projectPath: projectPath || null,
        }),
      ]);

      const sessions = results.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
      );
      const failures = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failures.length === results.length) {
        throw new Error(
          this.i18n.t('agent.sessionScanFailed', {
            error: failures.map((failure) => this.errorMessage(failure.reason)).join('; '),
          }),
        );
      }

      this.sessionItems.set(sessions.sort((left, right) => right.lastUsedAt - left.lastUsedAt));
      if (failures.length > 0) {
        this.errorState.set(
          this.i18n.t('agent.sessionScanPartial', {
            error: failures.map((failure) => this.errorMessage(failure.reason)).join('; '),
          }),
        );
      }
    });
  }

  async prepareLaunch(request: ClaudeLaunchRequest): Promise<AgentLaunchSpec> {
    if (!isTauriRuntime()) {
      return {
        command: `claude${request.sessionId ? ` --resume '${request.sessionId}'` : ''}`,
        executablePath: 'claude',
      };
    }
    return invoke<AgentLaunchSpec>('prepare_claude_launch', { request });
  }

  async prepareCodexLaunch(request: CodexLaunchRequest): Promise<AgentLaunchSpec> {
    if (!isTauriRuntime()) {
      return {
        command: `codex${request.sessionId ? ` resume '${request.sessionId}'` : ''}${
          request.model ? ` --model '${request.model}'` : ''
        }`,
        executablePath: 'codex',
      };
    }
    return invoke<AgentLaunchSpec>('prepare_codex_launch', { request });
  }

  async prepareAccountLogin(request: AccountLoginRequest): Promise<AgentLaunchSpec> {
    if (!isTauriRuntime()) {
      const profile = this.accountProfileItems().find(
        (candidate) => candidate.id === request.accountProfileId,
      );
      return {
        command: profile?.agentType === 'codex' ? 'codex login' : 'claude auth login',
        executablePath: profile?.agentType === 'codex' ? 'codex' : 'claude',
      };
    }
    return invoke<AgentLaunchSpec>('prepare_account_login', { request });
  }

  async previewCliOperation(request: CliOperationRequest): Promise<CliOperationPlan> {
    if (!isTauriRuntime()) {
      const installation =
        request.agentType === 'claude' ? this.installationState() : this.codexInstallationState();
      const packageName =
        request.agentType === 'claude' ? '@anthropic-ai/claude-code' : '@openai/codex';
      const targetVersion = request.targetVersion?.trim() || 'latest';
      return {
        agentType: request.agentType,
        displayName: request.agentType === 'claude' ? 'Claude Code' : 'Codex CLI',
        packageName,
        targetVersion,
        packageSpec: `${packageName}@${targetVersion}`,
        action: installation?.installed ? 'upgrade' : 'install',
        currentVersion: installation?.version,
        // Browser preview cannot reach the registry, so no version is resolved and the plan
        // never claims to be current.
        upToDate: false,
        npmPath: 'browser-preview/npm',
        npmVersion: 'preview',
        commandPreview: `npm install --global ${packageName}@${targetVersion} --no-fund --no-audit`,
        networkProfileId: this.networkProfileItems().find(
          (profile) =>
            profile.enabled &&
            profile.isDefault &&
            (profile.workspaceId === request.workspaceId || profile.scope === 'global'),
        )?.id,
        ready: true,
        diagnostic: this.i18n.t('agent.browserPlan'),
      };
    }
    return this.runValue(() => invoke<CliOperationPlan>('preview_cli_operation', { request }));
  }

  async executeCliOperation(request: CliOperationRequest): Promise<CliOperationResult> {
    if (!isTauriRuntime()) {
      const plan = await this.previewCliOperation(request);
      const installation: AgentInstallation = {
        agentType: request.agentType,
        installed: false,
        healthy: false,
        diagnostic: this.i18n.t('agent.browserNoMutation'),
      };
      return {
        success: false,
        plan,
        installation,
        stdout: '',
        stderr: '',
        durationMs: 0,
        diagnostic: installation.diagnostic,
      };
    }
    const result = await this.runValue(() =>
      invoke<CliOperationResult>('execute_cli_operation', {
        request: { ...request, confirmed: true },
      }),
    );
    if (result.installation.agentType === 'claude') {
      this.installationState.set(result.installation);
    } else {
      this.codexInstallationState.set(result.installation);
    }
    return result;
  }

  async saveModelProfile(input: ModelProfileInput): Promise<void> {
    if (!isTauriRuntime()) {
      const { apiKey, clearCredential, ...profile } = input;
      this.upsertModelProfile({
        ...profile,
        hasCredential: clearCredential ? false : Boolean(apiKey),
      });
      return;
    }
    const profile = await invoke<ModelProfile>('save_model_profile', { input });
    this.upsertModelProfile(profile);
  }

  async deleteModelProfile(profileId: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('delete_model_profile', { profileId });
    }
    this.modelProfileItems.update((items) => items.filter((item) => item.id !== profileId));
  }

  async saveMcpProfile(input: McpProfileInput): Promise<void> {
    if (!isTauriRuntime()) {
      this.upsertMcpProfile(input);
      return;
    }
    const profile = await invoke<McpProfile>('save_mcp_profile', { input });
    this.upsertMcpProfile(profile);
  }

  async deleteMcpProfile(profileId: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('delete_mcp_profile', { profileId });
    }
    this.mcpProfileItems.update((items) => items.filter((item) => item.id !== profileId));
  }

  async saveNetworkProfile(input: NetworkProfileInput): Promise<void> {
    if (!isTauriRuntime()) {
      const existing = this.networkProfileItems().find((profile) => profile.id === input.id);
      const { proxyPassword, clearCredential, ...profile } = input;
      this.upsertNetworkProfile({
        ...profile,
        hasCredential:
          !profile.proxyUsername || clearCredential
            ? false
            : Boolean(proxyPassword) || Boolean(existing?.hasCredential),
      });
      return;
    }
    const profile = await invoke<NetworkProfile>('save_network_profile', { input });
    this.upsertNetworkProfile(profile);
  }

  async deleteNetworkProfile(profileId: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('delete_network_profile', { profileId });
    }
    this.networkProfileItems.update((items) => items.filter((item) => item.id !== profileId));
  }

  async testNetworkProfile(profileId: string): Promise<NetworkTestResult> {
    if (!isTauriRuntime()) {
      return {
        profileId,
        healthy: true,
        target: 'browser-preview',
        message: this.i18n.t('agent.browserNetworkTest'),
        latencyMs: 0,
      };
    }
    return invoke<NetworkTestResult>('test_network_profile', { profileId });
  }

  /**
   * Asks for a destination and writes every proxy profile there as JSON.
   *
   * Returns null when the user cancels the dialog. Passwords stay in Credential Manager: the
   * backend builds the document without them, so an exported file is safe to share.
   */
  async exportNetworkProfiles(): Promise<{ count: number; path: string } | null> {
    if (!isTauriRuntime()) {
      // Browser preview has no filesystem to write to.
      return null;
    }
    const path = await save({
      defaultPath: 'termexo-proxy-profiles.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) {
      return null;
    }
    const contents = await invoke<string>('export_network_profiles', { profileId: null });
    await invoke('write_network_profile_export', { path, contents });
    return { count: this.networkProfileItems().length, path };
  }

  /**
   * Reads an exported file and adds the profiles it describes.
   *
   * Imported profiles arrive as new records without a password — the file never carries one —
   * so `needsPassword` lists the ones still waiting for credentials.
   */
  async importNetworkProfiles(): Promise<ImportSummary | null> {
    if (!isTauriRuntime()) {
      return null;
    }
    const selected = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) {
      return null;
    }
    const summary = await invoke<ImportSummary>('import_network_profiles', { path });
    // Imported rows come straight from the database, so the list is refetched rather than patched.
    await this.refreshNetworkProfiles();
    return summary;
  }

  private async refreshNetworkProfiles(): Promise<void> {
    this.networkProfileItems.set(await invoke<NetworkProfile[]>('list_network_profiles'));
  }

  async saveAccountProfile(input: AccountProfileInput): Promise<void> {
    if (!isTauriRuntime()) {
      const existing = this.accountProfileItems().find((profile) => profile.id === input.id);
      this.upsertAccountProfile({
        ...input,
        isSystem: existing?.isSystem ?? false,
        authenticated: existing?.authenticated ?? false,
        diagnostic: existing?.diagnostic ?? this.i18n.t('agent.notSignedIn'),
      });
      return;
    }
    const profile = await invoke<AccountProfile>('save_account_profile', { input });
    if (profile.isDefault) {
      this.accountProfileItems.update((items) =>
        items.map((item) =>
          item.agentType === profile.agentType ? { ...item, isDefault: false } : item,
        ),
      );
    }
    this.upsertAccountProfile(profile);
  }

  async refreshAccountProfile(profileId: string): Promise<void> {
    if (!isTauriRuntime()) {
      return;
    }
    const profile = await invoke<AccountProfile>('refresh_account_profile', { profileId });
    this.upsertAccountProfile(profile);
  }

  async deleteAccountProfile(profileId: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('delete_account_profile', { profileId });
    }
    this.accountProfileItems.update((items) => items.filter((item) => item.id !== profileId));
  }

  private browserInstallation(agentType: 'claude' | 'codex'): AgentInstallation {
    const name = agentType === 'claude' ? 'Claude Code' : 'Codex CLI';
    return {
      agentType,
      installed: false,
      healthy: false,
      diagnostic: this.i18n.t('agent.browserInstallation', { name }),
    };
  }

  private initializeBrowserPreview(): void {
    this.installationState.set(this.browserInstallation('claude'));
    this.codexInstallationState.set(this.browserInstallation('codex'));
    if (this.modelProfileItems().length === 0) {
      this.modelProfileItems.set([
        {
          id: 'claude-default',
          name: 'Claude Sonnet',
          provider: 'Anthropic',
          model: 'sonnet',
          apiProtocol: 'anthropic',
          isDefault: true,
          hasCredential: false,
        },
      ]);
    }
    const managedAccounts = this.accountProfileItems().filter((profile) => !profile.isSystem);
    this.accountProfileItems.set([
      {
        id: 'claude-system',
        name: this.i18n.t('agent.systemAccount', { name: 'Claude' }),
        agentType: 'claude',
        isDefault: true,
        isSystem: true,
        authenticated: true,
        diagnostic: this.i18n.t('agent.browserAccount'),
      },
      {
        id: 'codex-system',
        name: this.i18n.t('agent.systemAccount', { name: 'ChatGPT' }),
        agentType: 'codex',
        isDefault: true,
        isSystem: true,
        authenticated: true,
        diagnostic: this.i18n.t('agent.browserAccount'),
      },
      ...managedAccounts,
    ]);
  }

  private async loadProfiles(): Promise<void> {
    if (!isTauriRuntime()) {
      return;
    }
    await this.run(async () => {
      const [modelProfiles, mcpProfiles, networkProfiles, accountProfiles] = await Promise.all([
        invoke<ModelProfile[]>('list_model_profiles'),
        invoke<McpProfile[]>('list_mcp_profiles'),
        invoke<NetworkProfile[]>('list_network_profiles'),
        invoke<AccountProfile[]>('list_account_profiles'),
      ]);
      this.modelProfileItems.set(modelProfiles);
      this.mcpProfileItems.set(mcpProfiles);
      this.networkProfileItems.set(networkProfiles);
      this.accountProfileItems.set(accountProfiles);
    });
  }

  private async loadSessions(): Promise<void> {
    await this.run(async () => {
      this.sessionItems.set(await invoke<AgentSession[]>('list_agent_sessions'));
    });
  }

  private async loadEvents(): Promise<void> {
    try {
      const events = await invoke<AgentEvent[]>('list_agent_events', { terminalId: null });
      this.eventItems.set(events.slice(0, MAX_RECENT_EVENTS));
    } catch (error) {
      console.warn('Unable to load agent event history.', error);
    }
  }

  private async refreshAccountStatuses(): Promise<void> {
    const profileIds = this.accountProfileItems().map((profile) => profile.id);
    await Promise.allSettled(profileIds.map((profileId) => this.refreshAccountProfile(profileId)));
  }

  private async syncEvents(): Promise<void> {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      const events = await invoke<AgentEvent[]>('sync_agent_events');
      if (events.length > 0) {
        this.eventItems.update((items) =>
          [...events.reverse(), ...items].slice(0, MAX_RECENT_EVENTS),
        );
      }
    } catch (error) {
      console.warn('Agent event synchronization failed', error);
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.pendingOperations += 1;
    this.busyState.set(true);
    this.errorState.set(null);
    try {
      await action();
    } catch (error) {
      this.errorState.set(this.errorMessage(error));
    } finally {
      this.pendingOperations = Math.max(0, this.pendingOperations - 1);
      this.busyState.set(this.pendingOperations > 0);
    }
  }

  private async runValue<T>(action: () => Promise<T>): Promise<T> {
    this.pendingOperations += 1;
    this.busyState.set(true);
    this.errorState.set(null);
    try {
      return await action();
    } catch (error) {
      this.errorState.set(this.errorMessage(error));
      throw error;
    } finally {
      this.pendingOperations = Math.max(0, this.pendingOperations - 1);
      this.busyState.set(this.pendingOperations > 0);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private upsertModelProfile(profile: ModelProfile): void {
    this.modelProfileItems.update((items) => [
      ...items.filter((item) => item.id !== profile.id),
      profile,
    ]);
  }

  private upsertMcpProfile(profile: McpProfile): void {
    this.mcpProfileItems.update((items) => [
      ...items.filter((item) => item.id !== profile.id),
      profile,
    ]);
  }

  private upsertNetworkProfile(profile: NetworkProfile): void {
    this.networkProfileItems.update((items) => [
      ...items.filter((item) => item.id !== profile.id),
      profile,
    ]);
  }

  private upsertAccountProfile(profile: AccountProfile): void {
    this.accountProfileItems.update((items) => [
      ...items.filter((item) => item.id !== profile.id),
      profile,
    ]);
  }
}
