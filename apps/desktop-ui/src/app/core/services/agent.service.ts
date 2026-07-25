import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

import {
  AgentEvent,
  AgentInstallation,
  AgentLaunchSpec,
  AgentSession,
  ClaudeLaunchRequest,
  McpProfile,
  McpProfileInput,
  ModelProfile,
  ModelProfileInput,
} from '../models/agent.models';
import { isTauriRuntime } from './tauri-runtime';

const EVENT_POLL_INTERVAL_MS = 1_000;
const MAX_RECENT_EVENTS = 100;

const BROWSER_INSTALLATION: AgentInstallation = {
  agentType: 'claude',
  installed: false,
  healthy: false,
  diagnostic: '浏览器预览不连接本机 Claude Code，请运行桌面端。',
};

@Injectable({ providedIn: 'root' })
export class AgentService {
  private readonly installationState = signal<AgentInstallation | null>(null);
  private readonly sessionItems = signal<AgentSession[]>([]);
  private readonly eventItems = signal<AgentEvent[]>([]);
  private readonly modelProfileItems = signal<ModelProfile[]>([]);
  private readonly mcpProfileItems = signal<McpProfile[]>([]);
  private readonly busyState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private initialized = false;
  private pollingHandle: number | null = null;

  readonly installation = this.installationState.asReadonly();
  readonly sessions = this.sessionItems.asReadonly();
  readonly events = this.eventItems.asReadonly();
  readonly modelProfiles = this.modelProfileItems.asReadonly();
  readonly mcpProfiles = this.mcpProfileItems.asReadonly();
  readonly busy = this.busyState.asReadonly();
  readonly error = this.errorState.asReadonly();

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    if (!isTauriRuntime()) {
      this.installationState.set(BROWSER_INSTALLATION);
      this.modelProfileItems.set([
        {
          id: 'claude-default',
          name: 'Claude Sonnet',
          provider: 'Anthropic',
          model: 'sonnet',
          isDefault: true,
          hasCredential: false,
        },
      ]);
      return;
    }

    await Promise.all([this.detectClaude(), this.loadProfiles(), this.refreshSessions()]);
    await this.syncEvents();
    this.pollingHandle = window.setInterval(() => {
      void this.syncEvents();
    }, EVENT_POLL_INTERVAL_MS);
  }

  async detectClaude(): Promise<void> {
    if (!isTauriRuntime()) {
      this.installationState.set(BROWSER_INSTALLATION);
      return;
    }
    await this.run(async () => {
      this.installationState.set(await invoke<AgentInstallation>('detect_claude'));
    });
  }

  async refreshSessions(projectPath?: string): Promise<void> {
    if (!isTauriRuntime()) {
      this.sessionItems.set([]);
      return;
    }
    await this.run(async () => {
      const sessions = await invoke<AgentSession[]>('scan_claude_sessions', {
        projectPath: projectPath || null,
      });
      this.sessionItems.set(sessions);
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

  private async loadProfiles(): Promise<void> {
    if (!isTauriRuntime()) {
      return;
    }
    await this.run(async () => {
      const [modelProfiles, mcpProfiles] = await Promise.all([
        invoke<ModelProfile[]>('list_model_profiles'),
        invoke<McpProfile[]>('list_mcp_profiles'),
      ]);
      this.modelProfileItems.set(modelProfiles);
      this.mcpProfileItems.set(mcpProfiles);
    });
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
    this.busyState.set(true);
    this.errorState.set(null);
    try {
      await action();
    } catch (error) {
      this.errorState.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.busyState.set(false);
    }
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
}
