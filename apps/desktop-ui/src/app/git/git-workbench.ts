import { NgTemplateOutlet } from '@angular/common';
import './git-workbench.i18n';
import {
  Component,
  afterNextRender,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import {
  buildDiffRows,
  type BranchComparison,
  type CommitDetails,
  changeBlockStarts,
  withCollapsedEquals,
  type CollapsedEqualRow,
  type DiffDisplayRow,
  DiffLayout,
  RepositoryChange,
  RepositoryCommit,
  RepositoryDiff,
  RepositoryHistory,
  RepositoryOverview,
  RepositoryTarget,
  repositoryChangeStatus,
} from '../core/models/git.models';
import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { GitService } from '../core/services/git.service';
import { writeClipboardText } from '../core/services/clipboard-text';
import { IconComponent } from '../shared/icon/icon';
import { GitRevisionFilesComponent } from './git-revision-files';

/**
 * How far below the viewport's top edge a jumped-to change is placed, as a share of the height.
 *
 * A change pinned to the very top loses the lines leading into it, which are most of what says
 * whether this is the edit being looked for.
 */
const CHANGE_SCROLL_HEADROOM = 0.3;
const CLIPBOARD_FEEDBACK_MS = 1500;
const COMPACT_GIT_WIDTH = 680;
const GRAPH_LANE_WIDTH = 12;
const GRAPH_CENTER = 16;
const GRAPH_COLORS = ['var(--accent)', '#829fea', '#e28ab4', '#e4b56d', '#6bbad0', '#b19aeb'];

interface CommitGraphEdge {
  path: string;
  color: string;
}

interface CommitGraphRow {
  commit: RepositoryCommit;
  lanes: number;
  nodeX: number;
  color: string;
  edges: CommitGraphEdge[];
}

@Component({
  selector: 'app-git-workbench',
  imports: [IconComponent, GitRevisionFilesComponent, NgTemplateOutlet, TranslatePipe],
  templateUrl: './git-workbench.html',
  styleUrl: './git-workbench.scss',
})
export class GitWorkbenchComponent {
  private readonly git = inject(GitService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private clipboardTimer?: ReturnType<typeof setTimeout>;
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
  private readonly rawRows = computed(() => {
    const diff = this.diff();
    return diff && !diff.binary ? buildDiffRows(diff.oldText, diff.newText) : [];
  });

  protected readonly rows = computed(() => {
    const raw = this.rawRows();
    // The model produces one row per line; the view layer renders runs of ≥3 equal rows behind
    // a "show N lines" toggle so a 200-line file with one edit does not render all 200
    // unchanged lines. The toggle lives in `expandedRows` keyed on the placeholder's
    // `firstNewLine`; expanding a placeholder restores the equal rows so line numbers stay
    // correct.
    const expanded = this.expandedRows();
    return withCollapsedEquals(raw, (row) => expanded.has(row.firstNewLine));
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
  /** Narrows the change list by path; the diff of a filtered-out selection stays open. */
  protected readonly fileFilter = signal('');
  protected readonly treeView = signal(false);
  private readonly collapsedDirs = signal<ReadonlySet<string>>(new Set());
  protected readonly copiedValue = signal('');
  protected readonly copyError = signal('');
  protected readonly sidebarTab = signal<'changes' | 'history' | 'compare'>('changes');
  private readonly historyVisible = computed(() => this.sidebarTab() !== 'changes');
  private readonly compact = signal(false);
  private readonly focusPreference = signal<boolean | null>(null);
  protected readonly focusDiff = computed(() => this.focusPreference() ?? this.compact());
  protected readonly wrapLines = signal(false);
  private readonly changeList = viewChild<ElementRef<HTMLElement>>('changeList');

  protected readonly filteredChanges = computed(() => {
    const query = this.fileFilter().trim().toLowerCase();
    const changes = this.overview()?.changes ?? [];
    return query ? changes.filter((change) => change.path.toLowerCase().includes(query)) : changes;
  });

  protected readonly filePosition = computed(() => {
    const files = this.filteredChanges();
    const index = files.findIndex((change) => change.path === this.selectedPath());
    return `${index < 0 ? '–' : index + 1}/${files.length}`;
  });

  /** Changes grouped by directory, each group collapsible. Flat when the tree view is off. */
  protected readonly changeGroups = computed(() => {
    const groups = new Map<string, RepositoryChange[]>();
    for (const change of this.filteredChanges()) {
      const slash = change.path.lastIndexOf('/');
      const dir = slash < 0 ? '' : change.path.slice(0, slash);
      groups.set(dir, [...(groups.get(dir) ?? []), change]);
    }
    const collapsed = this.collapsedDirs();
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dir, changes]) => ({ dir, changes, collapsed: collapsed.has(dir) }));
  });

  private readonly historyScope = computed(() => {
    const overview = this.overview();
    const target = this.target();
    return overview?.available && target
      ? `${overview.root}:${target.workspaceId}:${target.terminalId}:${target.runtimeRevision}`
      : null;
  });
  private readonly historyHead = computed(() => this.overview()?.head);
  private readonly historyRefresh = signal(0);
  protected readonly historyBranch = linkedSignal({
    source: this.historyScope,
    computation: (): string | null => null,
  });
  private readonly history = signal<{ scope: string; data: RepositoryHistory } | null>(null);
  protected readonly historyLoading = signal(false);
  protected readonly historyError = signal('');
  protected readonly historyPaging = signal(false);
  protected readonly historyPageError = signal('');
  private historyGeneration = 0;
  private readonly currentHistory = computed(() => {
    const history = this.history();
    return history && history.scope === this.historyScope() ? history.data : null;
  });
  protected readonly hasOlderCommits = computed(() => !!this.currentHistory()?.next);
  protected readonly historyBranches = computed(() => this.currentHistory()?.branches ?? []);
  protected readonly graphRows = computed(() => buildCommitGraph(this.currentHistory()?.commits ?? []));
  protected readonly graphRowHeight = GRAPH_CENTER * 2;
  protected readonly graphNodeCenter = GRAPH_CENTER;
  protected readonly graphWidth = computed(
    () => Math.max(1, ...this.graphRows().map((row) => row.lanes)) * GRAPH_LANE_WIDTH,
  );

  protected readonly selectedCommit = linkedSignal({
    source: this.historyScope,
    computation: (): RepositoryCommit | null => null,
  });
  protected readonly commitDetails = signal<CommitDetails | null>(null);
  protected readonly commitError = signal('');
  protected readonly comparisonHead = linkedSignal({
    source: this.historyScope,
    computation: () => '',
  });
  private readonly chosenComparisonBase = linkedSignal({
    source: this.historyScope,
    computation: () => '',
  });
  protected readonly comparisonBase = computed(() => (
    this.chosenComparisonBase() ||
    this.historyBranches().find((item) => item.reference === 'refs/heads/' + this.overview()?.branch)?.reference ||
    this.historyBranches()[0]?.reference || ''
  ));
  protected readonly comparison = signal<BranchComparison | null>(null);
  protected readonly comparisonError = signal('');
  protected readonly comparisonReady = computed(() => {
    const base = this.comparisonBase();
    const head = this.comparisonHead();
    return !!base && !!head && head !== base;
  });

  private readonly diffViewport = viewChild<ElementRef<HTMLElement>>('diffViewport');
  protected readonly changeBlocks = computed(() => changeBlockStarts(this.rows()));
  /** Which change was stepped to, or -1 before the first step. */
  private readonly activeChange = signal(-1);
  /** Rows that started as a collapsed placeholder; the user has expanded them. */
  private readonly expandedRows = signal<ReadonlySet<number>>(new Set());
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
    this.destroyRef.onDestroy(() => clearTimeout(this.clipboardTimer));
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(([entry]) => {
        if (!this.destroyRef.destroyed) this.compact.set(entry.contentRect.width <= COMPACT_GIT_WIDTH);
      });
      observer.observe(this.host.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
    effect(() => {
      const overview = this.overview();
      const target = this.target();
      // Without an overview there is no file list to pick from, and whatever diff is on screen
      // belongs to an answer that no longer stands.
      if (!overview?.available || !target) {
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
    effect((onCleanup) => {
      const scope = this.historyScope();
      const target = untracked(this.target);
      if (!scope || !target || !this.historyVisible()) return;
      const branch = this.historyBranch();
      this.historyHead();
      this.historyRefresh();
      this.historyLoading.set(true);
      this.historyPaging.set(false);
      this.historyError.set('');
      this.historyPageError.set('');
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
        this.historyGeneration++;
      });
      void this.git.loadHistory(target, branch)
        .then((data) => {
          if (!cancelled) this.history.set({ scope, data });
        })
        .catch((error: unknown) => {
          if (!cancelled) this.historyError.set(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (!cancelled) this.historyLoading.set(false);
        });
    });
    effect((onCleanup) => {
      const commit = this.selectedCommit();
      const target = untracked(this.target);
      this.historyRefresh();
      this.commitDetails.set(null);
      this.commitError.set('');
      if (!commit || !target) return;
      let cancelled = false;
      onCleanup(() => { cancelled = true; });
      void this.git.loadCommit(target, commit.oid)
        .then((data) => { if (!cancelled) this.commitDetails.set(data); })
        .catch((error: unknown) => { if (!cancelled) this.commitError.set(String(error)); });
    });
    effect((onCleanup) => {
      const target = untracked(this.target);
      const base = this.comparisonBase();
      const head = this.comparisonHead();
      this.historyHead();
      this.historyRefresh();
      this.comparison.set(null);
      this.comparisonError.set('');
      if (!this.historyScope() || !target || this.sidebarTab() !== 'compare' || !this.comparisonReady()) return;
      let cancelled = false;
      onCleanup(() => { cancelled = true; });
      void this.git.compareBranches(target, base, head)
        .then((data) => { if (!cancelled) this.comparison.set(data); })
        .catch((error: unknown) => { if (!cancelled) this.comparisonError.set(String(error)); });
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

  /** Expand by the original line number, which stays stable as other blocks open. */
  protected toggleCollapse(rowIndex: number): void {
    const row = this.rows()[rowIndex];
    if (row?.kind !== 'collapsed') return;
    const expanded = new Set(this.expandedRows());
    expanded.add(row.firstNewLine);
    this.expandedRows.set(expanded);
    this.activeChange.set(-1);
    queueMicrotask(() => this.scrollToRow(rowIndex));
  }

  /** Alt with an arrow key, which nothing in the diff consumes. */
  @HostListener('keydown', ['$event'])
  protected onKeyDown(event: KeyboardEvent): void {
    if (this.sidebarTab() !== 'changes' || !event.altKey || event.ctrlKey || event.metaKey) return;
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
    if (this.compact()) this.focusPreference.set(true);
  }

  protected toggleFocusDiff(): void {
    this.focusPreference.set(!this.focusDiff());
  }

  protected stepFile(step: 1 | -1): void {
    const files = this.filteredChanges();
    if (!files.length) return;
    const index = files.findIndex((change) => change.path === this.selectedPath());
    const next = index < 0 ? (step > 0 ? 0 : files.length - 1)
      : (index + step + files.length) % files.length;
    const path = files[next].path;
    const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    this.collapsedDirs.update((items) => new Set([...items].filter((item) => item !== directory)));
    this.sidebarTab.set('changes');
    this.git.selectPath(path);
    queueMicrotask(() => this.changeList()?.nativeElement
      .querySelector<HTMLElement>('.change-file.active')?.scrollIntoView?.({ block: 'nearest' }));
  }

  protected onFilterInput(event: Event): void {
    this.fileFilter.set((event.target as HTMLInputElement).value);
  }

  protected toggleDir(dir: string): void {
    const next = new Set(this.collapsedDirs());
    if (!next.delete(dir)) next.add(dir);
    this.collapsedDirs.set(next);
  }

  protected fileName(path: string): string {
    return path.split('/').at(-1) ?? path;
  }

  protected copyOid(oid: string): Promise<void> {
    return this.copyText(oid);
  }

  protected copyPath(): Promise<void> {
    const path = this.selectedPath();
    return path ? this.copyText(path) : Promise.resolve();
  }

  private async copyText(value: string): Promise<void> {
    this.copyError.set('');
    try {
      await writeClipboardText(value);
      if (this.destroyRef.destroyed) return;
      clearTimeout(this.clipboardTimer);
      this.copiedValue.set(value);
      this.clipboardTimer = setTimeout(() => this.copiedValue.set(''), CLIPBOARD_FEEDBACK_MS);
    } catch (error) {
      if (!this.destroyRef.destroyed)
        this.copyError.set(this.i18n.t('git.ui.copyFailed', {
          error: error instanceof Error ? error.message : String(error),
        }));
    }
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

  protected selectHistoryBranch(event: Event): void {
    this.historyBranch.set((event.target as HTMLSelectElement).value || null);
    this.selectedCommit.set(null);
  }

  protected async loadOlderCommits(): Promise<void> {
    const history = this.currentHistory();
    const scope = this.historyScope();
    const target = this.target();
    const branch = this.historyBranch();
    if (!history?.next || !scope || !target || this.historyLoading() || this.historyPaging()) return;
    const generation = this.historyGeneration;
    this.historyPaging.set(true);
    this.historyPageError.set('');
    try {
      const data = await this.git.loadHistory(target, branch, history.next);
      if (generation !== this.historyGeneration || scope !== this.historyScope() || branch !== this.historyBranch()) return;
      this.history.set({ scope, data: { ...data, commits: [...history.commits, ...data.commits] } });
    } catch (error) {
      if (generation === this.historyGeneration) this.historyPageError.set(String(error));
    } finally {
      if (generation === this.historyGeneration) this.historyPaging.set(false);
    }
  }

  protected selectComparisonBranch(side: 'base' | 'head', event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    (side === 'base' ? this.chosenComparisonBase : this.comparisonHead).set(value);
  }

  protected swapComparisonBranches(): void {
    const base = this.comparisonBase();
    const head = this.comparisonHead();
    this.chosenComparisonBase.set(head);
    this.comparisonHead.set(base);
  }

  protected branchName(reference: string): string {
    return this.historyBranches().find((branch) => branch.reference === reference)?.name ?? reference;
  }

  protected refresh(): void {
    if (this.historyVisible()) this.historyRefresh.update((version) => version + 1);
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
    this.expandedRows.set(new Set());
    this.diffError.set('');
    this.diffLoading.set(false);
  }

  private diffKey(path: string, target: RepositoryTarget): string {
    return `${target.workspaceId}:${target.terminalId}:${target.runtimeRevision}:${path}`;
  }

  private async loadDiff(path: string, target: RepositoryTarget): Promise<void> {
    const requestRevision = ++this.diffRequestRevision;
    this.expandedRows.set(new Set());
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

function graphColumn(lane: number): number {
  return lane * GRAPH_LANE_WIDTH + GRAPH_LANE_WIDTH / 2;
}

function graphEdge(fromLane: number, y1: number, toLane: number, y2: number, color: string): CommitGraphEdge {
  const x1 = graphColumn(fromLane);
  const x2 = graphColumn(toLane);
  const mid = (y1 + y2) / 2;
  const path = fromLane === toLane
    ? `M${x1} ${y1} V${y2}`
    : `M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
  return { path, color };
}

export function buildCommitGraph(commits: readonly RepositoryCommit[]): CommitGraphRow[] {
  const lanes: { oid: string; color: string }[] = [];
  let colorIndex = 0;
  const nextColor = () => GRAPH_COLORS[colorIndex++ % GRAPH_COLORS.length];

  return commits.map((commit) => {
    let lane = lanes.findIndex((entry) => entry.oid === commit.oid);
    const continuing = lane >= 0;
    if (!continuing) {
      lane = lanes.length;
      lanes.push({ oid: commit.oid, color: nextColor() });
    }
    const before = lanes.slice();
    const color = before[lane].color;
    const [firstParent, ...otherParents] = commit.parentOids;
    lanes.splice(lane, 1);
    if (firstParent && !lanes.some((entry) => entry.oid === firstParent)) {
      lanes.splice(lane, 0, { oid: firstParent, color });
    }
    let insertAt = lane + 1;
    for (const parent of otherParents) {
      if (!lanes.some((entry) => entry.oid === parent)) {
        lanes.splice(insertAt++, 0, { oid: parent, color: nextColor() });
      }
    }

    const edges = before.flatMap((entry, index) => {
      if (index === lane) return [];
      const next = lanes.indexOf(entry);
      return [graphEdge(index, 0, next, GRAPH_CENTER * 2, entry.color)];
    });
    if (continuing) edges.push(graphEdge(lane, 0, lane, GRAPH_CENTER, color));
    for (const parent of commit.parentOids) {
      const next = lanes.findIndex((entry) => entry.oid === parent);
      edges.push(graphEdge(lane, GRAPH_CENTER, next, GRAPH_CENTER * 2, lanes[next].color));
    }
    return { commit, lanes: Math.max(before.length, lanes.length), nodeX: graphColumn(lane), color, edges };
  });
}
