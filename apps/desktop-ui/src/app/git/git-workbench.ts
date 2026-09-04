import { Component, computed, effect, inject, input, output, signal } from '@angular/core';

import {
  buildDiffRows,
  DiffLayout,
  RepositoryChange,
  RepositoryCommit,
  RepositoryDiff,
  RepositoryOverview,
  RepositoryTarget,
  repositoryChangeStatus,
} from '../core/models/git.models';
import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { GitService } from '../core/services/git.service';
import { IconComponent } from '../shared/icon/icon';

interface CommitGraphRow {
  commit: RepositoryCommit;
  lane: number;
  lanes: number;
  laneIndexes: number[];
  parentLanes: number[];
}

@Component({
  selector: 'app-git-workbench',
  imports: [IconComponent, TranslatePipe],
  templateUrl: './git-workbench.html',
  styleUrl: './git-workbench.scss',
})
export class GitWorkbenchComponent {
  private readonly git = inject(GitService);
  private diffRequestRevision = 0;
  private loadedDiffKey = '';
  protected readonly i18n = inject(I18nService);

  readonly overview = input.required<RepositoryOverview>();
  readonly target = input.required<RepositoryTarget>();
  readonly refreshing = input(false);
  readonly refreshRequested = output<void>();

  protected readonly selectedPath = signal('');
  protected readonly layout = signal<DiffLayout>('unified');
  protected readonly diff = signal<RepositoryDiff | null>(null);
  protected readonly diffLoading = signal(false);
  protected readonly diffError = signal('');
  protected readonly rows = computed(() => {
    const diff = this.diff();
    return diff && !diff.binary ? buildDiffRows(diff.oldText, diff.newText) : [];
  });
  protected readonly graphRows = computed(() => buildCommitGraph(this.overview().commits));

  constructor() {
    effect(() => {
      const changes = this.overview().changes;
      const current = this.selectedPath();
      const path = changes.some((change) => change.path === current) ? current : changes[0]?.path;
      if (path && path !== current) {
        this.selectedPath.set(path);
      }
      if (!path) {
        this.loadedDiffKey = '';
        this.selectedPath.set('');
        this.diff.set(null);
        this.diffError.set('');
        return;
      }
      const target = this.target();
      const diffKey = this.diffKey(path, target);
      if (diffKey === this.loadedDiffKey) return;
      this.loadedDiffKey = diffKey;
      void this.loadDiff(path, target);
    });
  }

  protected selectFile(change: RepositoryChange): void {
    if (change.path === this.selectedPath()) return;
    this.selectedPath.set(change.path);
  }

  protected changeStatus(change: RepositoryChange): string {
    return repositoryChangeStatus(change);
  }

  protected changeLabel(change: RepositoryChange): string {
    return this.i18n.t(`git.status${this.changeStatus(change)}`);
  }

  protected commitTime(commit: RepositoryCommit): string {
    return this.i18n.formatDateTime(commit.committedAt * 1000);
  }

  protected setLayout(layout: DiffLayout): void {
    this.layout.set(layout);
  }

  protected refresh(): void {
    this.refreshRequested.emit();
    const path = this.selectedPath();
    if (!path) return;
    const target = this.target();
    this.loadedDiffKey = this.diffKey(path, target);
    void this.loadDiff(path, target);
  }

  private diffKey(path: string, target: RepositoryTarget): string {
    return `${target.workspaceId}:${target.terminalId}:${target.runtimeRevision}:${path}`;
  }

  private async loadDiff(path: string, target: RepositoryTarget): Promise<void> {
    const requestRevision = ++this.diffRequestRevision;
    this.diffLoading.set(true);
    this.diffError.set('');
    try {
      const diff = await this.git.loadDiff(target, path);
      if (requestRevision === this.diffRequestRevision && this.selectedPath() === path) {
        this.diff.set(diff);
      }
    } catch (error) {
      if (requestRevision === this.diffRequestRevision && this.selectedPath() === path) {
        this.diff.set(null);
        this.diffError.set(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (requestRevision === this.diffRequestRevision && this.selectedPath() === path) {
        this.diffLoading.set(false);
      }
    }
  }
}

export function buildCommitGraph(commits: readonly RepositoryCommit[]): CommitGraphRow[] {
  const lanes: string[] = [];
  return commits.map((commit) => {
    let lane = lanes.indexOf(commit.oid);
    if (lane < 0) {
      lanes.push(commit.oid);
      lane = lanes.length - 1;
    }
    const laneCount = Math.max(lanes.length, 1);
    if (commit.parentOids.length > 0) {
      const firstParentLane = lanes.indexOf(commit.parentOids[0]);
      if (firstParentLane >= 0 && firstParentLane !== lane) {
        lanes.splice(lane, 1);
      } else {
        lanes[lane] = commit.parentOids[0];
      }
      for (const parent of commit.parentOids.slice(1).reverse()) {
        const existing = lanes.indexOf(parent);
        if (existing < 0) lanes.splice(lane + 1, 0, parent);
      }
    } else {
      lanes.splice(lane, 1);
    }
    const parentLanes = commit.parentOids.map((parent) => {
      const index = lanes.indexOf(parent);
      return index < 0 ? lane : index;
    });
    return {
      commit,
      lane,
      lanes: Math.max(laneCount, lanes.length, 1),
      laneIndexes: Array.from(
        { length: Math.max(laneCount, lanes.length, 1) },
        (_, index) => index,
      ),
      parentLanes,
    };
  });
}
