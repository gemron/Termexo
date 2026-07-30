import { Component, computed, input } from '@angular/core';

import { AgentEvent } from '../core/models/agent.models';
import {
  AGENT_LABELS,
  TERMINAL_STATUS_LABELS,
  TerminalSession,
  Workspace,
} from '../core/models/workspace.models';
import { IconComponent } from '../shared/icon/icon';

const EVENT_LABELS: Readonly<Record<string, string>> = {
  'session.started': '会话已启动',
  'agent.thinking': 'Claude 正在思考',
  'tool.started': '工具调用开始',
  'tool.completed': '工具调用完成',
  'tool.failed': '工具调用失败',
  'approval.required': '等待权限确认',
  'user.input.required': '等待用户输入',
  'agent.rate_limited': '供应商 429 限流',
  'agent.timeout': 'Claude 请求超时',
  'task.completed': '任务已完成',
  'agent.failed': 'Agent 运行失败',
  'session.ended': '会话已结束',
};

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
  protected readonly recentEvents = computed(() => {
    const terminalId = this.activeTerminal()?.id;
    return this.events()
      .filter((event) => !terminalId || event.terminalId === terminalId)
      .slice(0, 12);
  });

  protected readonly agentLabels = AGENT_LABELS;
  protected readonly statusLabels = TERMINAL_STATUS_LABELS;

  protected eventLabel(event: AgentEvent): string {
    return EVENT_LABELS[event.eventType] ?? 'Agent 状态更新';
  }

  protected eventDetail(event: AgentEvent): string {
    const detail = event.detail;
    return String(
      detail['tool_name'] ??
        detail['notification_type'] ??
        detail['error_details'] ??
        detail['error'] ??
        detail['source'] ??
        event.nativeSessionId ??
        'Claude Code',
    );
  }

  protected eventTime(event: AgentEvent): string {
    return new Date(event.createdAt).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }
}
