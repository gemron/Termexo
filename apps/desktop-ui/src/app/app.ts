import { Component, computed, inject, signal } from '@angular/core';

import { AgentType, LayoutMode } from './core/models/workspace.models';
import { AppStateService } from './core/services/app-state.service';
import { TerminalGatewayService } from './core/services/terminal-gateway.service';
import { CreateWorkspaceDialogComponent } from './dialogs/create-workspace-dialog';
import { ModelSwitchDialogComponent } from './dialogs/model-switch-dialog';
import { InspectorPanelComponent } from './inspector/inspector-panel';
import { IconComponent } from './shared/icon/icon';
import { TerminalWorkbenchComponent } from './terminal/terminal-workbench';
import { WorkspaceSidebarComponent } from './workspace/workspace-sidebar';

@Component({
  selector: 'app-root',
  imports: [
    CreateWorkspaceDialogComponent,
    IconComponent,
    InspectorPanelComponent,
    ModelSwitchDialogComponent,
    TerminalWorkbenchComponent,
    WorkspaceSidebarComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly state = inject(AppStateService);
  private readonly terminalGateway = inject(TerminalGatewayService);

  protected readonly createWorkspaceOpen = signal(false);
  protected readonly modelSwitchOpen = signal(false);
  protected readonly agentMenuOpen = signal(false);
  protected readonly inspectorOpen = signal(true);
  protected readonly toastMessage = signal<string | null>(null);
  protected readonly activeTerminalId = computed(() => this.state.activeTerminal()?.id ?? null);

  constructor() {
    void this.state.initialize();
  }

  protected createTerminal(agentType: AgentType): void {
    const terminal = this.state.createTerminal({ agentType });
    this.agentMenuOpen.set(false);
    if (terminal) {
      this.showToast(`${terminal.name} 已创建`);
    }
  }

  protected closeTerminal(terminalId: string): void {
    void this.terminalGateway.close(terminalId);
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

  private showToast(message: string): void {
    this.toastMessage.set(message);
    window.setTimeout(() => {
      if (this.toastMessage() === message) {
        this.toastMessage.set(null);
      }
    }, 2_400);
  }
}
