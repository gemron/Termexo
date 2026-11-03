import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import '../core/i18n/remote-read-only.i18n';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { AppStateService } from '../core/services/app-state.service';
import { TerminalPanelComponent } from '../terminal/terminal-panel';
import { LanguageSelectorComponent } from '../shared/language-selector/language-selector';
import { RemoteConnectionBadgeComponent } from './remote-connection-badge';

/** A viewing link has no editing controls or process lifecycle actions. Navigation stays local. */
@Component({
  selector: 'app-remote-read-only-view',
  imports: [FormsModule, TranslatePipe, TerminalPanelComponent, LanguageSelectorComponent, RemoteConnectionBadgeComponent],
  template: `
    <section class="viewer">
      <header>
        <strong>Termexo</strong><span class="badge">{{ 'remote.viewing' | t }}</span>
        <label>{{ 'remote.workspace' | t }}
          <select [ngModel]="state.activeWorkspace()?.id" (ngModelChange)="selectWorkspace($event)">
            @for (workspace of state.workspaces(); track workspace.id) {
              <option [value]="workspace.id">{{ workspace.name }}</option>
            }
          </select>
        </label>
        <app-remote-connection-badge /><app-language-selector />
      </header>
      <nav [attr.aria-label]="'terminal.tabs' | t">
        @for (terminal of state.activeWorkspace()?.terminals ?? []; track terminal.id) {
          <button type="button" [class.active]="selected()?.id === terminal.id"
            [attr.aria-pressed]="selected()?.id === terminal.id" (click)="selectedId.set(terminal.id)">
            {{ terminal.name }}
          </button>
        }
      </nav>
      @if (selected(); as terminal) {
        @for (item of [terminal]; track item.id + ':' + item.runtimeRevision) {
          <app-terminal-panel [session]="item" [active]="true" [visible]="true" />
        }
      } @else {
        <p role="status">{{ 'remote.viewingEmpty' | t }}</p>
      }
    </section>
  `,
  styles: `
    :host { display: block; height: 100dvh; color: var(--text); background: var(--surface-0); }
    .viewer { height: 100%; display: flex; flex-direction: column; min-width: 0; }
    header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; flex-wrap: wrap;
      border-bottom: 1px solid var(--border); }
    label { display: flex; align-items: center; gap: 8px; margin-right: auto; }
    select, button { color: inherit; background: var(--surface-1); border: 1px solid var(--border);
      border-radius: 6px; padding: 6px 10px; max-width: 55vw; }
    .badge { color: var(--color-success); font-size: 12px; }
    nav { display: flex; gap: 6px; padding: 8px 12px; overflow-x: auto; flex: 0 0 auto; }
    nav button { white-space: nowrap; }
    nav button.active { border-color: var(--color-primary); }
    app-terminal-panel { flex: 1; min-height: 0; display: block; }
    p { padding: 24px; color: var(--text-muted); }
  `,
})
export class RemoteReadOnlyViewComponent {
  protected readonly state = inject(AppStateService);
  protected readonly selectedId = signal('');
  protected readonly selected = computed(() => {
    const terminals = this.state.activeWorkspace()?.terminals ?? [];
    return terminals.find((terminal) => terminal.id === this.selectedId()) ?? terminals[0];
  });
  protected selectWorkspace(id: string): void {
    this.state.selectWorkspace(id);
    this.selectedId.set('');
  }
}
