import { Component, computed, effect, inject, signal } from '@angular/core';

import { McpProfileInput, ModelProfileInput } from './core/models/agent.models';
import { AgentType, LayoutMode } from './core/models/workspace.models';
import { AgentService } from './core/services/agent.service';
import { AppStateService } from './core/services/app-state.service';
import { TerminalGatewayService } from './core/services/terminal-gateway.service';
import { AgentSettingsDialogComponent } from './dialogs/agent-settings-dialog';
import {
  ClaudeLaunchDialogComponent,
  ClaudeLaunchDialogValue,
} from './dialogs/claude-launch-dialog';
import { CreateWorkspaceDialogComponent } from './dialogs/create-workspace-dialog';
import { ModelSwitchDialogComponent } from './dialogs/model-switch-dialog';
import { ResumeSessionValue, SessionCenterDialogComponent } from './dialogs/session-center-dialog';
import { InspectorPanelComponent } from './inspector/inspector-panel';
import { IconComponent } from './shared/icon/icon';
import { TerminalWorkbenchComponent } from './terminal/terminal-workbench';
import { WorkspaceSidebarComponent } from './workspace/workspace-sidebar';

@Component({
  selector: 'app-root',
  imports: [
    AgentSettingsDialogComponent,
    ClaudeLaunchDialogComponent,
    CreateWorkspaceDialogComponent,
    IconComponent,
    InspectorPanelComponent,
    ModelSwitchDialogComponent,
    SessionCenterDialogComponent,
    TerminalWorkbenchComponent,
    WorkspaceSidebarComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly state = inject(AppStateService);
  protected readonly agents = inject(AgentService);
  private readonly terminalGateway = inject(TerminalGatewayService);
  private readonly handledEventKeys = new Set<string>();

  protected readonly createWorkspaceOpen = signal(false);
  protected readonly claudeLaunchOpen = signal(false);
  protected readonly sessionCenterOpen = signal(false);
  protected readonly settingsOpen = signal(false);
  protected readonly modelSwitchOpen = signal(false);
  protected readonly agentMenuOpen = signal(false);
  protected readonly inspectorOpen = signal(true);
  protected readonly launchingClaude = signal(false);
  protected readonly toastMessage = signal<string | null>(null);
  protected readonly activeTerminalId = computed(() => this.state.activeTerminal()?.id ?? null);

  constructor() {
    void this.initialize();
    effect(() => {
      for (const event of this.agents.events()) {
        if (!this.handledEventKeys.has(event.eventKey)) {
          this.handledEventKeys.add(event.eventKey);
          this.state.applyAgentEvent(event);
        }
      }
    });
  }

  protected createTerminal(agentType: AgentType): void {
    const terminal = this.state.createTerminal({ agentType });
    this.agentMenuOpen.set(false);
    if (terminal) {
      this.showToast(`${terminal.name} 已创建`);
    }
  }

  protected openClaudeLaunch(): void {
    this.agentMenuOpen.set(false);
    this.claudeLaunchOpen.set(true);
  }

  protected async launchClaude(value: ClaudeLaunchDialogValue): Promise<void> {
    const workspace = this.state.activeWorkspace();
    if (!workspace || this.launchingClaude()) {
      return;
    }

    const terminalId = crypto.randomUUID();
    this.launchingClaude.set(true);
    try {
      const launch = await this.agents.prepareLaunch({
        terminalId,
        name: value.name || undefined,
        profileId: value.profileId,
        mcpProfileId: value.mcpProfileId,
      });
      const profile = this.agents.modelProfiles().find((item) => item.id === value.profileId);
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: 'claude',
        name: value.name || undefined,
        command: launch.command,
        model: profile?.name ?? 'Claude Sonnet',
      });
      this.claudeLaunchOpen.set(false);
      if (terminal) {
        this.showToast(`${terminal.name} 已启动`);
      }
    } catch (error) {
      this.showToast(this.errorMessage(error));
    } finally {
      this.launchingClaude.set(false);
    }
  }

  protected async openSessionCenter(): Promise<void> {
    this.sessionCenterOpen.set(true);
    await this.refreshSessions(this.state.activeWorkspace()?.projectPath);
  }

  protected async refreshSessions(projectPath?: string): Promise<void> {
    await this.agents.refreshSessions(projectPath);
  }

  protected async resumeClaude(value: ResumeSessionValue): Promise<void> {
    const workspace = this.state.activeWorkspace();
    if (!workspace || this.launchingClaude()) {
      return;
    }

    const terminalId = crypto.randomUUID();
    this.launchingClaude.set(true);
    try {
      const launch = await this.agents.prepareLaunch({
        terminalId,
        sessionId: value.session.nativeSessionId,
        profileId: value.profileId,
        mcpProfileId: value.mcpProfileId,
      });
      const profile = this.agents.modelProfiles().find((item) => item.id === value.profileId);
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: 'claude',
        name: value.session.title,
        command: launch.command,
        model: profile?.name ?? value.session.modelName ?? 'Claude Sonnet',
        nativeSessionId: value.session.nativeSessionId,
        workingDirectory: value.session.projectPath ?? workspace.projectPath,
      });
      this.sessionCenterOpen.set(false);
      if (terminal) {
        this.showToast(`正在恢复 ${value.session.title}`);
      }
    } catch (error) {
      this.showToast(this.errorMessage(error));
    } finally {
      this.launchingClaude.set(false);
    }
  }

  protected closeTerminal(terminalId: string): void {
    void this.terminalGateway.close(terminalId).catch(() => undefined);
    this.state.closeTerminal(terminalId);
  }

  protected changeLayout(layout: LayoutMode): void {
    this.state.setLayout(layout);
  }

  protected createWorkspace(value: { name: string; projectPath: string }): void {
    this.state.createWorkspace(value.name, value.projectPath);
    this.createWorkspaceOpen.set(false);
    this.showToast(`工作区 ${value.name} 已创建`);
  }

  protected switchModels(profileId: string): void {
    const switched = this.state.switchAllModels(profileId);
    this.modelSwitchOpen.set(false);
    this.showToast(`${switched} 个 Agent 已切换模型`);
  }

  protected saveSnapshot(): void {
    this.showToast('Workspace 快照已保存');
  }

  protected showPlaceholder(name: string): void {
    this.showToast(`${name}将在后续版本开放`);
  }

  protected async saveModelProfile(input: ModelProfileInput): Promise<void> {
    try {
      await this.agents.saveModelProfile(input);
      this.showToast('模型 Profile 已保存');
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async deleteModelProfile(profileId: string): Promise<void> {
    try {
      await this.agents.deleteModelProfile(profileId);
      this.showToast('模型 Profile 已删除');
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async saveMcpProfile(input: McpProfileInput): Promise<void> {
    try {
      await this.agents.saveMcpProfile(input);
      this.showToast('MCP Profile 已保存');
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async deleteMcpProfile(profileId: string): Promise<void> {
    try {
      await this.agents.deleteMcpProfile(profileId);
      this.showToast('MCP Profile 已删除');
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  private showToast(message: string): void {
    this.toastMessage.set(message);
    window.setTimeout(() => {
      if (this.toastMessage() === message) {
        this.toastMessage.set(null);
      }
    }, 2_400);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async initialize(): Promise<void> {
    await this.state.initialize();
    await this.agents.initialize();
  }
}
