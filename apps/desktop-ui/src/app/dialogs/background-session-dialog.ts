import { Component, input, output } from '@angular/core';

import { TranslatePipe } from '../core/i18n/translate.pipe';
import { BackgroundSessionResolution, ClaudeBackgroundSession } from '../core/models/agent.models';
import { IconComponent } from '../shared/icon/icon';

/**
 * Asks what to do with Claude sessions that are still working in the background.
 *
 * Claude Code keeps a session alive when its terminal goes away, and refuses to resume one in
 * place. Idle sessions are stopped and resumed without asking; these are mid-turn, so stopping
 * them would throw away work only the user can judge.
 */
@Component({
  selector: 'app-background-session-dialog',
  imports: [IconComponent, TranslatePipe],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="resolved.emit('skip')">
      <section
        class="dialog modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="background-session-dialog-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div>
            <h2 id="background-session-dialog-title">{{ 'session.backgroundTitle' | t }}</h2>
            <p>{{ 'session.backgroundDescription' | t }}</p>
          </div>
        </header>

        <ul class="background-session-list">
          @for (session of sessions(); track session.shortId) {
            <li>
              <span class="background-session-mark" aria-hidden="true">
                <app-icon name="activity" [size]="14" />
              </span>
              <div>
                <strong>{{ session.name || session.shortId }}</strong>
                <small>{{ session.shortId }}</small>
              </div>
            </li>
          }
        </ul>

        <footer>
          <button
            type="button"
            class="secondary btn btn-ghost btn-sm"
            (click)="resolved.emit('skip')"
          >
            {{ 'session.backgroundSkip' | t }}
          </button>
          <button type="button" class="btn btn-ghost btn-sm" (click)="resolved.emit('attach')">
            <app-icon name="link" [size]="14" />
            {{ 'session.backgroundAttach' | t }}
          </button>
          <button type="button" class="btn btn-primary btn-sm" (click)="resolved.emit('fork')">
            <app-icon name="merge" [size]="14" />
            {{ 'session.backgroundFork' | t }}
          </button>
        </footer>
      </section>
    </div>
  `,
  styles: `
    .background-session-list {
      display: grid;
      max-height: 220px;
      gap: 4px;
      overflow-y: auto;
      padding: 0;
      margin: 0;
      list-style: none;
    }

    .background-session-list li {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: var(--radius-field);
      background: var(--surface-inset);
    }

    .background-session-list strong {
      display: block;
      font-size: 12px;
      font-weight: 600;
    }

    .background-session-list small {
      color: var(--text-muted);
      font: 9px/1.4 var(--mono);
    }

    .background-session-mark {
      display: grid;
      width: 26px;
      height: 26px;
      flex: 0 0 auto;
      place-items: center;
      border-radius: var(--radius-selector);
      color: var(--color-warning);
      background: color-mix(in srgb, var(--color-warning) 14%, transparent);
    }
  `,
  styleUrls: ['./dialog.scss'],
})
export class BackgroundSessionDialogComponent {
  readonly sessions = input.required<readonly ClaudeBackgroundSession[]>();
  readonly resolved = output<BackgroundSessionResolution>();
}
