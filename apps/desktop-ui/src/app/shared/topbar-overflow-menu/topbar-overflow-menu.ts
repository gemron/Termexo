import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';

import { registerFullscreenTranslations } from '../../core/i18n/fullscreen.i18n';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  isPageFullscreen,
  pageFullscreenSupported,
  togglePageFullscreen,
  watchPageFullscreen,
} from '../../core/services/page-fullscreen';
import { runtimeMode } from '../../core/services/tauri-runtime';
import { AnchoredMenuDirective } from '../anchored-menu.directive';
import { IconComponent } from '../icon/icon';
import { LanguageSelectorComponent } from '../language-selector/language-selector';
import { RemoteAccessButtonComponent } from '../remote-access-button';
import { RemoteHostsButtonComponent } from '../remote-hosts-button';
import { ThirdPartyNotificationsToggleComponent } from '../third-party-notifications-toggle';

registerFullscreenTranslations();

@Component({
  selector: 'app-topbar-overflow-menu',
  imports: [
    AnchoredMenuDirective,
    IconComponent,
    LanguageSelectorComponent,
    RemoteAccessButtonComponent,
    RemoteHostsButtonComponent,
    ThirdPartyNotificationsToggleComponent,
    TranslatePipe,
  ],
  template: `
    <div class="overflow-anchor" (focusout)="closeOnFocusOut($event)">
      <button
        #trigger
        type="button"
        class="overflow-trigger"
        data-testid="overflow-menu"
        [class.active]="open()"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="open() ? 'app-tools-panel' : null"
        aria-haspopup="dialog"
        [title]="'workspace.moreTools' | t"
        [attr.aria-label]="'workspace.moreTools' | t"
        (click)="open.set(!open())"
      >
        <app-icon name="more" [size]="16" />
      </button>

      @if (open()) {
        <div
          id="app-tools-panel"
          class="overflow-menu"
          role="dialog"
          [attr.aria-label]="'workspace.moreTools' | t"
          data-tauri-drag-region="false"
          [appAnchoredMenu]="trigger"
          (dismissed)="open.set(false)"
        >
          <button type="button" data-testid="settings-open" (click)="close(trigger); settingsOpened.emit()">
            <app-icon name="settings" [size]="15" />
            {{ 'workspace.settings' | t }}
          </button>
          @if (localApp) {
            <app-remote-hosts-button (opened)="close(trigger); remoteHostsOpened.emit()" />
          }
          <app-remote-access-button (opened)="close(trigger); remoteAccessOpened.emit()" />
          <app-third-party-notifications-toggle (failed)="operationFailed.emit($event)" />
          <div class="language-row">
            <span>{{ 'language.label' | t }}</span>
            <app-language-selector />
          </div>

          <div class="view-actions">
            @if (upgradeCount() > 0) {
              <button type="button" data-testid="model-updates-open" (click)="close(trigger); modelUpdatesOpened.emit()">
                <app-icon name="refresh" [size]="15" />
                {{ 'settings.newModels' | t: { count: upgradeCount() } }}
              </button>
            }
            @if (showInspector()) {
              <button type="button" (click)="close(trigger); inspectorToggled.emit()">
                <app-icon [name]="inspectorOpen() ? 'panel-close' : 'panel-right-open'" [size]="15" />
                {{ (inspectorOpen() ? 'inspector.collapse' : 'inspector.expand') | t }}
              </button>
            }
            @if (phoneLayout() && fullscreenAvailable) {
              <button type="button" data-testid="fullscreen-toggle" (click)="close(trigger); toggleFullscreen()">
                <app-icon [name]="fullscreen() ? 'minimize' : 'maximize'" [size]="15" />
                {{ (fullscreen() ? 'fullscreen.exit' : 'fullscreen.enter') | t }}
              </button>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }

    .overflow-trigger {
      display: grid;
      width: 30px;
      height: 30px;
      place-items: center;
      border-radius: var(--radius-field);
      color: var(--text-secondary);
    }

    .overflow-trigger:is(:hover, :focus-visible, .active) {
      color: var(--text);
      background: var(--surface-2);
    }

    .overflow-menu {
      position: fixed;
      inset: auto;
      z-index: var(--z-popover);
      display: flex;
      width: 240px;
      flex-direction: column;
      gap: 2px;
      padding: 5px;
      margin: 0;
      overflow: auto;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-box);
      color: var(--text-secondary);
      background: var(--surface-raised);
      box-shadow: 0 14px 35px rgb(0 0 0 / 40%);
    }

    .overflow-menu button,
    .language-row {
      display: flex;
      width: 100%;
      min-height: 36px;
      align-items: center;
      gap: 8px;
      padding: 0 8px;
      border-radius: var(--radius-field);
      font-size: 12px;
      text-align: start;
    }

    .overflow-menu button:is(:hover, :focus-visible) {
      color: var(--text);
      background: var(--surface-2);
    }

    .language-row {
      justify-content: space-between;
    }

    .view-actions:not(:empty) {
      padding-top: 4px;
      border-top: 1px solid var(--border);
    }
  `,
})
export class TopbarOverflowMenuComponent {
  /** The inspector belongs to the terminal view; the other two fill the window on their own. */
  readonly showInspector = input(false);
  readonly inspectorOpen = input(false);
  readonly phoneLayout = input(false);
  readonly upgradeCount = input(0);
  readonly inspectorToggled = output<void>();
  readonly settingsOpened = output<void>();
  readonly remoteAccessOpened = output<void>();
  readonly remoteHostsOpened = output<void>();
  readonly modelUpdatesOpened = output<void>();
  readonly operationFailed = output<string>();

  private readonly i18n = inject(I18nService);
  protected readonly open = signal(false);
  protected readonly localApp = runtimeMode() !== 'remote';
  /**
   * A phone browser loses a strip of its height to the address bar and toolbar, which the terminal
   * needs. The desktop app is already a window of its own, and Safari on iPhone cannot take a page
   * full screen, so neither is offered the switch.
   */
  protected readonly fullscreenAvailable = runtimeMode() !== 'desktop' && pageFullscreenSupported();
  protected readonly fullscreen = signal(isPageFullscreen());

  constructor() {
    // Also catches leaving full screen by the system back gesture, which never passes through here.
    inject(DestroyRef).onDestroy(
      watchPageFullscreen(() => this.fullscreen.set(isPageFullscreen())),
    );
  }

  protected async toggleFullscreen(): Promise<void> {
    try {
      await togglePageFullscreen();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.operationFailed.emit(this.i18n.t('fullscreen.failed', { error: reason }));
    }
  }

  protected close(trigger: HTMLButtonElement): void {
    trigger.focus({ preventScroll: true });
    this.open.set(false);
  }

  protected closeOnFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && !(event.currentTarget as HTMLElement).contains(next)) {
      this.open.set(false);
    }
  }
}
