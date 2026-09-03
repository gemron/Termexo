import { DatePipe } from '@angular/common';
import { Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { hasSubstantiveContext } from '../core/models/handoff';
import type { HandoffPackage, HandoffRecord } from '../core/models/handoff';
import type { TerminalSession } from '../core/models/workspace.models';
import { TranslatePipe } from '../core/i18n/translate.pipe';
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
  imports: [DatePipe, FormsModule, IconComponent, TranslatePipe],
  templateUrl: './handoff-dialog.html',
  styleUrls: ['./dialog.scss', './handoff-dialog.scss'],
})
export class HandoffDialogComponent {
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
  readonly cancelled = output<void>();

  /**
   * A package whose evidence fields are all empty still sends, but the receiving Agent gets
   * nothing to act on — the user is told before spending a turn on it.
   */
  protected readonly previewIsThin = computed(() => {
    const handoff = this.preview();
    return !!handoff && !hasSubstantiveContext(handoff);
  });

  protected readonly scope = signal<'terminal' | 'workspace'>('terminal');
  protected readonly tokenBudget = signal(8_000);
  protected readonly targetTerminalId = signal('');

  constructor() {
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

  protected handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }
    // The workbench listens for Escape on the window; an open dialog owns the key instead.
    event.stopPropagation();
    this.cancelled.emit();
  }

  protected generate(): void {
    this.generated.emit({
      scope: this.scope(),
      tokenBudget: Math.min(32_000, Math.max(512, this.tokenBudget() || 8_000)),
    });
  }
}
