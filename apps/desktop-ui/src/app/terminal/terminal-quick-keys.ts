import { Component, output, signal } from '@angular/core';

import { registerQuickKeyTranslations } from '../core/i18n/quick-keys.i18n';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { IconComponent } from '../shared/icon/icon';
import type { QuickKey } from './terminal-key-sequences';

registerQuickKeyTranslations();

interface QuickKeyButton {
  readonly key: QuickKey;
  /** Translation key naming what the key does, read out and shown as the tooltip. */
  readonly title: string;
  /** Drawn when set; otherwise the text label stands on the key. */
  readonly icon?: string;
  readonly label?: string;
  /** A second press quits the agent, so the key is set apart from the harmless ones. */
  readonly destructive?: boolean;
}

/**
 * The keypad, row by row: arrows sit as an inverted T so they read like a keyboard's, with the
 * keys agents prompt for most — Esc to interrupt, Shift+Tab to switch mode — at the top corners.
 */
const QUICK_KEY_LAYOUT: readonly QuickKeyButton[] = [
  { key: 'escape', title: 'quickKeys.escape', label: 'Esc' },
  { key: 'up', title: 'quickKeys.up', icon: 'arrow-up' },
  { key: 'shiftTab', title: 'quickKeys.shiftTab', label: '⇧Tab' },
  { key: 'left', title: 'quickKeys.left', icon: 'arrow-left' },
  { key: 'down', title: 'quickKeys.down', icon: 'arrow-down' },
  { key: 'right', title: 'quickKeys.right', icon: 'arrow-right' },
  { key: 'ctrlC', title: 'quickKeys.ctrlC', label: 'Ctrl+C', destructive: true },
  { key: 'tab', title: 'quickKeys.tab', label: 'Tab' },
  { key: 'enter', title: 'quickKeys.enter', label: 'Enter' },
];

/**
 * A floating keypad for the keys a phone keyboard lacks but an agent CLI keeps asking for.
 *
 * Only a touch device on a non-desktop runtime renders it, behind an `@defer` block, which is why
 * the styles carry no media query. The pad stays open between presses: moving through a menu
 * takes several arrows and then Enter, and closing after each tap would cost a tap per key.
 */
@Component({
  selector: 'app-terminal-quick-keys',
  imports: [IconComponent, TranslatePipe],
  template: `
    <!--
      Pressing a key must neither pull focus out of the terminal, which would close a soft keyboard
      that is up, nor reach the panel's own mousedown, which would focus the terminal and open one
      that is not. The keys still act on click, so assistive technology can press them too.
    -->
    <div
      class="quick-keys"
      [class.open]="open()"
      (mousedown)="$event.preventDefault(); $event.stopPropagation()"
    >
      @if (open()) {
        <div class="quick-key-pad" role="group" [attr.aria-label]="'quickKeys.group' | t">
          @for (button of layout; track button.key) {
            <button
              type="button"
              class="quick-key"
              [class.destructive]="button.destructive"
              [attr.data-key]="button.key"
              [title]="button.title | t"
              [attr.aria-label]="button.title | t"
              (click)="keyPressed.emit(button.key)"
            >
              @if (button.icon) {
                <app-icon [name]="button.icon" [size]="16" />
              } @else {
                {{ button.label }}
              }
            </button>
          }
        </div>
      }
      <button
        type="button"
        class="quick-keys-toggle"
        data-testid="quick-keys-toggle"
        [attr.aria-expanded]="open()"
        [title]="(open() ? 'quickKeys.hide' : 'quickKeys.show') | t"
        [attr.aria-label]="(open() ? 'quickKeys.hide' : 'quickKeys.show') | t"
        (click)="open.set(!open())"
      >
        <app-icon [name]="open() ? 'x' : 'keyboard'" [size]="18" />
      </button>
    </div>
  `,
  styles: `
    .quick-keys {
      position: absolute;
      z-index: 8;
      right: 12px;
      bottom: 12px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
    }

    .quick-key-pad {
      display: grid;
      grid-template-columns: repeat(3, 48px);
      grid-auto-rows: 40px;
      gap: 4px;
      padding: 8px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-box);
      background: var(--surface-raised);
      box-shadow: 0 8px 24px rgb(0 0 0 / 32%);
      animation: quick-key-pad-enter 140ms ease-out;
    }

    /* See-through, so the output under the pad stays readable while it is open. */
    @supports (background: color-mix(in srgb, red 50%, transparent)) {
      .quick-key-pad {
        background: color-mix(in srgb, var(--surface-raised) 86%, transparent);
      }
    }

    .quick-key,
    .quick-keys-toggle {
      display: grid;
      place-items: center;
      border: 1px solid var(--border);
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 620;
      /* No double-tap zoom, so a key pressed twice in a row sends two keys. */
      touch-action: manipulation;
      user-select: none;
      transition:
        color 140ms ease,
        background-color 140ms ease,
        opacity 140ms ease;
    }

    .quick-key {
      border-radius: var(--radius-field);
      background: var(--surface-2);
    }

    .quick-key.destructive {
      color: var(--danger);
    }

    .quick-key:hover,
    .quick-key:focus-visible {
      color: var(--text);
    }

    .quick-key:active {
      color: var(--accent);
      background: var(--primary-soft);
    }

    .quick-key.destructive:active {
      color: var(--danger);
    }

    /* Faded while closed, so it marks the corner without hiding the output beneath it. */
    .quick-keys-toggle {
      width: 40px;
      height: 40px;
      border-color: var(--border-strong);
      border-radius: var(--radius-box);
      background: var(--surface-raised);
      box-shadow: 0 4px 12px rgb(0 0 0 / 28%);
      opacity: 0.6;
    }

    .quick-keys-toggle:hover,
    .quick-keys-toggle:focus-visible,
    .quick-keys.open .quick-keys-toggle {
      color: var(--text);
      opacity: 1;
    }

    @keyframes quick-key-pad-enter {
      from {
        opacity: 0;
        transform: translateY(4px) scale(0.98);
      }

      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
  `,
})
export class TerminalQuickKeysComponent {
  readonly keyPressed = output<QuickKey>();

  protected readonly layout = QUICK_KEY_LAYOUT;
  protected readonly open = signal(false);
}
