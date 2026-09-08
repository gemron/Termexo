import { DestroyRef, inject, Injectable, signal } from '@angular/core';

import { createId } from '../models/identifiers';
import {
  type PromptAsset,
  redactSensitiveContent,
  TerminalPromptCapture,
} from '../models/prompt-assets';
import type { TerminalSession, Workspace } from '../models/workspace.models';
import { invoke } from './backend-bridge';
import { hasBackend } from './tauri-runtime';

const STORAGE_KEY = 'termexo.promptAssets.v1';
const EMERGENCY_DRAFT_STORAGE_KEY = 'termexo.pendingPromptDrafts.v1';
const DRAFT_SAVE_DELAY_MS = 250;
/** Upper bound on how long a busy main thread may postpone the emergency draft write. */
const EMERGENCY_DRAFT_FLUSH_TIMEOUT_MS = 200;
const MAX_LOCAL_ASSETS = 1_000;

@Injectable({ providedIn: 'root' })
export class PromptAssetService {
  private readonly assetItems = signal<PromptAsset[]>([]);
  private readonly errorState = signal<string | null>(null);
  private readonly captures = new Map<string, TerminalPromptCapture>();
  private readonly draftTimers = new Map<string, number>();
  private readonly draftQueues = new Map<string, Promise<unknown>>();
  /** Mirror of the emergency store, so writing a draft never has to read and parse it back. */
  private readonly emergencyDrafts = new Map<string, PromptAsset>();
  /** Drafts waiting to be built and written, keyed by terminal; `null` removes one. */
  private readonly pendingEmergencyDrafts = new Map<string, (() => PromptAsset) | null>();
  private emergencyDraftsLoaded = false;
  private cancelEmergencyFlush: (() => void) | undefined;
  private initialized = false;

  readonly assets = this.assetItems.asReadonly();
  readonly error = this.errorState.asReadonly();

  constructor() {
    // A window that is closing or going to the background may never reach the idle callback, and
    // the draft still queued there is exactly the one a crash would lose.
    const flush = (): void => this.flushEmergencyDrafts();
    const flushWhenHidden = (): void => {
      if (document.hidden) {
        flush();
      }
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      flush();
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    try {
      const assets = hasBackend()
        ? await invoke<PromptAsset[]>('list_prompt_assets', { workspaceId: null })
        : this.readLocalAssets();
      this.assetItems.set(this.sort(this.mergeLatest(assets, this.loadEmergencyDrafts())));
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

    // Building the asset is deferred along with the write: redacting and serialising the whole
    // draft on every keystroke is what made typing stutter, and this copy is only ever read back
    // after a crash.
    this.queueEmergencyDraft(
      terminal.id,
      result.draft
        ? () =>
            this.createAsset(workspace, terminal, 'draft', result.draft, this.draftId(terminal.id))
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
      if (hasBackend()) {
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
      const saved = hasBackend()
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
    if (hasBackend()) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.assetItems()));
    } catch {
      // The current session still retains assets when browser storage is unavailable.
    }
  }

  /**
   * Reads the emergency store into memory once, so a keystroke never parses it back out.
   *
   * Both `initialize` and the first queued write call this, because a draft typed before the asset
   * list finished loading would otherwise persist an empty mirror over the recoverable ones.
   */
  private loadEmergencyDrafts(): PromptAsset[] {
    if (!this.emergencyDraftsLoaded) {
      this.emergencyDraftsLoaded = true;
      try {
        const value = window.localStorage.getItem(EMERGENCY_DRAFT_STORAGE_KEY);
        const parsed: unknown = value ? JSON.parse(value) : {};
        if (parsed && typeof parsed === 'object') {
          for (const asset of Object.values(parsed as Record<string, PromptAsset>)) {
            if (asset?.terminalId) {
              this.emergencyDrafts.set(asset.terminalId, asset);
            }
          }
        }
      } catch {
        // An unreadable store only means there is nothing to recover.
      }
    }
    return [...this.emergencyDrafts.values()];
  }

  /** Queues an already-built draft; the write still coalesces with everything else pending. */
  private writeEmergencyDraft(terminalId: string, asset: PromptAsset | null): void {
    this.queueEmergencyDraft(terminalId, asset ? () => asset : null);
  }

  /**
   * Queues one terminal's emergency draft, building the asset only when the write happens.
   *
   * Takes a closure rather than a finished asset because this runs on every keystroke: the
   * redaction pass and the JSON serialisation are the parts a fast typist would feel.
   */
  private queueEmergencyDraft(terminalId: string, build: (() => PromptAsset) | null): void {
    this.loadEmergencyDrafts();
    this.pendingEmergencyDrafts.set(terminalId, build);
    this.scheduleEmergencyFlush();
  }

  /**
   * Defers the write to an idle moment, which is what keeps `localStorage` — synchronous, and
   * occasionally stalling on disk — off the keystroke path.
   */
  private scheduleEmergencyFlush(): void {
    if (this.cancelEmergencyFlush) {
      return;
    }
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(() => this.flushEmergencyDrafts(), {
        timeout: EMERGENCY_DRAFT_FLUSH_TIMEOUT_MS,
      });
      this.cancelEmergencyFlush = () => window.cancelIdleCallback(handle);
      return;
    }
    const handle = window.setTimeout(
      () => this.flushEmergencyDrafts(),
      EMERGENCY_DRAFT_FLUSH_TIMEOUT_MS,
    );
    this.cancelEmergencyFlush = () => window.clearTimeout(handle);
  }

  /** Applies every queued draft and writes the store once. */
  private flushEmergencyDrafts(): void {
    this.cancelEmergencyFlush?.();
    this.cancelEmergencyFlush = undefined;
    if (this.pendingEmergencyDrafts.size === 0) {
      return;
    }
    for (const [terminalId, build] of this.pendingEmergencyDrafts) {
      if (build) {
        this.emergencyDrafts.set(terminalId, build());
      } else {
        this.emergencyDrafts.delete(terminalId);
      }
    }
    this.pendingEmergencyDrafts.clear();
    try {
      window.localStorage.setItem(
        EMERGENCY_DRAFT_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(this.emergencyDrafts)),
      );
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
    return `${prefix}:${createId()}`;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
