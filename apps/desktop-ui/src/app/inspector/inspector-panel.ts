import { Component, computed, inject, input } from '@angular/core';

import { AgentEvent } from '../core/models/agent.models';
import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  AGENT_LABELS,
  TerminalSession,
  TerminalStatus,
  Workspace,
} from '../core/models/workspace.models';
import { IconComponent } from '../shared/icon/icon';

const EVENT_LABELS: Readonly<Record<string, string>> = {
  'session.started': 'event.sessionStarted',
  'agent.thinking': 'event.agentThinking',
  'tool.started': 'event.toolStarted',
  'tool.completed': 'event.toolCompleted',
  'tool.failed': 'event.toolFailed',
  'approval.required': 'event.approvalRequired',
  'user.input.required': 'event.inputRequired',
  'agent.rate_limited': 'event.rateLimited',
  'agent.timeout': 'event.timeout',
  'task.completed': 'event.taskCompleted',
  'agent.failed': 'event.agentFailed',
  'session.ended': 'event.sessionEnded',
};

@Component({
  selector: 'app-inspector-panel',
  imports: [IconComponent, TranslatePipe],
  templateUrl: './inspector-panel.html',
  styleUrl: './inspector-panel.scss',
})
export class InspectorPanelComponent {
  private readonly i18n = inject(I18nService);
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

  protected eventLabel(event: AgentEvent): string {
    return this.i18n.t(EVENT_LABELS[event.eventType] ?? 'event.updated');
  }

  protected statusLabel(status: TerminalStatus): string {
    const keys: Record<TerminalStatus, string> = {
      STARTING: 'status.starting',
      RUNNING: 'status.running',
      THINKING: 'status.thinking',
      WAITING_INPUT: 'status.waitingInput',
      WAITING_APPROVAL: 'status.waitingApproval',
      RATE_LIMITED: 'status.rateLimited',
      IDLE: 'status.idle',
      COMPLETED: 'status.completed',
      FAILED: 'status.failed',
      STOPPED: 'status.stopped',
      DISCONNECTED: 'status.disconnected',
    };
    return this.i18n.t(keys[status]);
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
    return this.i18n.formatTime(event.createdAt);
  }
}
