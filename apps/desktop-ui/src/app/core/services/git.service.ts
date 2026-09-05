import { Injectable, signal } from '@angular/core';

import type { RepositoryDiff, RepositoryOverview, RepositoryTarget } from '../models/git.models';
import { invoke } from './backend-bridge';
import { hasBackend } from './tauri-runtime';

const COMMIT_LIMIT = 50;

function targetKey(target: RepositoryTarget | null): string {
  return target ? `${target.workspaceId}:${target.terminalId}:${target.runtimeRevision}` : '';
}

@Injectable({ providedIn: 'root' })
export class GitService {
  private target: RepositoryTarget | null = null;
  private requestRevision = 0;
  private refreshInFlight = false;
  private refreshQueued = false;
  private readonly overviewValue = signal<RepositoryOverview | null>(null);
  private readonly loadingValue = signal(false);
  private readonly errorValue = signal('');

  readonly overview = this.overviewValue.asReadonly();
  readonly loading = this.loadingValue.asReadonly();
  readonly error = this.errorValue.asReadonly();

  selectTarget(target: RepositoryTarget | null): boolean {
    if (targetKey(target) === targetKey(this.target)) return false;
    this.target = target;
    this.requestRevision += 1;
    this.overviewValue.set(null);
    this.errorValue.set('');
    void this.refresh();
    return true;
  }

  async refresh(): Promise<void> {
    if (this.refreshInFlight) {
      this.refreshQueued = true;
      return;
    }
    const target = this.target;
    const revision = ++this.requestRevision;
    if (!target || !hasBackend()) {
      this.overviewValue.set(null);
      this.loadingValue.set(false);
      return;
    }
    this.refreshInFlight = true;
    this.loadingValue.set(true);
    try {
      const overview = await invoke<RepositoryOverview>('get_repository_overview', {
        request: { target, commitLimit: COMMIT_LIMIT },
      });
      if (revision === this.requestRevision) {
        this.overviewValue.set(overview);
        this.errorValue.set('');
      }
    } catch (error) {
      if (revision === this.requestRevision) {
        this.overviewValue.set(null);
        this.errorValue.set(error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.refreshInFlight = false;
      if (revision === this.requestRevision) this.loadingValue.set(false);
      if (this.refreshQueued) {
        this.refreshQueued = false;
        void this.refresh();
      }
    }
  }

  async loadDiff(target: RepositoryTarget, path: string): Promise<RepositoryDiff> {
    if (!hasBackend()) throw new Error('Git Diff 仅在桌面应用中可用。');
    return invoke<RepositoryDiff>('get_repository_diff', {
      request: { target, path },
    });
  }
}
