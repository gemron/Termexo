import { inject, Injectable, signal } from '@angular/core';

import { createId } from '../models/identifiers';
import type { CommonAction, Workspace } from '../models/workspace.models';
import { AppStateService } from './app-state.service';
import { TerminalGatewayService } from './terminal-gateway.service';
import { hasBackend } from './tauri-runtime';
import { WorkspaceRepository } from './workspace.repository';

export interface ActionSuggestion extends CommonAction {
  selected: boolean;
}
export interface ActionReview {
  requestId: string;
  waiting: boolean;
  suggestions: ActionSuggestion[];
  terminalId?: string;
  phase?: 'starting' | 'reading';
  error?: string;
  duplicateCount?: number;
}

const MAX_ACTIONS = 20;
const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 30;

export function validateCommonAction(value: unknown): Omit<CommonAction, 'id'> {
  if (!value || typeof value !== 'object') throw new Error('操作必须是 JSON 对象。');
  const action = value as Record<string, unknown>;
  const field = (key: string, max: number, required = true): string => {
    const value = action[key] ?? '';
    if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
      throw new Error(`操作的 ${key} 为空或超出长度限制。`);
    if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('操作字段不能包含换行或控制字符。');
    return value.trim();
  };
  const workingDirectory = field('workingDirectory', 2000);
  if (!/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(workingDirectory))
    throw new Error('工作目录必须是绝对路径。');
  return {
    name: field('name', 100),
    command: field('command', 4000),
    workingDirectory,
    description: field('description', 2000, false),
  };
}

function signature(action: CommonAction): string {
  return `${action.workingDirectory.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase()}\n${action.command}`;
}

@Injectable({ providedIn: 'root' })
export class CommonActionsService {
  private readonly state = inject(AppStateService);
  private readonly gateway = inject(TerminalGatewayService);
  private readonly repository = inject(WorkspaceRepository);
  readonly reviews = signal<Record<string, ActionReview>>({});
  readonly busy = signal<ReadonlySet<string>>(new Set());

  workspace(id: string): Workspace {
    const workspace = this.state.workspaces().find((item) => item.id === id);
    if (!workspace) throw new Error('项目不存在。');
    return workspace;
  }

  beginRecognition(workspaceId: string, terminalId?: string, phase: 'starting' | 'reading' = 'reading'): string {
    this.workspace(workspaceId);
    if (this.reviews()[workspaceId]?.waiting) throw new Error('正在识别，请等待结果或取消本次识别。');
    const requestId = createId();
    this.reviews.update((items) => ({
      ...items,
      [workspaceId]: { requestId, waiting: true, suggestions: [], terminalId, phase },
    }));
    return requestId;
  }

  updateRecognition(workspaceId: string, requestId: string, patch: Pick<Partial<ActionReview>, 'phase' | 'error' | 'waiting'>): void {
    this.reviews.update((items) => {
      const review = items[workspaceId];
      return review?.requestId === requestId && review.waiting
        ? { ...items, [workspaceId]: { ...review, ...patch } }
        : items;
    });
  }

  discard(workspaceId: string): void {
    this.reviews.update((items) => {
      const next = { ...items };
      delete next[workspaceId];
      return next;
    });
  }

  /** AI can stage proposals; it has no API for confirming or persisting them. */
  propose(workspaceId: string, requestId: string, actionsJson: string): ActionReview {
    this.workspace(workspaceId);
    const current = this.reviews()[workspaceId];
    if (!current || current.requestId !== requestId || !current.waiting)
      throw new Error('识别请求已取消或过期，请重新开始识别。');
    if (actionsJson.length > 100_000) throw new Error('建议内容过长。');
    let values: unknown;
    try {
      values = JSON.parse(actionsJson);
    } catch {
      throw new Error('无法解析建议，请粘贴完整的 JSON 数组。');
    }
    if (!Array.isArray(values) || values.length > MAX_ACTIONS)
      throw new Error(`建议必须是最多 ${MAX_ACTIONS} 项的 JSON 数组。`);
    const candidates = values.map((value) => ({
      ...validateCommonAction(value),
      id: createId(),
      selected: true,
    }));
    const signatures = new Set((this.workspace(workspaceId).commonActions ?? []).map(signature));
    const suggestions = candidates.filter((item) => {
      const key = signature(item);
      if (signatures.has(key)) return false;
      signatures.add(key);
      return true;
    });
    const review = { ...current, waiting: false, suggestions, duplicateCount: candidates.length - suggestions.length };
    this.reviews.update((items) => ({ ...items, [workspaceId]: review }));
    return review;
  }

  editSuggestion(workspaceId: string, id: string, patch: Partial<ActionSuggestion>): void {
    this.reviews.update((items) => {
      const review = items[workspaceId];
      if (!review) return items;
      return {
        ...items,
        [workspaceId]: {
          ...review,
          suggestions: review.suggestions.map((item) =>
            item.id === id ? { ...item, ...patch, id } : item,
          ),
        },
      };
    });
  }

  async confirm(workspaceId: string): Promise<void> {
    await this.exclusive(workspaceId, async () => {
      const review = this.reviews()[workspaceId];
      if (!review || review.waiting) throw new Error('请先等待识别完成。');
      const selected = review.suggestions.filter((item) => item.selected);
      if (!selected.length) throw new Error('请选择要添加的操作。');
      const actions = [...(this.workspace(workspaceId).commonActions ?? [])];
      for (const item of selected) {
        const action = { ...validateCommonAction(item), id: item.id };
        if (!actions.some((saved) => signature(saved) === signature(action))) actions.push(action);
      }
      await this.state.saveCommonActions(workspaceId, actions);
      this.discard(workspaceId);
    });
  }

  async save(workspaceId: string, draft: CommonAction): Promise<void> {
    await this.exclusive(workspaceId, async () => {
      const actions = [...(this.workspace(workspaceId).commonActions ?? [])];
      const index = actions.findIndex((item) => item.id === draft.id);
      const action = {
        ...validateCommonAction(draft),
        id: draft.id,
        terminalId: actions[index]?.terminalId,
      };
      if (index < 0) actions.push(action);
      else actions[index] = action;
      await this.state.saveCommonActions(workspaceId, actions);
    });
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    await this.exclusive(workspaceId, () =>
      this.state.saveCommonActions(
        workspaceId,
        (this.workspace(workspaceId).commonActions ?? []).filter((item) => item.id !== id),
      ),
    );
  }

  async run(workspaceId: string, id: string, restart = false): Promise<string> {
    return this.exclusive(workspaceId, async () => {
      if (!hasBackend()) throw new Error('请在桌面应用中运行常用操作。');
      const workspace = this.workspace(workspaceId);
      const action = this.action(workspaceId, id);
      validateCommonAction(action);
      const previous = workspace.terminals.find(
        (item) => item.id === action.terminalId && item.commonActionId === id,
      );
      const live = await this.gateway.liveTerminals();
      if (previous && live.has(previous.id) && !restart) return previous.id;
      if (previous) {
        if (live.has(previous.id)) await this.gateway.close(previous.id);
        this.state.removeTerminal(previous.id);
      }
      const terminal = this.state.createTerminal(
        {
          agentType: 'shell',
          commonActionId: id,
          name: action.name,
          command: action.command,
          workingDirectory: action.workingDirectory,
        },
        workspaceId,
      );
      if (!terminal) throw new Error('无法创建操作终端。');
      try {
        await this.gateway.start(
          terminal,
          DEFAULT_TERMINAL_COLS,
          DEFAULT_TERMINAL_ROWS,
          workspaceId,
        );
        await this.state.saveCommonActions(
          workspaceId,
          (this.workspace(workspaceId).commonActions ?? []).map((item) =>
            item.id === id ? { ...item, terminalId: terminal.id } : item,
          ),
        );
        await this.repository.flush();
        return terminal.id;
      } catch (error) {
        try {
          await this.gateway.close(terminal.id);
        } catch (cleanupError) {
          this.state.markTerminalExited(terminal.id, 'FAILED');
          throw new Error(
            `操作启动未完成，且无法确认终端已停止。请在终端列表检查：${String(cleanupError)}`,
          );
        }
        this.state.removeTerminal(terminal.id);
        await this.repository.flush();
        throw error;
      }
    });
  }

  async stop(workspaceId: string, id: string): Promise<void> {
    await this.exclusive(workspaceId, async () => {
      const action = this.action(workspaceId, id);
      const terminal = this.workspace(workspaceId).terminals.find(
        (item) => item.id === action.terminalId && item.commonActionId === id,
      );
      if (!terminal) throw new Error('操作尚未启动。');
      const live = await this.gateway.liveTerminals();
      if (live.has(terminal.id)) await this.gateway.close(terminal.id);
      this.state.markTerminalExited(terminal.id, 'STOPPED');
      await this.repository.flush();
    });
  }

  private action(workspaceId: string, id: string): CommonAction {
    const action = this.workspace(workspaceId).commonActions?.find((item) => item.id === id);
    if (!action) throw new Error('常用操作不存在。');
    return action;
  }

  private async exclusive<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    if (this.busy().has(workspaceId)) throw new Error('此项目的操作正在处理中。');
    this.busy.update((items) => new Set([...items, workspaceId]));
    try {
      return await operation();
    } finally {
      this.busy.update((items) => new Set([...items].filter((id) => id !== workspaceId)));
    }
  }
}
