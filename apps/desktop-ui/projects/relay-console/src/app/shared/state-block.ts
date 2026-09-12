import { Component, input, output } from '@angular/core';

import { TranslatePipe } from './workspace-ui';

/** Which of the four states a page's data is in; `ready` renders the data itself instead. */
export type PageState = 'loading' | 'ready' | 'error' | 'empty';

/**
 * The three states that are not the data: loading, failed and nothing-there.
 *
 * Every page routes them through here so a failure always offers a retry and an empty list
 * always says what to do next, instead of each page inventing its own wording.
 */
@Component({
  selector: 'console-state-block',
  imports: [TranslatePipe],
  template: `
    @switch (state()) {
      @case ('loading') {
        <div class="state-block" role="status">{{ 'console.common.loading' | t }}</div>
      }
      @case ('error') {
        <div class="state-block" role="alert">
          <strong>{{ error() }}</strong>
          <button type="button" class="btn" (click)="retry.emit()">
            {{ 'console.common.retry' | t }}
          </button>
        </div>
      }
      @case ('empty') {
        <div class="state-block">
          <strong>{{ emptyTitle() }}</strong>
          <span>{{ emptyHelp() }}</span>
          @if (actionLabel()) {
            <button type="button" class="btn btn-primary" (click)="action.emit()">
              {{ actionLabel() }}
            </button>
          }
        </div>
      }
    }
  `,
})
export class StateBlockComponent {
  readonly state = input.required<PageState>();
  readonly error = input('');
  readonly emptyTitle = input('');
  readonly emptyHelp = input('');
  /** Leave empty when the empty state has no single next step to offer. */
  readonly actionLabel = input('');

  readonly retry = output<void>();
  readonly action = output<void>();
}
