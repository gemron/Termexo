import { Component, computed, input, output, signal } from '@angular/core';

import { registerQuickKeyTranslations } from '../core/i18n/quick-keys.i18n';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { AGENT_ICONS, AGENT_LABELS, type AgentType } from '../core/models/workspace.models';
import { IconComponent } from '../shared/icon/icon';
import type { QuickKey } from './terminal-key-sequences';
import { AGENT_QUICK_KEY_LAYOUTS, navigationKeys } from './terminal-quick-key-layouts';

registerQuickKeyTranslations();

/** A touch keypad, deferred on remote mobile terminals, that stays open between key presses. */
@Component({
  selector: 'app-terminal-quick-keys',
  imports: [IconComponent, TranslatePipe],
  template: `
    <!-- Preserve terminal focus without opening or dismissing the phone's soft keyboard. -->
    <div
      class="quick-keys"
      [class.open]="open()"
      (mousedown)="$event.preventDefault(); $event.stopPropagation()"
    >
      @if (open()) {
        <div
          class="quick-key-pad"
          role="group"
          [attr.aria-label]="agentLabel() + ': ' + ('quickKeys.group' | t)"
        >
          <div class="quick-key-heading">
            <app-icon [name]="agentIcon()" [size]="16" />
            <strong>{{ agentLabel() }}</strong>
            <span>{{ 'quickKeys.group' | t }}</span>
          </div>
          @for (section of sections(); track section.title) {
            <div class="quick-key-section" role="group" [attr.aria-label]="section.title | t">
              <span class="quick-key-section-title">{{ section.title | t }}</span>
              <div class="quick-key-grid">
                @for (button of section.buttons; track button.key) {
                  <button
                    type="button"
                    class="quick-key"
                    [class.destructive]="button.destructive"
                    [attr.data-key]="button.key"
                    [title]="(button.label ? button.label + ': ' : '') + (button.caption | t)"
                    [attr.aria-label]="
                      (button.label ? button.label + ': ' : '') + (button.caption | t)
                    "
                    (click)="keyPressed.emit(button.key)"
                  >
                    @if (button.icon) {
                      <app-icon [name]="button.icon" [size]="16" />
                    } @else {
                      <span class="quick-key-label">{{ button.label }}</span>
                    }
                    <span class="quick-key-caption">{{ button.caption | t }}</span>
                  </button>
                }
              </div>
            </div>
          }
          <p class="quick-key-hint">{{ 'quickKeys.defaults' | t }}</p>
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
      max-width: calc(100% - 24px);
      max-height: calc(100% - 24px);
    }
    .quick-key-pad {
      box-sizing: border-box;
      width: 264px;
      max-width: 100%;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 10px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-box);
      background: var(--surface-raised);
      box-shadow: 0 8px 24px rgb(0 0 0 / 32%);
      animation: quick-key-pad-enter 140ms ease-out;
    }
    .quick-key-heading {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text);
      font-size: 12px;
    }
    .quick-key-heading > span {
      margin-left: auto;
      color: var(--text-muted);
      font-size: 11px;
    }
    .quick-key-section {
      margin-top: 10px;
    }
    .quick-key-section-title {
      display: block;
      margin-bottom: 5px;
      color: var(--text-muted);
      font-size: 10px;
    }
    .quick-key-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 4px;
    }
    .quick-key,
    .quick-keys-toggle {
      display: grid;
      place-items: center;
      border: 1px solid var(--border);
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 620;
      touch-action: manipulation;
      user-select: none;
      transition:
        color 140ms ease,
        background-color 140ms ease,
        opacity 140ms ease;
    }
    .quick-key {
      min-height: 48px;
      padding: 5px 2px;
      gap: 2px;
      border-radius: var(--radius-field);
      background: var(--surface-2);
    }
    .quick-key-label {
      font-size: 11px;
      white-space: nowrap;
    }
    .quick-key-caption {
      max-width: 100%;
      font-size: 10px;
      font-weight: 450;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .quick-key-hint {
      margin: 8px 0 0;
      color: var(--text-muted);
      font-size: 10px;
      line-height: 1.4;
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
    .quick-keys-toggle {
      flex-shrink: 0;
      width: 44px;
      height: 44px;
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
    @media (prefers-reduced-motion: reduce) {
      .quick-key-pad {
        animation: none;
      }
    }
  `,
})
export class TerminalQuickKeysComponent {
  readonly agentType = input<AgentType>('shell');
  readonly keyPressed = output<QuickKey>();
  protected readonly agentLabel = computed(() => AGENT_LABELS[this.agentType()]);
  protected readonly agentIcon = computed(() => AGENT_ICONS[this.agentType()]);
  protected readonly sections = computed(() => [
    { title: 'quickKeys.actions', buttons: AGENT_QUICK_KEY_LAYOUTS[this.agentType()] },
    { title: 'quickKeys.navigation', buttons: navigationKeys(this.agentType()) },
  ]);
  protected readonly open = signal(false);
}
