import { Injectable, signal } from '@angular/core';
import { open, save } from '@tauri-apps/plugin-dialog';

import type { AgentSession } from '../models/agent.models';
import type { GitContext, HandoffPackage, HandoffRecord } from '../models/handoff';
import type { PromptAsset } from '../models/prompt-assets';
import type { TerminalSession, Workspace } from '../models/workspace.models';
import { invoke } from './backend-bridge';
import { hasBackend, isTauriRuntime } from './tauri-runtime';

const STORAGE_KEY = 'termexo.handoffPackages.v1';
const MAX_OUTPUT_TAIL = 40_000;

@Injectable({ providedIn: 'root' })
export class HandoffService {
  private readonly recordItems = signal<HandoffRecord[]>([]);
  private readonly busyState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly outputTails = new Map<string, string>();
  private initialized = false;

  readonly records = this.recordItems.asReadonly();
  readonly busy = this.busyState.asReadonly();
  readonly error = this.errorState.asReadonly();

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    try {
      const records = hasBackend()
        ? await invoke<HandoffRecord[]>('list_handoff_packages', { workspaceId: null })
        : this.readLocalRecords();
      this.recordItems.set(this.sort(records));
    } catch (error) {
      this.errorState.set(this.errorMessage(error));
    }
  }

  forWorkspace(workspaceId: string): HandoffRecord[] {
    return this.recordItems().filter((record) => record.workspaceId === workspaceId);
  }

  captureOutput(terminalId: string, data: string): void {
    this.outputTails.set(
      terminalId,
      `${this.outputTails.get(terminalId) ?? ''}${data}`.slice(-MAX_OUTPUT_TAIL),
    );
  }

  async generate(
    workspace: Workspace,
    scope: 'terminal' | 'workspace',
    sourceTerminalId: string | undefined,
    tokenBudget: number,
    promptAssets: PromptAsset[],
    agentSessions: AgentSession[],
  ): Promise<HandoffPackage> {
    return this.run(async () => {
      const { buildHandoffPackage } = await import('../models/handoff');
      const git = await this.collectGitContext(workspace.projectPath, tokenBudget);
      const handoff = buildHandoffPackage({
        workspace,
        terminals: workspace.terminals,
        sourceTerminalId,
        scope,
        promptAssets,
        agentSessions,
        outputByTerminal: this.outputTails,
        git,
        tokenBudget,
      });
      await this.savePackage(handoff);
      return handoff;
    });
  }

  async packageFromRecord(record: HandoffRecord): Promise<HandoffPackage> {
    const { parseHandoffDocument } = await import('../models/handoff');
    return parseHandoffDocument(record.packageJson);
  }

  async delete(recordId: string): Promise<void> {
    await this.run(async () => {
      if (hasBackend()) {
        await invoke('delete_handoff_package', { packageId: recordId });
      }
      this.recordItems.update((records) => records.filter((record) => record.id !== recordId));
      this.persistLocalRecords();
    });
  }

  async exportPackage(handoff: HandoffPackage, format: 'md' | 'json' = 'md'): Promise<boolean> {
    return this.run(async () => {
      const { handoffToMarkdown } = await import('../models/handoff');
      const contents =
        format === 'json' ? JSON.stringify(handoff, null, 2) : handoffToMarkdown(handoff);
      const safeName = handoff.workspaceName.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 60);
      const fileName = `${safeName || 'termexo'}-handoff.${format}`;
      if (isTauriRuntime()) {
        const path = await save({
          defaultPath: fileName,
          filters: [
            format === 'json'
              ? { name: 'Termexo JSON handoff', extensions: ['json'] }
              : { name: 'Termexo Markdown handoff', extensions: ['md'] },
          ],
        });
        if (!path) {
          return false;
        }
        await invoke('write_handoff_document', { path, contents });
        return true;
      }

      const url = URL.createObjectURL(
        new Blob([contents], { type: format === 'json' ? 'application/json' : 'text/markdown' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      return true;
    });
  }

  /**
   * Imports a document and files it under the workspace doing the importing.
   *
   * A package carries the workspace id of the machine that produced it, and the history list is
   * filtered by workspace — filing an import under its original id would save a record the user
   * can never see again once the preview closes. The package keeps its own ids, so the source
   * workspace and project path stay visible in the preview.
   */
  async importPackage(targetWorkspaceId?: string): Promise<HandoffPackage | null> {
    return this.run(async () => {
      let contents: string | null;
      if (isTauriRuntime()) {
        const path = await open({
          multiple: false,
          directory: false,
          filters: [{ name: 'Termexo handoff', extensions: ['md', 'json'] }],
        });
        if (!path || Array.isArray(path)) {
          return null;
        }
        contents = await invoke<string>('read_handoff_document', { path });
      } else {
        contents = await this.pickBrowserDocument();
        if (contents === null) {
          return null;
        }
      }
      const { parseHandoffDocument } = await import('../models/handoff');
      const handoff = parseHandoffDocument(contents);
      await this.savePackage(handoff, targetWorkspaceId);
      return handoff;
    });
  }

  private async collectGitContext(projectPath: string, tokenBudget: number): Promise<GitContext> {
    if (!hasBackend()) {
      return {
        available: false,
        branch: '',
        status: '',
        changedFiles: [],
        diff: '',
        recentCommits: [],
        truncated: false,
        diagnostic: 'Git context is unavailable in browser preview.',
      };
    }
    return invoke<GitContext>('collect_git_context', {
      request: {
        projectPath,
        maxDiffBytes: Math.min(512 * 1024, Math.max(8 * 1024, tokenBudget * 2)),
      },
    });
  }

  private async savePackage(handoff: HandoffPackage, workspaceId?: string): Promise<void> {
    const existing = this.recordItems().find((record) => record.id === handoff.id);
    const record: HandoffRecord = {
      id: handoff.id,
      workspaceId: workspaceId || handoff.workspaceId,
      sourceTerminalId: handoff.sourceTerminalId,
      title: handoff.title,
      packageJson: JSON.stringify(handoff),
      createdAt: existing?.createdAt ?? handoff.createdAt,
      updatedAt: Date.now(),
    };
    const saved = hasBackend()
      ? await invoke<HandoffRecord>('save_handoff_package', { input: record })
      : record;
    this.recordItems.update((records) =>
      this.sort([saved, ...records.filter((candidate) => candidate.id !== saved.id)]),
    );
    this.persistLocalRecords();
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    this.busyState.set(true);
    this.errorState.set(null);
    try {
      return await operation();
    } catch (error) {
      this.errorState.set(this.errorMessage(error));
      throw error;
    } finally {
      this.busyState.set(false);
    }
  }

  private pickBrowserDocument(): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.json,text/markdown,application/json';
      input.addEventListener('change', () => {
        void (async () => {
          try {
            const file = input.files?.[0];
            if (!file) {
              resolve(null);
              return;
            }
            if (file.size > 2 * 1024 * 1024) {
              throw new Error('The handoff document exceeds the 2 MB safety limit.');
            }
            resolve(await file.text());
          } catch (error) {
            reject(error);
          }
        })();
      });
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }

  private readLocalRecords(): HandoffRecord[] {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = value ? JSON.parse(value) : [];
      return Array.isArray(parsed) ? (parsed as HandoffRecord[]) : [];
    } catch {
      return [];
    }
  }

  private persistLocalRecords(): void {
    if (hasBackend()) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.recordItems()));
    } catch {
      // Keep the in-memory package usable if browser storage is unavailable.
    }
  }

  private sort(records: HandoffRecord[]): HandoffRecord[] {
    return [...records].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 250);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
