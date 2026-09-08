import { computed, Injectable, signal } from '@angular/core';

import type {
  DiffLayout,
  RepositoryDiff,
  RepositoryOverview,
  RepositoryTarget,
} from '../models/git.models';
import { invoke, listen } from './backend-bridge';
import { hasBackend } from './tauri-runtime';

const COMMIT_LIMIT = 50;
/** Raised by the backend once a watched repository has been quiet after a change. */
const REPOSITORY_CHANGED_EVENT = 'repository-changed';

/** Structural equality; an overview is a few dozen small records, so serialising it is cheap. */
function sameOverview(current: RepositoryOverview | null, next: RepositoryOverview): boolean {
  return current !== null && JSON.stringify(current) === JSON.stringify(next);
}
const DIFF_LAYOUT_STORAGE_KEY = 'termexo.git.diffLayout';

function readStoredDiffLayout(): DiffLayout {
  try {
    return window.localStorage.getItem(DIFF_LAYOUT_STORAGE_KEY) === 'split' ? 'split' : 'unified';
  } catch {
    return 'unified';
  }
}

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
  /**
   * The file being read and the layout it is read in.
   *
   * They live here rather than in the view because the view is destroyed whenever the workspace
   * switches away from it. Keeping them here is what brings the user back to the file they were
   * reading, instead of to the top of the list in whichever layout is the default.
   */
  private readonly selectedPathValue = signal('');
  private readonly diffLayoutValue = signal<DiffLayout>(readStoredDiffLayout());

  readonly overview = this.overviewValue.asReadonly();
  /** True while the backend watches the shown repository, which is when polling can back off. */
  readonly watched = computed(() => this.overviewValue()?.watched === true);
  readonly loading = this.loadingValue.asReadonly();
  readonly error = this.errorValue.asReadonly();
  readonly selectedPath = this.selectedPathValue.asReadonly();
  readonly diffLayout = this.diffLayoutValue.asReadonly();

  constructor() {
    if (hasBackend()) {
      void this.followRepositoryChanges();
    }
  }

  /**
   * Refreshes when the backend reports a change to the repository on screen.
   *
   * The event names the root it saw change; anything else belongs to a repository another
   * terminal is showing, or one nobody is, and is not worth a read.
   */
  private async followRepositoryChanges(): Promise<void> {
    await listen<{ root: string }>(REPOSITORY_CHANGED_EVENT, (event) => {
      if (this.overviewValue()?.root === event.payload.root) {
        void this.refresh();
      }
    });
  }

  selectPath(path: string): void {
    this.selectedPathValue.set(path);
  }

  setDiffLayout(layout: DiffLayout): void {
    this.diffLayoutValue.set(layout);
    try {
      window.localStorage.setItem(DIFF_LAYOUT_STORAGE_KEY, layout);
    } catch {
      // Restricted storage costs the preference nothing beyond surviving a restart.
    }
  }

  selectTarget(target: RepositoryTarget | null): boolean {
    if (targetKey(target) === targetKey(this.target)) return false;
    this.target = target;
    this.requestRevision += 1;
    this.overviewValue.set(null);
    this.errorValue.set('');
    // Another terminal is another repository, or at least another baseline: its file list has
    // nothing to do with the one being read.
    this.selectedPathValue.set('');
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
        // The poll usually brings back the same picture it did three seconds ago. Publishing an
        // identical object would still run change detection over every reader of the overview.
        if (!sameOverview(this.overviewValue(), overview)) {
          this.overviewValue.set(overview);
        }
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
