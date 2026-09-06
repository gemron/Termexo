import { Component, HostListener, input, output, signal } from '@angular/core';

import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { IconComponent } from '../icon/icon';
import { LanguageSelectorComponent } from '../language-selector/language-selector';

/**
 * Stands in for the tools at the right of the topbar while the window is phone width.
 *
 * Those tools plus the toolbar are wider than a phone, and the bar answers that by scrolling
 * sideways — which hides whatever ends up past its right edge, new terminal included, behind a
 * gesture nothing hints at. Every tool folded in here is occasional, so a tap to reach them buys
 * the room the frequent controls need.
 *
 * Loaded only at phone width, which is also why the styles carry no media query: the desktop bar
 * never renders this.
 */
@Component({
  selector: 'app-topbar-overflow-menu',
  imports: [IconComponent, LanguageSelectorComponent, TranslatePipe],
  template: `
    <div class="overflow-anchor">
      <button
        type="button"
        class="overflow-trigger"
        data-testid="overflow-menu"
        [class.active]="open()"
        [attr.aria-expanded]="open()"
        aria-haspopup="menu"
        [title]="'workspace.moreTools' | t"
        [attr.aria-label]="'workspace.moreTools' | t"
        (click)="open.set(!open())"
      >
        <app-icon name="more" [size]="15" />
      </button>

      @if (open()) {
        <!--
          Opens over the topbar, so it opts out of the drag region it sits in. Closing on the
          container covers every item without repeating it on each one.
        -->
        <div
          class="overflow-menu"
          role="menu"
          data-tauri-drag-region="false"
          (click)="open.set(false)"
        >
          @if (showInspector()) {
            <button type="button" role="menuitem" (click)="inspectorToggled.emit()">
              <span><app-icon name="panel-right-open" [size]="14" /></span>
              <strong>{{
                (inspectorOpen() ? 'inspector.collapse' : 'inspector.expand') | t
              }}</strong>
            </button>
          }
          <button type="button" role="menuitem" (click)="sessionCenterOpened.emit()">
            <span><app-icon name="history" [size]="14" /></span>
            <strong>{{ 'terminal.sessionCenter' | t }}</strong>
          </button>
          <button type="button" role="menuitem" (click)="settingsOpened.emit()">
            <span><app-icon name="settings" [size]="14" /></span>
            <strong>{{ 'workspace.settings' | t }}</strong>
          </button>
          <!--
            A native select, so it takes the row shape without borrowing the button rule, and it
            brings its own icon — hence no chip of its own, only the indent that lines the label
            up with the ones above.
          -->
          <label class="menu-row">
            <strong>{{ 'language.label' | t }}</strong>
            <app-language-selector />
          </label>
        </div>
      }
    </div>
  `,
  styles: `
    .overflow-anchor {
      position: relative;
    }

    /* Mirrors .window-tool in app.scss, at the touch size the phone breakpoint gives those. */
    .overflow-trigger {
      display: grid;
      width: 32px;
      height: 32px;
      place-items: center;
      border: 0;
      border-radius: 3px;
      color: var(--text-muted);
      background: transparent;
      transition:
        color 140ms ease,
        background-color 140ms ease;
    }

    .overflow-trigger:hover,
    .overflow-trigger:focus-visible,
    .overflow-trigger.active {
      color: var(--text);
      background: var(--surface-2);
      outline: 0;
    }

    /*
      Fixed rather than absolute: the toolbar beside it scrolls sideways at this width, and a
      scrolling ancestor clips an absolutely positioned descendant out of sight.
    */
    .overflow-menu {
      position: fixed;
      z-index: 20;
      top: calc(var(--topbar-height) + 4px);
      right: 8px;
      width: 232px;
      max-height: 80dvh;
      padding: 5px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-box);
      background: var(--surface-raised);
      box-shadow: 0 14px 35px rgb(0 0 0 / 40%);
      overflow-y: auto;
      animation: overflow-menu-enter 140ms ease-out;
    }

    .overflow-menu button,
    .overflow-menu .menu-row {
      display: grid;
      width: 100%;
      align-items: center;
      gap: 8px;
      padding: 7px;
      border: 0;
      border-radius: var(--radius-field);
      color: var(--text-secondary);
      text-align: left;
      background: transparent;
    }

    .overflow-menu button {
      grid-template-columns: 28px minmax(0, 1fr);
    }

    .overflow-menu button:hover {
      background: var(--surface-2);
    }

    /* Set apart from the actions above it: it changes a preference rather than opening anything. */
    .overflow-menu .menu-row {
      grid-template-columns: minmax(0, 1fr) auto;
      // Chip width plus its gap, so the label starts where the labels above it do.
      padding-left: 43px;
      border-top: 1px solid var(--border);
      margin-top: 3px;
    }

    .overflow-menu span {
      display: grid;
      width: 28px;
      height: 28px;
      place-items: center;
      border-radius: var(--radius-selector);
      background: var(--surface-2);
    }

    .overflow-menu strong {
      font-size: 11px;
      font-weight: 620;
    }

    @keyframes overflow-menu-enter {
      from {
        opacity: 0;
        transform: translateY(-4px) scale(0.98);
      }

      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
  `,
})
export class TopbarOverflowMenuComponent {
  /** The inspector belongs to the terminal view; the other two fill the window on their own. */
  readonly showInspector = input(false);
  readonly inspectorOpen = input(false);
  readonly inspectorToggled = output<void>();
  readonly sessionCenterOpened = output<void>();
  readonly settingsOpened = output<void>();

  protected readonly open = signal(false);

  /**
   * Closes on a click outside the menu.
   *
   * Registered on the document rather than a backdrop so the menu also closes when the click goes
   * to a terminal, which has no overlay to catch it. The new-terminal menu watches its own anchor
   * the same way, so opening either one closes the other without the two being wired together.
   */
  @HostListener('document:pointerdown', ['$event'])
  protected closeOnOutsideClick(event: PointerEvent): void {
    if (this.open() && !(event.target as HTMLElement | null)?.closest('.overflow-anchor')) {
      this.open.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  protected closeOnEscape(): void {
    this.open.set(false);
  }
}
