import { DestroyRef, inject, Injectable, InjectionToken, type WritableSignal } from '@angular/core';

import { I18nService, type LanguagePreference } from '../i18n/i18n.service';
import {
  isTerminalFontAvailable,
  normalizeTerminalFontName,
  TERMINAL_FONT_NAME_STORAGE_KEY,
} from '../../terminal/terminal-font';

import {
  profileModel,
  profileServes,
  type AgentProtocol,
  type ModelProfileInput,
  type NetworkProfileInput,
} from '../models/agent.models';
import type { DesktopPreferences, McpToolRequest } from '../models/mcp-server.models';
import type { TodoTask, TodoTaskDraft } from '../models/todo.models';
import { stripTerminalControl } from '../models/terminal-output';
import type { TerminalSession, Workspace } from '../models/workspace.models';
import { AgentService } from './agent.service';
import { AppStateService } from './app-state.service';
import { invoke, listen, type UnlistenFn } from './backend-bridge';
import { runtimeMode } from './tauri-runtime';
import { TerminalGatewayService } from './terminal-gateway.service';
import { TodoService } from './todo.service';
import { WorkspaceRepository } from './workspace.repository';

type Arguments = McpToolRequest['arguments'];

export const MCP_DESKTOP_BRIDGE = new InjectionToken('MCP_DESKTOP_BRIDGE', {
  providedIn: 'root',
  factory: () => ({ invoke, listen, mode: runtimeMode }),
});

export function mcpPreferenceActions(preferences: {
  i18n: I18nService;
  terminalFontSize: WritableSignal<number>;
  terminalFontName: WritableSignal<string>;
  inspectorOpen: WritableSignal<boolean>;
  workspaceSidebarOpen: WritableSignal<boolean>;
}): Pick<McpDesktopActions, 'getPreferences' | 'updatePreferences'> {
  return {
    getPreferences: () => ({
      language: preferences.i18n.preference(),
      terminalFontSize: preferences.terminalFontSize(),
      terminalFontName: preferences.terminalFontName(),
      inspectorOpen: preferences.inspectorOpen(),
      workspaceSidebarOpen: preferences.workspaceSidebarOpen(),
    }),
    updatePreferences: (patch) => {
      const font =
        patch.terminalFontName === undefined
          ? undefined
          : normalizeTerminalFontName(patch.terminalFontName);
      if (font !== undefined && !isTerminalFontAvailable(font))
        throw new Error('Terminal font is not installed');
      // Persist before applying signals, so a refused storage write cannot report durable success.
      for (const key of ['terminalFontSize', 'inspectorOpen', 'workspaceSidebarOpen'] as const) {
        if (patch[key] !== undefined) localStorage.setItem(`termexo.${key}`, String(patch[key]));
      }
      if (font !== undefined) localStorage.setItem(TERMINAL_FONT_NAME_STORAGE_KEY, font);
      if (patch.language !== undefined)
        preferences.i18n.setPreference(patch.language as LanguagePreference);
      if (patch.terminalFontSize !== undefined)
        preferences.terminalFontSize.set(patch.terminalFontSize);
      if (font !== undefined) preferences.terminalFontName.set(font);
      if (patch.inspectorOpen !== undefined) preferences.inspectorOpen.set(patch.inspectorOpen);
      if (patch.workspaceSidebarOpen !== undefined)
        preferences.workspaceSidebarOpen.set(patch.workspaceSidebarOpen);
    },
  };
}

/** UI-owned actions share the same workflow as the task board and display controls. */
export interface McpDesktopActions {
  terminalCreated(workspaceId: string, terminalId: string): void;
  terminalClosed(terminalId: string): void;
  selectTaskWorkspace(workspaceId: string): void;
  taskLaunchBusy(): boolean;
  executeTask(taskId: string): Promise<void>;
  stopTask(taskId: string): Promise<void>;
  resumeTask(taskId: string): Promise<void>;
  getPreferences(): DesktopPreferences;
  updatePreferences(patch: Partial<DesktopPreferences>): void;
}

/** Removes CSI, OSC and common terminal control sequences without stripping Unicode text. */
export function terminalPlainText(data: string): string {
  return stripTerminalControl(data, data.length);
}

@Injectable({ providedIn: 'root' })
export class McpDesktopService {
  private readonly state = inject(AppStateService);
  private readonly agents = inject(AgentService);
  private readonly todos = inject(TodoService);
  private readonly gateway = inject(TerminalGatewayService);
  private readonly repository = inject(WorkspaceRepository);
  private readonly destroyRef = inject(DestroyRef);
  private readonly bridge = inject(MCP_DESKTOP_BRIDGE);
  private actions?: McpDesktopActions;
  private unlisten?: UnlistenFn;
  private executing = false;

  async start(actions: McpDesktopActions): Promise<void> {
    if (this.bridge.mode() !== 'desktop' || this.unlisten) return;
    this.actions = actions;
    this.unlisten = await this.bridge.listen<McpToolRequest>('mcp-tool-request', ({ payload }) => {
      void this.respond(payload);
    });
    this.destroyRef.onDestroy(() => this.unlisten?.());
  }

  private async respond(request: McpToolRequest): Promise<void> {
    let value: unknown = null;
    let error: string | null = null;
    try {
      if (Date.now() > request.deadline)
        throw new Error('MCP request expired before the desktop received it');
      if (this.executing) throw new Error('A previous desktop MCP action is still running');
      this.executing = true;
      try {
        value = await this.execute(request.name, request.arguments);
      } finally {
        this.executing = false;
      }
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    try {
      await this.bridge.invoke('complete_mcp_tool', { id: request.id, value, error });
    } catch {
      // A disconnected/timed-out caller no longer has a result receiver; never retry the action.
      console.warn('MCP caller is no longer waiting for its desktop result');
    }
  }

  async execute(name: string, args: Arguments): Promise<unknown> {
    const actions = this.actions;
    if (!actions) throw new Error('Desktop MCP actions are not ready');
    switch (name) {
      case 'workspace_list':
        return this.state.workspaces().map(({ id, name, projectPath, terminals }) => ({
          id,
          name,
          projectPath,
          terminalIds: terminals.map((terminal) => terminal.id),
        }));
      case 'terminal_list': {
        if (args['workspaceId']) this.workspace(String(args['workspaceId']));
        const live = await this.gateway.liveTerminals();
        return this.state
          .workspaces()
          .filter((workspace) => !args['workspaceId'] || workspace.id === args['workspaceId'])
          .flatMap((workspace) =>
            workspace.terminals.map((terminal) => ({
              ...terminal,
              workspaceId: workspace.id,
              live: live.has(terminal.id),
            })),
          );
      }
      case 'terminal_create':
        return this.createTerminal(args);
      case 'terminal_read': {
        this.terminal(String(args['terminalId']));
        const scrollback = await this.bridge.invoke<{
          data: string;
          sequence: number;
          runtimeRevision: number;
        }>('read_terminal_scrollback', { terminalId: args['terminalId'] });
        const data =
          args['format'] === 'ansi' ? scrollback.data : terminalPlainText(scrollback.data);
        const maxChars = Number(args['maxChars'] ?? 20000);
        return { ...scrollback, data: data.slice(-maxChars), truncated: data.length > maxChars };
      }
      case 'terminal_write': {
        const { terminal } = this.terminal(String(args['terminalId']));
        await this.gateway.write(terminal, String(args['data']) + (args['submit'] ? '\r' : ''));
        return { terminalId: terminal.id, written: true };
      }
      case 'terminal_close': {
        const { terminal } = this.terminal(String(args['terminalId']));
        await this.gateway.close(terminal.id);
        actions.terminalClosed(terminal.id);
        await this.repository.flush();
        await this.todos.flush();
        return { terminalId: terminal.id, closed: true };
      }
      case 'task_list': {
        const workspace = this.workspace(String(args['workspaceId']));
        return this.todos.ensureWorkspace(workspace);
      }
      case 'task_create': {
        const workspace = this.workspace(String(args['workspaceId']));
        this.todos.ensureWorkspace(workspace);
        const task = this.todos.createTask(workspace.id, this.taskDraft(args));
        if (!task) throw new Error('Task could not be created: check project ID and title');
        await this.todos.flush();
        return task;
      }
      case 'task_update': {
        const task = this.task(String(args['taskId']));
        if (task.stage === 'executing' && task.executionState !== 'stopped') {
          throw new Error('Stop an executing task before editing it');
        }
        let updated = this.todos.updateTask(task.id, this.taskDraft(args, task));
        if (!updated) throw new Error('Task could not be updated: check project ID and title');
        if (
          task.executionState === 'stopped' &&
          args['agentType'] &&
          args['agentType'] !== task.agentType
        ) {
          updated = this.todos.returnToBacklog(task.id) ?? updated;
        }
        await this.todos.flush();
        return updated;
      }
      case 'task_delete': {
        const task = this.task(String(args['taskId']));
        if (task.stage === 'executing' && task.executionState !== 'stopped') {
          throw new Error('Stop an executing task before deleting it');
        }
        if (!this.todos.deleteTask(task.id)) throw new Error('Task could not be deleted');
        await this.todos.flush();
        return { taskId: task.id, deleted: true };
      }
      case 'task_execute':
      case 'task_resume': {
        const task = this.task(String(args['taskId']));
        if (name === 'task_execute' && task.stage !== 'todo' && task.executionState !== 'failed') {
          throw new Error(
            'Only pending or failed tasks can be executed; use task_resume for stopped tasks',
          );
        }
        if (name === 'task_resume' && task.executionState !== 'stopped') {
          throw new Error('Only stopped tasks can be resumed');
        }
        const attempts = task.attempts;
        if (actions.taskLaunchBusy()) throw new Error('Another task launch is in progress');
        actions.selectTaskWorkspace(task.workspaceId);
        if (name === 'task_resume') await actions.resumeTask(task.id);
        else await actions.executeTask(task.id);
        const result = this.task(task.id);
        await this.todos.flush();
        if (result.executionState === 'failed')
          throw new Error(result.lastError || 'Task launch failed');
        if (name === 'task_execute' && result.attempts === attempts)
          throw new Error('Task did not start; the desktop may be busy');
        if (name === 'task_resume' && result.executionState === 'stopped')
          throw new Error('Task did not resume; the desktop may be busy');
        return result;
      }
      case 'task_stop': {
        const task = this.task(String(args['taskId']));
        if (task.stage !== 'executing' || task.executionState === 'stopped')
          throw new Error('Task is not running');
        await actions.stopTask(task.id);
        await this.todos.flush();
        return this.task(task.id);
      }
      case 'task_complete': {
        const task = this.task(String(args['taskId']));
        if (task.stage !== 'executing')
          throw new Error('Only executing tasks can be marked completed');
        if (task.promptDeliveryState === 'pending' || task.promptDeliveryState === 'sending') {
          throw new Error(
            'Wait for task instructions to reach the agent before marking it completed',
          );
        }
        const result = this.todos.markCompleted(task.id);
        await this.todos.flush();
        return result;
      }
      case 'task_verify': {
        const task = this.task(String(args['taskId']));
        const result = this.todos.verifyTask(task.id, String(args['note'] ?? ''));
        if (!result) throw new Error('Only completed tasks can be verified');
        await this.todos.flush();
        return result;
      }
      case 'settings_get':
        return {
          ...actions.getPreferences(),
          modelProfiles: this.agents
            .modelProfiles()
            .map(({ credentialTarget: _target, ...profile }) => profile),
          networkProfiles: this.agents
            .networkProfiles()
            .map(({ credentialTarget: _target, ...profile }) => profile),
        };
      case 'settings_update':
        actions.updatePreferences(args as Partial<DesktopPreferences>);
        return actions.getPreferences();
      case 'model_profile_update': {
        const profile = this.agents.modelProfiles().find((item) => item.id === args['profileId']);
        if (!profile) throw new Error('Model profile not found');
        const { profileId: _id, ...patch } = args;
        const { credentialTarget: _target, hasCredential: _has, ...input } = profile;
        await this.agents.saveModelProfile({
          ...input,
          ...patch,
          clearCredential: false,
        } as ModelProfileInput);
        const updated = this.agents.modelProfiles().find((item) => item.id === profile.id)!;
        const { credentialTarget: _credentialTarget, ...publicProfile } = updated;
        return publicProfile;
      }
      case 'network_profile_update': {
        const profile = this.agents.networkProfiles().find((item) => item.id === args['profileId']);
        if (!profile) throw new Error('Network profile not found');
        const { profileId: _id, ...patch } = args;
        const { credentialTarget: _target, hasCredential: _has, ...input } = profile;
        await this.agents.saveNetworkProfile({
          ...input,
          ...patch,
          clearCredential: false,
        } as NetworkProfileInput);
        const updated = this.agents.networkProfiles().find((item) => item.id === profile.id)!;
        const { credentialTarget: _credentialTarget, ...publicProfile } = updated;
        return publicProfile;
      }
      default:
        throw new Error(`Unknown MCP tool: ${name}`);
    }
  }

  private async createTerminal(args: Arguments): Promise<TerminalSession> {
    const workspace = this.workspace(String(args['workspaceId']));
    const terminal = this.state.createTerminal(
      {
        agentType: 'shell',
        name: args['name'] as string | undefined,
        command: args['command'] as string | undefined,
        workingDirectory: args['workingDirectory'] as string | undefined,
      },
      workspace.id,
    );
    if (!terminal) throw new Error('Terminal could not be created');
    try {
      await this.gateway.start(terminal, 120, 30, workspace.id);
    } catch (error) {
      this.state.removeTerminal(terminal.id);
      await this.repository.flush();
      throw error;
    }
    this.actions!.terminalCreated(workspace.id, terminal.id);
    await this.repository.flush();
    return terminal;
  }

  private workspace(id: string): Workspace {
    const workspace = this.state.workspaces().find((workspace) => workspace.id === id);
    if (!workspace) throw new Error('Workspace not found');
    return workspace;
  }

  private terminal(id: string): { workspace: Workspace; terminal: TerminalSession } {
    for (const workspace of this.state.workspaces()) {
      const terminal = workspace.terminals.find((terminal) => terminal.id === id);
      if (terminal) return { workspace, terminal };
    }
    throw new Error('Terminal not found');
  }

  private task(id: string): TodoTask {
    const task = this.todos.task(id);
    if (!task) throw new Error('Task not found');
    return task;
  }

  private taskDraft(args: Arguments, existing?: TodoTask): TodoTaskDraft {
    const agentType = (args['agentType'] ??
      existing?.agentType ??
      'claude') as TodoTaskDraft['agentType'];
    const ownsModel = agentType === 'opencode' || agentType === 'grok';
    const retainedProfile = existing?.agentType === agentType ? existing.profileId : undefined;
    const profiles = ownsModel
      ? []
      : this.agents
          .modelProfiles()
          .filter((profile) => profileServes(profile, agentType as AgentProtocol));
    const profileId = String(
      args['profileId'] ??
        retainedProfile ??
        profiles.find((profile) => profile.isDefault)?.id ??
        profiles[0]?.id ??
        '',
    );
    const profile = profiles.find((profile) => profile.id === profileId);
    if (!ownsModel && !profile) throw new Error('Choose a model profile enabled for this agent');
    return {
      projectId: String(args['projectId'] ?? existing?.projectId ?? ''),
      title: String(args['title'] ?? existing?.title ?? ''),
      description: String(args['description'] ?? existing?.description ?? ''),
      acceptanceCriteria: String(args['acceptanceCriteria'] ?? existing?.acceptanceCriteria ?? ''),
      priority: (args['priority'] ?? existing?.priority ?? 'medium') as TodoTaskDraft['priority'],
      agentType,
      profileId: ownsModel ? '' : profileId,
      modelName: String(
        args['modelName'] ??
          (existing?.agentType === agentType ? existing.modelName : undefined) ??
          (profile ? profileModel(profile, agentType as AgentProtocol) : ''),
      ),
      workingDirectory: String(args['workingDirectory'] ?? existing?.workingDirectory ?? ''),
      preferredTerminalId: (args['preferredTerminalId'] ?? existing?.preferredTerminalId) as
        string | undefined,
      recurring: (args['recurring'] ?? existing?.recurring ?? false) as boolean,
    };
  }
}
