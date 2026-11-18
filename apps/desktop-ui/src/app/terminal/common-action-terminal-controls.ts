import { Component, computed, input, output } from '@angular/core';

import '../core/i18n/workspace-tools.i18n';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { isFinishedCommonAction, type CommonActionOperation } from '../core/models/common-action';
import type { CommonAction, TerminalStatus } from '../core/models/workspace.models';
import { IconComponent } from '../shared/icon/icon';

@Component({
  selector: 'app-common-action-terminal-controls',
  imports: [IconComponent, TranslatePipe],
  template: `
    @if (!readOnly()) {
      <div class="common-action-controls" role="group"
        [attr.aria-label]="('commonActions.terminalControls' | t) + ': ' + action().name"
        [attr.aria-busy]="busy()" (mousedown)="$event.stopPropagation()">
        <span class="action-command" [title]="action().command">
          <app-icon name="command" [size]="12" />
          <code>{{ action().command }}</code>
        </span>
        <div class="action-buttons">
          @if (finished()) {
            <button type="button" class="btn btn-xs run-action" data-action="run"
              [disabled]="busy()" (click)="$event.stopPropagation(); request('run')">
              <app-icon name="play" [size]="12" />
              {{ 'commonActions.runAgain' | t }}
            </button>
          } @else {
            <button type="button" class="btn btn-xs run-action" data-action="restart"
              [disabled]="busy()" (click)="$event.stopPropagation(); request('restart')">
              <app-icon name="refresh" [size]="12" />
              {{ 'commonActions.restart' | t }}
            </button>
            <button type="button" class="btn btn-xs stop-action" data-action="stop"
              [disabled]="busy()" (click)="$event.stopPropagation(); request('stop')">
              <app-icon name="square" [size]="11" />
              {{ 'commonActions.stop' | t }}
            </button>
          }
        </div>
      </div>
    }
  `,
  styleUrl: './common-action-terminal-controls.scss',
})
export class CommonActionTerminalControlsComponent {
  readonly action = input.required<CommonAction>();
  readonly status = input.required<TerminalStatus>();
  readonly busy = input(false);
  readonly readOnly = input(false);
  readonly operationRequested = output<CommonActionOperation>();

  protected readonly finished = computed(() =>
    isFinishedCommonAction({ commonActionId: this.action().id, status: this.status() }),
  );

  protected request(operation: CommonActionOperation): void {
    if (!this.busy() && !this.readOnly()) this.operationRequested.emit(operation);
  }
}
