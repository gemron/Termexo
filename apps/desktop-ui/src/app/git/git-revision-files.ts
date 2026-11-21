import {
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  buildDiffRows,
  repositoryChangeStatus,
  withCollapsedEquals,
  type RepositoryChange,
  type RepositoryDiff,
  type RepositoryTarget,
  type RevisionRange,
} from '../core/models/git.models';
import { GitService } from '../core/services/git.service';

@Component({
  selector: 'app-git-revision-files',
  imports: [TranslatePipe],
  templateUrl: './git-revision-files.html',
  styleUrl: './git-revision-files.scss',
})
export class GitRevisionFilesComponent {
  private readonly git = inject(GitService);
  readonly target = input.required<RepositoryTarget>();
  readonly range = input.required<RevisionRange>();
  readonly files = input.required<readonly RepositoryChange[]>();
  protected readonly selected = linkedSignal({
    source: this.files,
    computation: (files) => files[0]?.path ?? '',
  });
  protected readonly diff = signal<RepositoryDiff | null>(null);
  protected readonly error = signal('');
  private readonly retry = signal(0);
  private readonly expanded = signal<ReadonlySet<number>>(new Set());
  protected readonly rows = computed(() => {
    const diff = this.diff();
    return diff && !diff.binary
      ? withCollapsedEquals(buildDiffRows(diff.oldText, diff.newText), (row) => this.expanded().has(row.firstNewLine))
      : [];
  });
  private readonly targetKey = computed(() => {
    const target = this.target();
    return `${target.workspaceId}:${target.terminalId}:${target.runtimeRevision}`;
  });
  protected readonly status = repositoryChangeStatus;

  constructor() {
    effect((onCleanup) => {
      const path = this.selected();
      const file = this.files().find((item) => item.path === path);
      const range = this.range();
      this.targetKey();
      const target = untracked(this.target);
      this.retry();
      this.diff.set(null);
      this.error.set('');
      this.expanded.set(new Set());
      if (!file) return;

      let cancelled = false;
      onCleanup(() => { cancelled = true; });
      void this.git.loadRevisionDiff(target, range, file)
        .then((diff) => { if (!cancelled) this.diff.set(diff); })
        .catch((error: unknown) => { if (!cancelled) this.error.set(String(error)); });
    });
  }

  protected select(event: Event): void {
    this.selected.set((event.target as HTMLSelectElement).value);
  }

  protected retryDiff(): void {
    this.retry.update((attempt) => attempt + 1);
  }

  protected expand(firstLine: number): void {
    this.expanded.update((items) => new Set([...items, firstLine]));
  }
}
