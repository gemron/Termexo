import {
  Component,
  computed,
  effect,
  type ElementRef,
  HostListener,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import {
  buildDiffRows,
  changeBlockStarts,
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

/**
 * How far below the viewport's top edge a jumped-to change is placed, as a share of the height.
 *
 * A change pinned to the very top loses the lines leading into it, which are most of what says
 * whether this is the edit being looked for.
 */
const CHANGE_SCROLL_HEADROOM = 0.3;

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

  /** Null while the repository is being read, or while the read is reporting why it failed. */
  readonly overview = input<RepositoryOverview | null>(null);
  readonly target = input<RepositoryTarget | null>(null);
  /** Names the terminal whose start the changes are measured against. */
  readonly terminalName = input('');
  readonly overviewError = input('');
  readonly refreshing = input(false);
  readonly refreshRequested = output<void>();

  /** Both outlive this component, which is destroyed whenever another view is opened. */
  protected readonly selectedPath = this.git.selectedPath;
  protected readonly layout = this.git.diffLayout;
  protected readonly diff = signal<RepositoryDiff | null>(null);
  protected readonly diffLoading = signal(false);
  protected readonly diffError = signal('');
  private readonly manualRefreshing = signal(false);
  /**
   * Spins the refresh button only for a read the user asked for.
   *
   * The workspace polls the repository on its own while this view is open, and tying the spinner
   * to every one of those reads made the button flicker on a three-second cadence.
   */
  protected readonly refreshSpinning = computed(() => this.manualRefreshing() && this.refreshing());
  protected readonly rows = computed(() => {
    const diff = this.diff();
    return diff && !diff.binary ? buildDiffRows(diff.oldText, diff.newText) : [];
  });
  /** Line counts for the open diff; a changed row stands for one line on each side. */
  protected readonly diffStats = computed(() => {
    let added = 0;
    let removed = 0;
    for (const row of this.rows()) {
      if (row.kind === 'added' || row.kind === 'changed') added += 1;
      if (row.kind === 'removed' || row.kind === 'changed') removed += 1;
    }
    return { added, removed };
  });
  protected readonly graphRows = computed(() => buildCommitGraph(this.overview()?.commits ?? []));

  private readonly diffViewport = viewChild<ElementRef<HTMLElement>>('diffViewport');
  protected readonly changeBlocks = computed(() => changeBlockStarts(this.rows()));
  /** Which change was stepped to, or -1 before the first step. */
  private readonly activeChange = signal(-1);
  /** The row the last jump landed on, which the view marks. */
  protected readonly anchoredRow = computed(() => {
    const index = this.activeChange();
    return index < 0 ? -1 : (this.changeBlocks()[index] ?? -1);
  });
  /** The stepper's readout: how many changes there are, and which one is showing. */
  protected readonly changePosition = computed(() => {
    const total = this.changeBlocks().length;
    const index = this.activeChange();
    return index < 0 ? `${total}` : `${index + 1}/${total}`;
  });

  constructor() {
    effect(() => {
      const overview = this.overview();
      const target = this.target();
      // Without an overview there is no file list to pick from, and whatever diff is on screen
      // belongs to an answer that no longer stands.
      if (!overview || !target) {
        this.resetDiff();
        return;
      }
      const changes = overview.changes;
      const current = this.selectedPath();
      const path = changes.some((change) => change.path === current) ? current : changes[0]?.path;
      if (!path) {
        this.git.selectPath('');
        this.resetDiff();
        return;
      }
      if (path !== current) {
        this.git.selectPath(path);
      }
      const diffKey = this.diffKey(path, target);
      if (diffKey === this.loadedDiffKey) return;
      this.loadedDiffKey = diffKey;
      void this.loadDiff(path, target);
    });
    effect(() => {
      if (!this.refreshing()) {
        this.manualRefreshing.set(false);
      }
    });
    effect(() => {
      // Another file's changes are not this one's, so stepping starts over with the diff.
      this.rows();
      this.activeChange.set(-1);
    });
  }

  /**
   * Moves to the next or previous run of changed lines, wrapping at either end.
   *
   * Wrapping rather than stopping: a diff is usually walked more than once, and a button that
   * goes dead at the last change reads as broken rather than as the end of the file.
   */
  protected stepToChange(step: 1 | -1): void {
    const blocks = this.changeBlocks();
    if (blocks.length === 0) return;
    const current = this.activeChange();
    const next =
      step > 0 ? (current + 1) % blocks.length : current <= 0 ? blocks.length - 1 : current - 1;
    this.activeChange.set(next);
    this.scrollToRow(blocks[next]);
  }

  /** Alt with an arrow key, which nothing in the diff consumes. */
  @HostListener('keydown', ['$event'])
  protected onKeyDown(event: KeyboardEvent): void {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowDown') {
      this.stepToChange(1);
    } else if (event.key === 'ArrowUp') {
      this.stepToChange(-1);
    } else {
      return;
    }
    event.preventDefault();
  }

  private scrollToRow(rowIndex: number): void {
    const viewport = this.diffViewport()?.nativeElement;
    const line = viewport?.querySelector<HTMLElement>(`[data-row="${rowIndex}"]`);
    if (!viewport || !line) return;
    viewport.scrollTo({
      top: Math.max(0, line.offsetTop - viewport.clientHeight * CHANGE_SCROLL_HEADROOM),
      behavior: 'smooth',
    });
  }

  protected selectFile(change: RepositoryChange): void {
    this.git.selectPath(change.path);
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
    this.git.setDiffLayout(layout);
  }

  protected refresh(): void {
    this.manualRefreshing.set(true);
    this.refreshRequested.emit();
    const path = this.selectedPath();
    const target = this.target();
    if (!path || !target) return;
    this.loadedDiffKey = this.diffKey(path, target);
    void this.loadDiff(path, target);
  }

  private resetDiff(): void {
    this.loadedDiffKey = '';
    this.diff.set(null);
    this.diffError.set('');
    this.diffLoading.set(false);
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
