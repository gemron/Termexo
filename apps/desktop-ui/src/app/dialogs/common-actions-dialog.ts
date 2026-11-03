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
import {
  COMMON_ACTION_CATEGORIES,
  COMMON_ACTION_STATUS_LABELS,
  MAX_ACTION_ENVIRONMENT_VARIABLES,
  MAX_ACTION_ENVIRONMENT_VALUE_LENGTH,
  commonActionCategory,
  commonActionState,
  commonActionTerminal,
  relativeActionDirectory,
  type CommonActionState,
} from '../core/models/common-action';
import type {
  CommonAction,
  CommonActionCategory,
  Workspace,
} from '../core/models/workspace.models';
import {
  CommonActionsService,
  validateCommonAction,
} from '../core/services/common-actions.service';
import { writeClipboardText } from '../core/services/clipboard-text';
import { hasBackend, isTauriRuntime } from '../core/services/tauri-runtime';
import { DirectoryPickerService } from '../core/services/directory-picker.service';
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
  protected readonly canPickDirectory = isTauriRuntime();
  private readonly directoryPicker = inject(DirectoryPickerService);
  protected readonly selectingDirectory = signal(false);
  protected readonly environmentRows = signal<{ name: string; value: string }[]>([]);
  protected readonly maxEnvironmentVariables = MAX_ACTION_ENVIRONMENT_VARIABLES;
  protected readonly maxEnvironmentValueLength = MAX_ACTION_ENVIRONMENT_VALUE_LENGTH;
  protected readonly categories = COMMON_ACTION_CATEGORIES;
  protected readonly statusLabels = COMMON_ACTION_STATUS_LABELS;
  protected readonly statusOptions = Object.entries(COMMON_ACTION_STATUS_LABELS) as [
    CommonActionState,
    string,
  ][];
  protected readonly search = signal('');
  protected readonly category = signal<CommonActionCategory | 'all'>('all');
  protected readonly status = signal<CommonActionState | 'all'>('all');
  protected readonly pending = signal<{ id: string; label: string } | null>(null);
  protected readonly error = signal('');
  protected readonly editor = signal<CommonAction | null>(null);
  protected readonly editingSuggestionId = signal<string | null>(null);
  protected readonly activeTab = signal<'saved' | 'suggestions'>('saved');
  protected readonly message = signal('');
  protected readonly importJson = signal('');
  protected readonly agentId = signal('');
  protected readonly review = computed(() => this.actions.reviews()[this.workspace().id]);
  protected readonly savedRows = computed(() =>
    (this.workspace().commonActions ?? []).map((action) => {
      const terminal = commonActionTerminal(action, this.workspace().terminals);
      const state = commonActionState(terminal);
      return {
        action,
        state,
        hasConsole: !!terminal,
        active: state === 'starting' || state === 'running',
      };
    }),
  );
  protected readonly runningCount = computed(
    () => this.savedRows().filter((row) => row.active).length,
  );
  protected readonly failedCount = computed(
    () => this.savedRows().filter((row) => row.state === 'failed').length,
  );
  protected readonly filteredRows = computed(() => {
    const words = this.search().trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return this.savedRows().filter(({ action, state }) => {
      const category = commonActionCategory(action);
      const text = [
        action.name,
        action.command,
        action.workingDirectory,
        action.description,
        this.categoryLabel(action),
      ]
        .join(' ')
        .toLocaleLowerCase();
      return (
        (this.category() === 'all' || this.category() === category) &&
        (this.status() === 'all' || this.status() === state) &&
        words.every((word) => text.includes(word))
      );
    });
  });
  protected readonly editorError = computed(() => {
    if (!this.editor()) return '';
    try {
      validateCommonAction({ ...this.editor(), environment: this.editorEnvironment() });
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
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
      this.clearFilters();
      this.pending.set(null);
    });
  }

  protected async perform(operation: () => Promise<unknown>): Promise<boolean> {
    const workspaceId = this.workspace().id;
    this.error.set('');
    this.message.set('');
    try {
      await operation();
      return this.workspace().id === workspaceId;
    } catch (error) {
      if (this.workspace().id === workspaceId)
        this.error.set(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  protected recognize(): void {
    if (this.review()?.waiting || this.busy()) return;
    this.error.set('');
    this.message.set('');
    const terminalId =
      this.agents().find((agent) => agent.id === this.agentId())?.id || this.agents()[0]?.id;
    if (!terminalId) return;
    this.importJson.set('');
    this.activeTab.set('suggestions');
    this.recognitionRequested.emit({ workspaceId: this.workspace().id, terminalId });
  }

  protected add(ide = false): void {
    this.error.set('');
    this.editingSuggestionId.set(null);
    this.showEditor({
      id: createId(),
      name: ide ? '打开 IDE' : '',
      command: ide ? 'code .' : '',
      workingDirectory: this.workspace().projectPath,
      description: ide
        ? '使用 VS Code 打开项目；可将 code 替换为 cursor、idea 等已安装的 IDE 命令。'
        : '',
      category: ide ? 'tools' : 'custom',
    });
  }

  protected patchEditor(patch: Partial<CommonAction>): void {
    this.editor.update((item) => (item ? { ...item, ...patch } : null));
  }

  private showEditor(action: CommonAction): void {
    this.environmentRows.set(Object.entries(action.environment ?? {}).map(([name, value]) => ({ name, value })));
    this.editor.set({ ...action });
  }

  protected addEnvironment(): void {
    if (this.environmentRows().length < MAX_ACTION_ENVIRONMENT_VARIABLES)
      this.environmentRows.update((rows) => [...rows, { name: '', value: '' }]);
  }

  protected patchEnvironment(index: number, patch: { name?: string; value?: string }): void {
    this.environmentRows.update((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  }

  protected removeEnvironment(index: number): void {
    this.environmentRows.update((rows) => rows.filter((_, i) => i !== index));
  }

  protected environmentNames(action: CommonAction): string[] {
    return Object.keys(action.environment ?? {});
  }

  protected environmentEntries(action: CommonAction): { name: string; value: string }[] {
    return Object.entries(action.environment ?? {}).map(([name, value]) => ({ name, value }));
  }

  private editorEnvironment(): Record<string, string> {
    const entries = this.environmentRows().filter((row) => row.name || row.value)
      .map((row) => [row.name.trim(), row.value] as const);
    if (new Set(entries.map(([name]) => name)).size !== entries.length)
      throw new Error('环境变量名不能重复。');
    return Object.fromEntries(entries);
  }

  protected async selectWorkingDirectory(): Promise<void> {
    const draft = this.editor();
    if (!draft || this.selectingDirectory()) return;
    const workspaceId = this.workspace().id;
    this.selectingDirectory.set(true);
    this.error.set('');
    try {
      const path = await this.directoryPicker.select(draft.workingDirectory, '选择命令工作目录');
      if (path && this.workspace().id === workspaceId && this.editor()?.id === draft.id)
        this.patchEditor({ workingDirectory: path });
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.selectingDirectory.set(false);
    }
  }

  protected async save(): Promise<void> {
    const current = this.editor();
    if (!current || this.selectingDirectory() || this.editorError()) return;
    const draft = { ...current, environment: this.editorEnvironment() };
    if (draft && this.editingSuggestionId()) {
      if (
        await this.perform(async () => {
          const value = validateCommonAction(draft);
          this.actions.editSuggestion(this.workspace().id, this.editingSuggestionId()!, value);
        })
      )
        this.editor.set(null);
      return;
    }
    if (draft && (await this.perform(() => this.actions.save(this.workspace().id, draft)))) {
      this.editor.set(null);
      this.activeTab.set('saved');
      this.clearFilters();
      this.message.set(`已保存“${draft.name.trim()}”。`);
    }
  }

  protected async confirm(): Promise<void> {
    let count = 0;
    if (
      await this.perform(async () => {
        count = await this.actions.confirm(this.workspace().id);
      })
    ) {
      this.activeTab.set('saved');
      this.clearFilters();
      this.message.set(
        count ? `已添加 ${count} 项操作，可在列表中启动。` : '所选操作已存在，未重复添加。',
      );
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
    const name = this.actionName(id);
    await this.execute(
      id,
      restart ? '重启中…' : '启动中…',
      () => this.actions.run(this.workspace().id, id, restart),
      `“${name}”${restart ? '已重启' : '已启动'}，可打开控制台查看输出。`,
    );
  }

  protected async stop(id: string): Promise<void> {
    await this.execute(
      id,
      '停止中…',
      () => this.actions.stop(this.workspace().id, id),
      `“${this.actionName(id)}”已停止。`,
    );
  }

  protected async remove(id: string): Promise<void> {
    const name = this.actionName(id);
    if (await this.perform(() => this.actions.remove(this.workspace().id, id)))
      this.message.set(`已移除“${name}”的入口，已有终端仍保留。`);
  }

  protected edit(action: CommonAction): void {
    this.error.set('');
    this.editingSuggestionId.set(null);
    this.showEditor(action);
  }

  protected editSuggestion(action: CommonAction): void {
    this.editingSuggestionId.set(action.id);
    this.showEditor(action);
  }

  protected selectAll(selected: boolean): void {
    for (const item of this.review()?.suggestions ?? []) {
      this.actions.editSuggestion(this.workspace().id, item.id, { selected });
    }
  }

  protected relativeDirectory(path: string): string {
    return relativeActionDirectory(path, this.workspace().projectPath);
  }

  protected categoryLabel(action: CommonAction): string {
    return this.categories.find((item) => item.value === commonActionCategory(action))!.label;
  }

  protected clearFilters(): void {
    this.search.set('');
    this.category.set('all');
    this.status.set('all');
  }

  protected duplicate(action: CommonAction): void {
    this.error.set('');
    this.editingSuggestionId.set(null);
    this.showEditor({
      ...action,
      id: createId(),
      name: `${action.name.slice(0, 95)} 副本`,
      terminalId: undefined,
    });
  }

  protected async copyCommand(action: CommonAction): Promise<void> {
    if (await this.perform(() => writeClipboardText(action.command)))
      this.message.set(`已复制“${action.name}”的命令。`);
  }

  private actionName(id: string): string {
    return this.workspace().commonActions?.find((item) => item.id === id)?.name ?? '操作';
  }

  private async execute(
    id: string,
    label: string,
    operation: () => Promise<unknown>,
    message: string,
  ): Promise<void> {
    if (this.pending() || this.busy()) return;
    const pending = { id, label };
    this.pending.set(pending);
    try {
      if (await this.perform(operation)) this.message.set(message);
    } finally {
      if (this.pending() === pending) this.pending.set(null);
    }
  }

  protected isEditing(): boolean {
    return !!this.workspace().commonActions?.some((item) => item.id === this.editor()?.id);
  }

  protected console(action: CommonAction): void {
    const terminal = commonActionTerminal(action, this.workspace().terminals);
    if (terminal) {
      this.terminalRequested.emit(terminal.id);
      this.closed.emit();
    }
  }
}
