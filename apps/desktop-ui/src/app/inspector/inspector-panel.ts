import { Component, computed, input, signal } from '@angular/core';

import { AgentEvent } from '../core/models/agent.models';
import {
  AGENT_LABELS,
  GitSummary,
  TaskSummary,
  TERMINAL_STATUS_LABELS,
  TerminalSession,
  Workspace,
} from '../core/models/workspace.models';
import { IconComponent } from '../shared/icon/icon';

type InspectorTab = 'agents' | 'git' | 'tasks';

const EVENT_LABELS: Readonly<Record<string, string>> = {
  'session.started': '会话已启动',
  'agent.thinking': 'Claude 正在思考',
  'tool.started': '工具调用开始',
  'tool.completed': '工具调用完成',
  'tool.failed': '工具调用失败',
  'approval.required': '等待权限确认',
  'user.input.required': '等待用户输入',
  'task.completed': '任务已完成',
  'agent.failed': 'Agent 运行失败',
  'session.ended': '会话已结束',
};

const GIT_SUMMARY: GitSummary = {
  branch: 'feature/terminal-runtime',
  ahead: 2,
  behind: 0,
  changedFiles: 7,
  additions: 284,
  deletions: 41,
};

const TASKS: TaskSummary[] = [
  {
    id: 'task-1',
    title: '实现 PTY 进程管理',
    status: '进行中',
    progress: 72,
  },
  {
    id: 'task-2',
    title: 'Workspace 快照恢复',
    status: '等待确认',
    progress: 90,
  },
  {
    id: 'task-3',
    title: '终端布局持久化',
    status: '已完成',
    progress: 100,
  },
];

@Component({
  selector: 'app-inspector-panel',
  imports: [IconComponent],
  templateUrl: './inspector-panel.html',
  styleUrl: './inspector-panel.scss',
})
export class InspectorPanelComponent {
  readonly workspace = input<Workspace | null>(null);
  readonly activeTerminal = input<TerminalSession | null>(null);
  readonly events = input<AgentEvent[]>([]);
  readonly tab = signal<InspectorTab>('agents');
  protected readonly recentEvents = computed(() => {
    const terminalId = this.activeTerminal()?.id;
    return this.events()
      .filter((event) => !terminalId || event.terminalId === terminalId)
      .slice(0, 4);
  });

  protected readonly agentLabels = AGENT_LABELS;
  protected readonly statusLabels = TERMINAL_STATUS_LABELS;
  protected readonly git = GIT_SUMMARY;
  protected readonly tasks = TASKS;

  protected eventLabel(event: AgentEvent): string {
    return EVENT_LABELS[event.eventType] ?? 'Agent 状态更新';
  }

  protected eventDetail(event: AgentEvent): string {
    const detail = event.detail;
    return String(
      detail['tool_name'] ??
        detail['notification_type'] ??
        detail['source'] ??
        event.nativeSessionId ??
        'Claude Code',
    );
  }
}
