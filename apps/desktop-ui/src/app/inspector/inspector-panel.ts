import { Component, input, signal } from '@angular/core';

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
  readonly tab = signal<InspectorTab>('agents');

  protected readonly agentLabels = AGENT_LABELS;
  protected readonly statusLabels = TERMINAL_STATUS_LABELS;
  protected readonly git = GIT_SUMMARY;
  protected readonly tasks = TASKS;
}
