import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

import {
  type PromptAsset,
  redactSensitiveContent,
  TerminalPromptCapture,
} from '../models/prompt-assets';
import type { TerminalSession, Workspace } from '../models/workspace.models';
import { isTauriRuntime } from './tauri-runtime';

const STORAGE_KEY = 'termexo.promptAssets.v1';
const EMERGENCY_DRAFT_STORAGE_KEY = 'termexo.pendingPromptDrafts.v1';
const DRAFT_SAVE_DELAY_MS = 250;
const MAX_LOCAL_ASSETS = 1_000;

@Injectable({ providedIn: 'root' })
export class PromptAssetService {
  private readonly assetItems = signal<PromptAsset[]>([]);
  private readonly errorState = signal<string | null>(null);
  private readonly captures = new Map<string, TerminalPromptCapture>();
  private readonly draftTimers = new Map<string, number>();
  private readonly draftQueues = new Map<string, Promise<unknown>>();
  private initialized = false;

  readonly assets = this.assetItems.asReadonly();
  readonly error = this.errorState.asReadonly();

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    try {
      const assets = isTauriRuntime()
        ? await invoke<PromptAsset[]>('list_prompt_assets', { workspaceId: null })
        : this.readLocalAssets();
      this.assetItems.set(this.sort(this.mergeLatest(assets, this.readEmergencyDrafts())));
    } catch (error) {
      this.errorState.set(this.errorMessage(error));
    }
  }

  forWorkspace(workspaceId: string): PromptAsset[] {
    return this.assetItems().filter((asset) => asset.workspaceId === workspaceId);
  }

  draftForTerminal(terminalId: string): PromptAsset | undefined {
    return this.assetItems().find(
      (asset) => asset.kind === 'draft' && asset.terminalId === terminalId,
    );
  }

  captureInput(workspace: Workspace, terminal: TerminalSession, data: string): void {
    if (terminal.agentType === 'shell') {
      return;
    }
    const capture = this.captureFor(terminal.id);
    const result = capture.consume(data);
    if (!result.changed) {
      return;
    }

    if (result.submitted.length > 0) {
      this.cancelDraftSave(terminal.id);
      this.writeEmergencyDraft(terminal.id, null);
      void this.enqueueDraft(terminal.id, () => this.removeDraft(terminal.id)).catch(
        () => undefined,
      );
      for (const prompt of result.submitted) {
        void this.saveAsset(
          this.createAsset(workspace, terminal, 'history', prompt, this.uniqueId('prompt')),
        ).catch(() => undefined);
      }
      return;
    }

    this.writeEmergencyDraft(
      terminal.id,
      result.draft
        ? this.createAsset(workspace, terminal, 'draft', result.draft, this.draftId(terminal.id))
        : null,
    );
    this.scheduleDraftSave(workspace, terminal, result.draft);
  }

  async setDraft(workspace: Workspace, terminal: TerminalSession, content: string): Promise<void> {
    if (terminal.agentType === 'shell') {
      return;
    }
    const capture = this.captureFor(terminal.id);
    capture.restore(content);
    this.cancelDraftSave(terminal.id);
    const asset = content
      ? this.createAsset(workspace, terminal, 'draft', content, this.draftId(terminal.id))
      : null;
    this.writeEmergencyDraft(terminal.id, asset);
    await this.enqueueDraft(terminal.id, () =>
      asset ? this.saveAsset(asset) : this.removeDraft(terminal.id),
    );
  }

  async toggleFavorite(asset: PromptAsset): Promise<void> {
    await this.saveAsset({ ...asset, favorite: !asset.favorite, updatedAt: Date.now() });
  }

  async togglePinned(asset: PromptAsset): Promise<void> {
    await this.saveAsset({ ...asset, pinned: !asset.pinned, updatedAt: Date.now() });
  }

  async delete(assetId: string): Promise<void> {
    try {
      const asset = this.assetItems().find((candidate) => candidate.id === assetId);
      if (isTauriRuntime()) {
        await invoke('delete_prompt_asset', { assetId });
      }
      this.assetItems.update((assets) => assets.filter((asset) => asset.id !== assetId));
      if (asset?.kind === 'draft' && asset.terminalId) {
        this.writeEmergencyDraft(asset.terminalId, null);
        this.captures.get(asset.terminalId)?.restore('');
      }
      this.persistLocalAssets();
    } catch (error) {
      this.errorState.set(this.errorMessage(error));
      throw error;
    }
  }

  private captureFor(terminalId: string): TerminalPromptCapture {
    let capture = this.captures.get(terminalId);
    if (!capture) {
      capture = new TerminalPromptCapture();
      const recoveredDraft = this.draftForTerminal(terminalId);
      if (recoveredDraft) {
        capture.restore(recoveredDraft.content);
      }
      this.captures.set(terminalId, capture);
    }
    return capture;
  }

  private scheduleDraftSave(
    workspace: Workspace,
    terminal: TerminalSession,
    content: string,
  ): void {
    this.cancelDraftSave(terminal.id);
    const timer = window.setTimeout(() => {
      this.draftTimers.delete(terminal.id);
      void this.enqueueDraft(terminal.id, () =>
        content
          ? this.saveAsset(
              this.createAsset(workspace, terminal, 'draft', content, this.draftId(terminal.id)),
            )
          : this.removeDraft(terminal.id),
      ).catch(() => undefined);
    }, DRAFT_SAVE_DELAY_MS);
    this.draftTimers.set(terminal.id, timer);
  }

  private cancelDraftSave(terminalId: string): void {
    const timer = this.draftTimers.get(terminalId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.draftTimers.delete(terminalId);
    }
  }

  private async removeDraft(terminalId: string): Promise<void> {
    this.writeEmergencyDraft(terminalId, null);
    await this.delete(this.draftId(terminalId));
  }

  private enqueueDraft<T>(terminalId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.draftQueues.get(terminalId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.draftQueues.set(terminalId, next);
    const cleanup = (): void => {
      if (this.draftQueues.get(terminalId) === next) {
        this.draftQueues.delete(terminalId);
      }
    };
    void next.then(cleanup, cleanup);
    return next;
  }

  private createAsset(
    workspace: Workspace,
    terminal: TerminalSession,
    kind: 'draft' | 'history',
    content: string,
    id: string,
  ): PromptAsset {
    if (terminal.agentType === 'shell') {
      throw new Error('Shell terminals do not support prompt assets.');
    }
    const now = Date.now();
    const redacted = redactSensitiveContent(content);
    const existing = this.assetItems().find((asset) => asset.id === id);
    return {
      id,
      workspaceId: workspace.id,
      terminalId: terminal.id,
      terminalName: terminal.name,
      agentType: terminal.agentType,
      kind,
      content: redacted.content,
      redacted: redacted.redactions > 0,
      favorite: existing?.favorite ?? false,
      pinned: existing?.pinned ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  private async saveAsset(asset: PromptAsset): Promise<void> {
    try {
      const saved = isTauriRuntime()
        ? await invoke<PromptAsset>('save_prompt_asset', { input: asset })
        : asset;
      this.assetItems.update((assets) =>
        this.sort([saved, ...assets.filter((candidate) => candidate.id !== saved.id)]).slice(
          0,
          MAX_LOCAL_ASSETS,
        ),
      );
      this.persistLocalAssets();
      this.errorState.set(null);
    } catch (error) {
      this.errorState.set(this.errorMessage(error));
      throw error;
    }
  }

  private readLocalAssets(): PromptAsset[] {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = value ? JSON.parse(value) : [];
      return Array.isArray(parsed) ? (parsed as PromptAsset[]) : [];
    } catch {
      return [];
    }
  }

  private persistLocalAssets(): void {
    if (isTauriRuntime()) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.assetItems()));
    } catch {
      // The current session still retains assets when browser storage is unavailable.
    }
  }

  private readEmergencyDrafts(): PromptAsset[] {
    try {
      const value = window.localStorage.getItem(EMERGENCY_DRAFT_STORAGE_KEY);
      const parsed: unknown = value ? JSON.parse(value) : {};
      return parsed && typeof parsed === 'object'
        ? Object.values(parsed as Record<string, PromptAsset>)
        : [];
    } catch {
      return [];
    }
  }

  private writeEmergencyDraft(terminalId: string, asset: PromptAsset | null): void {
    try {
      const drafts = Object.fromEntries(
        this.readEmergencyDrafts()
          .filter((candidate) => candidate.terminalId !== terminalId)
          .map((candidate) => [candidate.terminalId!, candidate]),
      );
      if (asset) {
        drafts[terminalId] = asset;
      }
      window.localStorage.setItem(EMERGENCY_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
    } catch {
      // SQLite persistence remains available when localStorage is restricted.
    }
  }

  private mergeLatest(primary: PromptAsset[], recovery: PromptAsset[]): PromptAsset[] {
    const merged = new Map<string, PromptAsset>();
    for (const asset of [...primary, ...recovery]) {
      const current = merged.get(asset.id);
      if (!current || asset.updatedAt > current.updatedAt) {
        merged.set(asset.id, asset);
      }
    }
    return [...merged.values()];
  }

  private sort(assets: PromptAsset[]): PromptAsset[] {
    return [...assets].sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) ||
        Number(right.favorite) - Number(left.favorite) ||
        right.updatedAt - left.updatedAt,
    );
  }

  private draftId(terminalId: string): string {
    return `draft:${terminalId}`;
  }

  private uniqueId(prefix: string): string {
    const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    return `${prefix}:${suffix}`;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
