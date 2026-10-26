import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { createId } from '../core/models/identifiers';
import type { CommonAction, Workspace } from '../core/models/workspace.models';
import { CommonActionsService, validateCommonAction } from '../core/services/common-actions.service';
import { hasBackend } from '../core/services/tauri-runtime';
import { ModalFocusDirective } from '../shared/modal-focus.directive';
import { IconComponent } from '../shared/icon/icon';

@Component({
  selector: 'app-common-actions-dialog',
  imports: [FormsModule, ModalFocusDirective, IconComponent],
  templateUrl: './common-actions-dialog.html',
  styleUrls: ['./dialog.scss', './common-actions-dialog.scss'],
})
export class CommonActionsDialogComponent {
  readonly workspace = input.required<Workspace>();
  readonly closed = output<void>();
  readonly recognitionRequested = output<{ workspaceId: string; terminalId: string }>();
  readonly terminalRequested = output<string>();
  readonly agentRequested = output<void>();
  readonly recognitionAgentRequested = output<string>();
  protected readonly actions = inject(CommonActionsService);
  protected readonly available = hasBackend();
  protected readonly running = new Set(['STARTING', 'RUNNING']);
  protected readonly error = signal('');
  protected readonly editor = signal<CommonAction | null>(null);
  protected readonly editingSuggestionId = signal<string | null>(null);
  protected readonly activeTab = signal<'saved' | 'suggestions'>('saved');
  protected readonly message = signal('');
  protected readonly importJson = signal('');
  protected readonly agentId = signal('');
  protected readonly review = computed(() => this.actions.reviews()[this.workspace().id]);
  private readonly editorName = viewChild<ElementRef<HTMLInputElement>>('editorName');
  protected readonly selectedCount = computed(
    () => this.review()?.suggestions.filter((item) => item.selected).length ?? 0,
  );
  protected readonly busy = computed(() => this.actions.busy().has(this.workspace().id));
  protected readonly agents = computed(() =>
    this.workspace().terminals.filter(
      (item) =>
        item.agentType !== 'shell' &&
        item.agentType !== 'antigravity' &&
        !item.accountLogin &&
        ['IDLE', 'COMPLETED'].includes(item.status),
    ),
  );

  constructor() {
    let displayedStage = '';
    effect(() => {
      const review = this.review();
      const stage = review && `${review.requestId}:${review.waiting}`;
      if (review && stage !== displayedStage) {
        displayedStage = stage!;
        this.activeTab.set('suggestions');
      }
    });
    effect(() => {
      const input = this.editorName()?.nativeElement;
      if (input) input.focus();
    });
    let previousWorkspaceId = '';
    effect(() => {
      const workspaceId = this.workspace().id;
      if (workspaceId === previousWorkspaceId) return;
      previousWorkspaceId = workspaceId;
      this.editor.set(null);
      this.error.set('');
      this.agentId.set('');
      this.importJson.set('');
      this.editingSuggestionId.set(null);
      this.activeTab.set(this.review() ? 'suggestions' : 'saved');
      this.message.set('');
    });
  }

  protected async perform(operation: () => Promise<unknown>): Promise<boolean> {
    this.error.set('');
    try {
      await operation();
      return true;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  protected recognize(): void {
    if (this.review()?.waiting || this.busy()) return;
    this.error.set('');
    this.message.set('');
    const terminalId = this.agents().find((agent) => agent.id === this.agentId())?.id || this.agents()[0]?.id;
    if (!terminalId) return;
    this.importJson.set('');
    this.activeTab.set('suggestions');
    this.recognitionRequested.emit({ workspaceId: this.workspace().id, terminalId });
  }

  protected add(ide = false): void {
    this.editingSuggestionId.set(null);
    this.editor.set({
      id: createId(),
      name: ide ? '打开 IDE' : '',
      command: ide ? 'code .' : '',
      workingDirectory: this.workspace().projectPath,
      description: ide
        ? '使用 VS Code 打开项目；可将 code 替换为 cursor、idea 等已安装的 IDE 命令。'
        : '',
    });
  }

  protected patchEditor(patch: Partial<CommonAction>): void {
    this.editor.update((item) => (item ? { ...item, ...patch } : null));
  }

  protected async save(): Promise<void> {
    const draft = this.editor();
    if (draft && this.editingSuggestionId()) {
      if (await this.perform(async () => {
        const value = validateCommonAction(draft);
        this.actions.editSuggestion(this.workspace().id, this.editingSuggestionId()!, value);
      })) this.editor.set(null);
      return;
    }
    if (draft && (await this.perform(() => this.actions.save(this.workspace().id, draft))))
      this.editor.set(null);
  }

  protected async confirm(): Promise<void> {
    const count = this.selectedCount();
    if (await this.perform(() => this.actions.confirm(this.workspace().id))) {
      this.activeTab.set('saved');
      this.message.set(`已添加 ${count} 项操作，可在列表中启动。`);
    }
  }

  protected importSuggestions(): void {
    this.error.set('');
    try {
      this.actions.propose(this.workspace().id, this.review()!.requestId, this.importJson());
      this.importJson.set('');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  protected async run(id: string, restart = false): Promise<void> {
    if (
      await this.perform(async () => {
        await this.actions.run(this.workspace().id, id, restart);
      })
    ) {
      this.message.set(restart ? '操作已重启。' : '操作已启动，可继续启动其他操作，或打开控制台。');
    }
  }

  protected async stop(id: string): Promise<void> {
    await this.perform(() => this.actions.stop(this.workspace().id, id));
  }

  protected async remove(id: string): Promise<void> {
    await this.perform(() => this.actions.remove(this.workspace().id, id));
  }

  protected edit(action: CommonAction): void {
    this.editingSuggestionId.set(null);
    this.editor.set({ ...action });
  }

  protected editSuggestion(action: CommonAction): void {
    this.editingSuggestionId.set(action.id);
    this.editor.set({ ...action });
  }

  protected selectAll(selected: boolean): void {
    for (const item of this.review()?.suggestions ?? []) {
      this.actions.editSuggestion(this.workspace().id, item.id, { selected });
    }
  }

  protected relativeDirectory(path: string): string {
    const root = this.workspace().projectPath.replaceAll('\\', '/').replace(/\/$/, '');
    const normalized = path.replaceAll('\\', '/').replace(/\/$/, '');
    return normalized.toLowerCase() === root.toLowerCase()
      ? '项目根目录'
      : normalized.toLowerCase().startsWith(root.toLowerCase() + '/') ? './' + normalized.slice(root.length + 1) : path;
  }

  protected actionStatus(action: CommonAction): string {
    const terminal = this.workspace().terminals.find((item) => item.id === action.terminalId);
    if (!terminal) return '尚未启动';
    return this.running.has(terminal.status)
      ? '运行中'
      : terminal.status === 'FAILED'
        ? '启动失败'
        : '已停止';
  }

  protected isEditing(): boolean {
    return !!this.workspace().commonActions?.some((item) => item.id === this.editor()?.id);
  }

  protected hasConsole(action: CommonAction): boolean {
    return this.workspace().terminals.some((item) => item.id === action.terminalId);
  }

  protected console(action: CommonAction): void {
    if (action.terminalId) {
      this.terminalRequested.emit(action.terminalId);
      this.closed.emit();
    }
  }
}
