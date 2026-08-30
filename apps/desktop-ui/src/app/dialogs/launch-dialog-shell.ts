import { Component, ElementRef, afterNextRender, input, output, viewChild } from '@angular/core';

import { TranslatePipe } from '../core/i18n/translate.pipe';
import { AgentInstallation } from '../core/models/agent.models';
import { IconComponent } from '../shared/icon/icon';

/**
 * The frame shared by every "new agent session" dialog.
 *
 * Claude, Codex and OpenCode differ only in the fields they collect, but each one used to carry its
 * own copy of the header, installation banner and footer. The copies drifted, so the three windows
 * looked and behaved differently. Owning the frame here keeps them identical and leaves each dialog
 * with nothing but its own form.
 */
@Component({
  selector: 'app-launch-dialog-shell',
  imports: [IconComponent, TranslatePipe],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="dismiss()">
      <section
        #dialog
        class="agent-dialog compact modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="launch-dialog-title"
        (mousedown)="$event.stopPropagation()"
        (keydown)="handleKeydown($event)"
      >
        <header>
          <div class="dialog-title">
            <span class="title-icon"><app-icon [name]="icon()" [size]="17" /></span>
            <div>
              <h2 id="launch-dialog-title">{{ heading() }}</h2>
              <p [title]="workingDirectory()">{{ workingDirectory() }}</p>
            </div>
          </div>
          <button
            type="button"
            class="btn btn-square btn-ghost btn-sm"
            [title]="'common.close' | t"
            [attr.aria-label]="'common.close' | t"
            [disabled]="launching()"
            (click)="dismiss()"
          >
            <app-icon name="x" [size]="15" />
          </button>
        </header>

        <div class="installation-line" [class.unavailable]="!installation()?.healthy">
          <i></i>
          <span>{{ installation()?.diagnostic ?? detecting() }}</span>
          <code>{{ installation()?.version ?? '' }}</code>
        </div>

        <ng-content />

        <footer>
          <button
            type="button"
            class="secondary btn btn-ghost btn-sm"
            [disabled]="launching()"
            (click)="dismiss()"
          >
            {{ 'common.cancel' | t }}
          </button>
          <button
            type="button"
            class="primary btn btn-primary btn-sm"
            [disabled]="!canLaunch() || launching()"
            [attr.title]="blockedReason() || null"
            (click)="submit()"
          >
            @if (launching()) {
              <app-icon class="spinning" name="refresh" [size]="13" />{{ 'launch.starting' | t }}
            } @else {
              <app-icon name="play" [size]="13" />{{ 'launch.start' | t }}
            }
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrls: ['./agent-dialog.scss', './launch-dialog.scss'],
})
export class LaunchDialogShellComponent {
  readonly icon = input.required<string>();
  readonly heading = input.required<string>();
  /** Stands in for the installation banner until detection reports back. */
  readonly detecting = input.required<string>();
  readonly installation = input<AgentInstallation | null>(null);
  readonly workingDirectory = input('');
  readonly canLaunch = input(false);
  readonly launching = input(false);
  /** Why launching is blocked, surfaced as the disabled button's tooltip so it is never silent. */
  readonly blockedReason = input('');
  readonly launched = output<void>();
  readonly cancelled = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');

  constructor() {
    // `autofocus` only applies while the document is being parsed, so a dialog created later never
    // receives it. The first field has to claim focus itself once the projected form exists.
    afterNextRender(() => {
      this.dialog()
        .nativeElement.querySelector<HTMLElement>('input:not([type="checkbox"]), select')
        ?.focus();
    });
  }

  protected handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      // The workbench listens for Escape on the window; an open dialog owns the key instead.
      event.stopPropagation();
      this.dismiss();
      return;
    }
    // An IME reports `isComposing` while its candidate list is open, where Enter picks a candidate.
    // Submitting there would launch a session as the user finishes typing a Chinese name.
    if (event.key !== 'Enter' || event.isComposing) {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('button, textarea')) {
      return;
    }
    event.preventDefault();
    this.submit();
  }

  protected submit(): void {
    if (!this.canLaunch() || this.launching()) {
      return;
    }
    this.launched.emit();
  }

  /** Dismissal is refused mid-launch so the window stays until the result is known. */
  protected dismiss(): void {
    if (this.launching()) {
      return;
    }
    this.cancelled.emit();
  }
}
