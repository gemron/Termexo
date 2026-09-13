import { runtimeMode } from '../core/services/tauri-runtime';
import { DatePipe } from '@angular/common';
import { Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { hasSubstantiveContext, updateHandoffInstructions } from '../core/models/handoff';
import type { HandoffPackage, HandoffRecord } from '../core/models/handoff';
import type { TerminalSession } from '../core/models/workspace.models';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { ModalFocusDirective } from '../shared/modal-focus.directive';
import { IconComponent } from '../shared/icon/icon';

export interface HandoffGenerateRequest {
  scope: 'terminal' | 'workspace';
  tokenBudget: number;
}

export interface HandoffSendRequest {
  terminalId: string;
  handoff: HandoffPackage;
}

@Component({
  selector: 'app-handoff-dialog',
  imports: [ModalFocusDirective, DatePipe, FormsModule, IconComponent, TranslatePipe],
  templateUrl: './handoff-dialog.html',
  styleUrls: ['./dialog.scss', './handoff-dialog.scss'],
})
export class HandoffDialogComponent {
  protected readonly previewMode = runtimeMode() === 'preview';
  readonly records = input.required<HandoffRecord[]>();
  readonly preview = input<HandoffPackage | null>(null);
  readonly terminals =
    input.required<(TerminalSession & { agentType: 'claude' | 'codex' | 'opencode' })[]>();
  readonly activeTerminalId = input<string | null>(null);
  readonly busy = input(false);
  readonly error = input<string | null>(null);

  readonly generated = output<HandoffGenerateRequest>();
  readonly recordSelected = output<HandoffRecord>();
  readonly recordDeleted = output<HandoffRecord>();
  readonly imported = output<void>();
  readonly exported = output<{ handoff: HandoffPackage; format: 'md' | 'json' }>();
  readonly sent = output<HandoffSendRequest>();
  readonly saved = output<HandoffPackage>();
  readonly cancelled = output<void>();

  /**
   * A package whose evidence fields are all empty still sends, but the receiving Agent gets
   * nothing to act on — the user is told before spending a turn on it.
   */
  protected readonly previewIsThin = computed(() => {
    const handoff = this.preview();
    return !!handoff && !hasSubstantiveContext(handoff);
  });

  protected readonly mobilePane = signal<'build' | 'preview'>('build');
  protected readonly taskDraft = signal('');
  protected readonly nextDraft = signal('');
  protected readonly dirty = computed(() => {
    const preview = this.preview();
    return (
      !!preview && (this.taskDraft() !== preview.task || this.nextDraft() !== preview.nextAction)
    );
  });
  protected readonly confirmDiscard = signal(false);
  private pendingAction: (() => void) | null = null;
  protected readonly editedPreview = computed(() => {
    const original = this.preview();
    return original
      ? updateHandoffInstructions(original, this.taskDraft(), this.nextDraft())
      : null;
  });

  protected readonly scope = signal<'terminal' | 'workspace'>('terminal');
  protected readonly tokenBudget = signal(8_000);
  protected readonly targetTerminalId = signal('');

  constructor() {
    effect(() => {
      const preview = this.preview();
      this.taskDraft.set(preview?.task ?? '');
      this.nextDraft.set(preview?.nextAction ?? '');
      this.confirmDiscard.set(false);
      this.pendingAction = null;
      if (preview) this.mobilePane.set('preview');
    });
    effect(() => {
      const terminals = this.terminals();
      if (!terminals.some((terminal) => terminal.id === this.targetTerminalId())) {
        this.targetTerminalId.set(
          terminals.find((terminal) => terminal.id !== this.activeTerminalId())?.id ??
            terminals[0]?.id ??
            '',
        );
      }
    });
  }

  private requestAction(action: () => void): void {
    if (this.busy()) return;
    if (this.dirty()) {
      this.pendingAction = action;
      this.confirmDiscard.set(true);
    } else {
      action();
    }
  }

  protected requestClose(): void {
    this.requestAction(() => this.cancelled.emit());
  }

  protected selectRecord(record: HandoffRecord): void {
    if (record.id === this.preview()?.id) {
      this.mobilePane.set('preview');
      return;
    }
    this.requestAction(() => {
      this.recordSelected.emit(record);
      this.mobilePane.set('preview');
    });
  }

  protected requestImport(): void {
    this.requestAction(() => this.imported.emit());
  }

  protected deleteRecord(record: HandoffRecord): void {
    if (this.busy()) return;
    if (record.id === this.preview()?.id) this.requestAction(() => this.recordDeleted.emit(record));
    else this.recordDeleted.emit(record);
  }

  protected keepEditing(): void {
    this.pendingAction = null;
    this.confirmDiscard.set(false);
    this.mobilePane.set('preview');
  }

  protected discardChanges(): void {
    if (this.busy()) return;
    const action = this.pendingAction;
    this.pendingAction = null;
    this.confirmDiscard.set(false);
    this.taskDraft.set(this.preview()?.task ?? '');
    this.nextDraft.set(this.preview()?.nextAction ?? '');
    action?.();
  }

  protected saveChanges(): void {
    const handoff = this.editedPreview();
    if (!this.busy() && this.dirty() && handoff?.task && handoff.nextAction)
      this.saved.emit(handoff);
  }

  protected generate(): void {
    this.requestAction(() =>
      this.generated.emit({
        scope: this.scope(),
        tokenBudget: Math.min(32_000, Math.max(512, this.tokenBudget() || 8_000)),
      }),
    );
  }
}
