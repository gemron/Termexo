import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  RepositoryChange,
  RepositoryCommit,
  RepositoryOverview,
} from '../core/models/git.models';
import { GitService } from '../core/services/git.service';
import { I18nService } from '../core/i18n/i18n.service';
import { buildCommitGraph, GitWorkbenchComponent } from './git-workbench';

const clipboardWrite = vi.fn<(text: string) => Promise<void>>();

function change(path: string): RepositoryChange {
  return {
    path,
    indexStatus: 'M',
    worktreeStatus: 'M',
    untracked: false,
    committed: false,
    preExisting: false,
  };
}

const OVERVIEW: RepositoryOverview = {
  available: true,
  diagnostic: '',
  root: 'D:/devlop/Termexo',
  branch: 'preview/v0.8.0',
  detached: false,
  baselineCaptured: true,
  historyRewritten: false,
  changes: [change('src/app/app.ts'), change('src/app/git/git-workbench.ts')],
  commits: [],
  watched: false,
};

function commit(oid: string, parentOids: string[]): RepositoryCommit {
  return {
    oid,
    shortOid: oid,
    parentOids,
    decorations: [],
    author: 'Termexo',
    committedAt: 0,
    summary: oid,
    inSession: false,
  };
}

describe('buildCommitGraph', () => {
  it('creates a second lane for a merge parent', () => {
    const rows = buildCommitGraph([
      commit('merge', ['main-parent', 'side-parent']),
      commit('main-parent', []),
      commit('side-parent', []),
    ]);

    expect(rows[0].nodeX).toBe(6);
    expect(rows[0].edges.map((edge) => edge.path)).toEqual(['M6 16 V32', 'M6 16 C6 24 18 24 18 32']);
    expect(rows[0].edges[0].color).not.toBe(rows[0].edges[1].color);
    expect(rows[1].lanes).toBe(2);
    expect(rows[1].edges).toContainEqual(expect.objectContaining({ path: 'M18 0 C18 16 6 16 6 32' }));
    expect(rows[2].nodeX).toBe(6);
  });

  it('collapses duplicate lanes when merge parents converge', () => {
    const rows = buildCommitGraph([
      commit('merge', ['left', 'right']),
      commit('left', ['root']),
      commit('right', ['root']),
      commit('root', []),
    ]);

    expect(rows[2].edges).toContainEqual(expect.objectContaining({ path: 'M18 16 C18 24 6 24 6 32' }));
    expect(rows[3].lanes).toBe(1);
  });
});

/**
 * The view is mounted for every state now, so it has to say which one it is in: before, a read
 * that had not answered yet left the workspace blank.
 */
describe('GitWorkbenchComponent states', () => {
  let fixture: ComponentFixture<GitWorkbenchComponent>;
  let root: HTMLElement;
  let git: GitService;
  let clipboardDescriptor: PropertyDescriptor | undefined;

  beforeEach(async () => {
    window.localStorage.clear();
    clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    clipboardWrite.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
    await TestBed.configureTestingModule({ imports: [GitWorkbenchComponent] }).compileComponents();
    TestBed.inject(I18nService).setPreference('en');
    git = TestBed.inject(GitService);
    git.selectPath('');
    fixture = TestBed.createComponent(GitWorkbenchComponent);
    root = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
    vi.unstubAllGlobals();
  });

  async function showRepository(overview = OVERVIEW) {
    vi.spyOn(git, 'loadHistory').mockResolvedValue({
      branches: [{ reference: 'refs/heads/main', name: 'main' }],
      commits: overview.commits,
    });
    const diff = vi.spyOn(git, 'loadDiff').mockImplementation(async (_target, path) => ({
      path, oldText: 'old content', newText: 'updated content', binary: false, truncated: false,
    }));
    fixture.componentRef.setInput('overview', overview);
    fixture.componentRef.setInput('target', {
      workspaceId: 'workspace-1', terminalId: 'terminal-1', runtimeRevision: 0,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return diff;
  }

  function waitForCommits(count: number) {
    return vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.querySelectorAll('.commit-row')).toHaveLength(count);
    });
  }

  it('gives changes and history separate views while preserving the current diff', async () => {
    await showRepository({ ...OVERVIEW, commits: [commit('abc123', [])] });
    const tabs = root.querySelectorAll<HTMLButtonElement>('.sidebar-tabs button');
    const changes = root.querySelector<HTMLElement>('.git-content')!;
    const history = root.querySelector<HTMLElement>('.graph-panel')!;
    expect(changes.hidden).toBe(false);
    expect(history.hidden).toBe(true);
    tabs[1].click();
    fixture.detectChanges();
    expect(changes.hidden).toBe(true);
    expect(history.hidden).toBe(false);
    expect(tabs[1].getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.diff-viewport')?.textContent).toContain('updated content');
    tabs[0].click();
    fixture.detectChanges();
    expect(root.querySelectorAll('.change-file')).toHaveLength(2);
    expect(git.selectedPath()).toBe(OVERVIEW.changes[0].path);
  });

  it('appends older commits and shows their metadata and file differences', async () => {
    await showRepository();
    const cursor = { offset: 1, snapshot: 'history' };
    const latest = commit('recent', ['older']);
    const older = commit('older', []);
    vi.mocked(git.loadHistory).mockImplementation(async (_target, _branch, next) => ({
      branches: [],
      commits: next ? [older] : [latest],
      next: next ? null : cursor,
    }));
    const range = { baseOid: null, headOid: older.oid };
    const file = change('README.md');
    vi.spyOn(git, 'loadCommit').mockResolvedValue({
      range, summary: 'Start project', body: 'Full commit body', author: 'Termexo', email: '', authoredAt: 0,
      parents: [], files: [file],
    });
    vi.spyOn(git, 'loadRevisionDiff').mockResolvedValue({
      path: file.path, oldText: '', newText: 'Initial content', binary: false, truncated: false,
    });
    root.querySelectorAll<HTMLButtonElement>('.sidebar-tabs button')[1].click();
    await waitForCommits(1);
    root.querySelector<HTMLButtonElement>('[data-testid="git-history-more"]')!.click();
    await waitForCommits(2);
    expect(vi.mocked(git.loadHistory).mock.calls.at(-1)?.[2]).toEqual(cursor);
    expect(root.querySelectorAll('.commit-row')).toHaveLength(2);
    expect(root.querySelector('[data-testid="git-history-more"]')).toBeNull();
    root.querySelectorAll<HTMLButtonElement>('[data-testid="git-commit-details"]')[1].click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.querySelector('[data-testid="git-revision-diff"]')?.textContent).toContain('Initial content');
    });
    expect(git.loadCommit).toHaveBeenCalledWith(expect.anything(), older.oid);
    expect(root.querySelector('.commit-details')?.textContent).toContain('Full commit body');
  });

  it('compares branches in the chosen direction and swaps them', async () => {
    await showRepository();
    const base = 'refs/heads/main';
    const head = 'refs/remotes/origin/feature';
    vi.mocked(git.loadHistory).mockResolvedValue({
      branches: [{ reference: base, name: 'main' }, { reference: head, name: 'origin/feature' }],
      commits: [],
    });
    const compare = vi.spyOn(git, 'compareBranches').mockResolvedValue({
      range: { baseOid: 'base-oid', headOid: 'head-oid' }, baseOnly: 2, headOnly: 4, files: [],
    });
    root.querySelectorAll<HTMLButtonElement>('.sidebar-tabs button')[2].click();
    const input = await vi.waitFor(() => {
      fixture.detectChanges();
      const select = root.querySelector<HTMLSelectElement>('[data-testid="git-compare-head"]')!;
      expect(select.options).toHaveLength(3);
      return select;
    });
    input.value = head;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.querySelector('.comparison-summary')?.textContent).toContain('origin/feature only · 4 commits');
    });
    expect(compare).toHaveBeenCalledWith(expect.anything(), base, head);
    root.querySelector<HTMLButtonElement>('button[aria-label="Swap branches"]')!.click();
    fixture.detectChanges();
    expect(compare).toHaveBeenLastCalledWith(expect.anything(), head, base);
  });

  it('loads the selected branch and keeps the current diff selection', async () => {
    await showRepository();
    const branches = [
      { reference: 'refs/heads/main', name: 'main' },
      { reference: 'refs/remotes/origin/feature', name: 'origin/feature' },
    ];
    vi.mocked(git.loadHistory).mockImplementation(async (_target, branch) => ({
      branches,
      commits: branch ? [commit('feature work', [])] : [commit('main work', []), commit('feature work', [])],
    }));
    root.querySelectorAll<HTMLButtonElement>('.sidebar-tabs button')[1].click();
    fixture.detectChanges();
    await waitForCommits(2);
    const select = root.querySelector<HTMLSelectElement>('[data-testid="git-history-branch"]')!;
    select.value = 'refs/remotes/origin/feature';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await waitForCommits(1);
    expect(git.loadHistory).toHaveBeenLastCalledWith(expect.anything(), 'refs/remotes/origin/feature');
    expect(root.querySelector('.commit-copy strong')?.textContent).toBe('feature work');
    expect(git.selectedPath()).toBe(OVERVIEW.changes[0].path);
  });

  it('filters paths with a visible result count and clears the filter without losing selection', async () => {
    await showRepository();
    const input = root.querySelector<HTMLInputElement>('.file-filter input')!;
    input.value = 'GIT-WORKBENCH';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(root.querySelectorAll('.change-file')).toHaveLength(1);
    expect(root.querySelector('.filter-results')?.textContent).toContain('1 of 2');
    expect(git.selectedPath()).toBe(OVERVIEW.changes[0].path);
    root.querySelector<HTMLButtonElement>('.clear-filter')!.click();
    fixture.detectChanges();
    expect(root.querySelectorAll('.change-file')).toHaveLength(2);
    expect(root.querySelector('.change-file.active')).not.toBeNull();
  });

  it('steps through filtered files and reveals a selected file in a collapsed directory', async () => {
    await showRepository({ ...OVERVIEW, changes: [...OVERVIEW.changes, change('scripts/build.sh')] });
    const input = root.querySelector<HTMLInputElement>('.file-filter input')!;
    input.value = 'src/';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('.view-toggle')!.click();
    fixture.detectChanges();
    const directory = [...root.querySelectorAll<HTMLButtonElement>('.dir-row')]
      .find((item) => item.textContent?.includes('src/app/git'))!;
    directory.click();
    fixture.detectChanges();
    expect(root.querySelectorAll('.change-file')).toHaveLength(1);
    const buttons = root.querySelectorAll<HTMLButtonElement>('.file-nav button');
    buttons[1].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(git.selectedPath()).toBe(OVERVIEW.changes[1].path);
    expect(root.querySelector('.file-nav span')?.textContent).toBe('2/2');
    expect(root.querySelector('.change-file.active strong')?.textContent).toBe('git-workbench.ts');
    buttons[1].click();
    fixture.detectChanges();
    expect(git.selectedPath()).toBe(OVERVIEW.changes[0].path);
  });

  it('toggles wrapping and focused reading without reloading the file or changing its layout', async () => {
    const load = await showRepository();
    const layout = git.diffLayout();
    root.querySelector<HTMLButtonElement>('.diff-option:not(.focus-toggle)')!.click();
    root.querySelector<HTMLButtonElement>('.focus-toggle')!.click();
    fixture.detectChanges();
    expect(root.querySelector('.diff-viewport.wrap-lines')).not.toBeNull();
    expect(root.querySelector<HTMLElement>('.git-sidebar')!.hidden).toBe(true);
    expect(root.querySelector('.diff-viewport')?.textContent).toContain('updated content');
    expect(git.diffLayout()).toBe(layout);
    expect(load).toHaveBeenCalledTimes(1);
    root.querySelector<HTMLButtonElement>('.focus-toggle')!.click();
    fixture.detectChanges();
    expect(root.querySelector<HTMLElement>('.git-sidebar')!.hidden).toBe(false);
  });

  it('copies the selected path and complete commit hash through the desktop-aware clipboard helper', async () => {
    await showRepository({ ...OVERVIEW, commits: [commit('full-commit-hash', [])] });
    root.querySelector<HTMLButtonElement>('.copy-path')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(clipboardWrite).toHaveBeenCalledWith(OVERVIEW.changes[0].path);
    expect(root.querySelector('.copy-feedback')?.textContent).toContain('Copied');
    root.querySelectorAll<HTMLButtonElement>('.sidebar-tabs button')[1].click();
    fixture.detectChanges();
    await waitForCommits(1);
    root.querySelector<HTMLButtonElement>('.oid')!.click();
    await fixture.whenStable();
    expect(clipboardWrite).toHaveBeenCalledWith('full-commit-hash');
  });

  it('reports clipboard failures instead of showing a false success', async () => {
    await showRepository();
    clipboardWrite.mockRejectedValue(new Error('clipboard denied'));
    root.querySelector<HTMLButtonElement>('.copy-path')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('.copy-feedback.error')?.textContent).toContain('clipboard denied');
  });

  it('explains a non-repository directory instead of presenting it as a clean repository', async () => {
    const load = await showRepository({
      ...OVERVIEW, available: false, diagnostic: 'Choose a project containing a .git directory', changes: [],
    });
    expect(root.querySelector('.git-content')).toBeNull();
    expect(root.textContent).toContain('No Git repository');
    expect(root.textContent).toContain('Choose a project');
    expect(root.querySelector('.retry-button')).not.toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('waits visibly while the repository read has no answer', () => {
    fixture.detectChanges();

    expect(root.querySelector('.loading-spinner')).not.toBeNull();
    expect(root.querySelector('.git-content')).toBeNull();
  });

  it('reports a failed read and offers a retry', () => {
    fixture.componentRef.setInput('overviewError', 'git 未安装');
    fixture.detectChanges();

    expect(root.querySelector('.empty-state.error')?.textContent).toContain('git 未安装');
    expect(root.querySelector('.retry-button')).not.toBeNull();
  });

  it('names the terminal the changes are measured against', () => {
    fixture.componentRef.setInput('overview', OVERVIEW);
    fixture.componentRef.setInput('target', {
      workspaceId: 'workspace-1',
      terminalId: 'terminal-1',
      runtimeRevision: 0,
    });
    fixture.componentRef.setInput('terminalName', 'Claude - Core');
    fixture.detectChanges();

    expect(root.querySelector('.session-chip')?.textContent).toContain('Claude - Core');
    expect(root.querySelectorAll('.change-file')).toHaveLength(2);
  });

  it('opens on the file the service remembers rather than the first one', () => {
    git.selectPath('src/app/git/git-workbench.ts');
    fixture.componentRef.setInput('overview', OVERVIEW);
    fixture.componentRef.setInput('target', {
      workspaceId: 'workspace-1',
      terminalId: 'terminal-1',
      runtimeRevision: 0,
    });
    fixture.detectChanges();

    expect(root.querySelector('.change-file.active strong')?.textContent).toBe('git-workbench.ts');
  });

  it.each(['unified', 'split'] as const)('expands all hidden lines in %s view', async (layout) => {
    const context = Array.from({ length: 12 }, (_, i) => `context ${i}`).join('\n');
    vi.spyOn(git, 'loadDiff').mockResolvedValue({
      path: OVERVIEW.changes[0].path,
      oldText: `${context}\nold\n${context}`,
      newText: `${context}\nnew\n${context}`,
      binary: false,
      truncated: false,
    });
    git.setDiffLayout(layout);
    fixture.componentRef.setInput('overview', OVERVIEW);
    fixture.componentRef.setInput('target', {
      workspaceId: 'workspace-1',
      terminalId: 'terminal-1',
      runtimeRevision: 0,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelectorAll('.diff-collapse').length).toBeGreaterThan(0);
    const viewport = root.querySelector<HTMLElement>('.diff-viewport')!;
    viewport.scrollTo = vi.fn();
    for (let block = 0; block < 2; block++) {
      root.querySelector<HTMLButtonElement>('.diff-collapse')!.click();
      fixture.detectChanges();
      await fixture.whenStable();
    }
    expect(root.querySelector('.diff-collapse')).toBeNull();
    expect(root.querySelectorAll('.diff-line')).toHaveLength(layout === 'split' ? 50 : 26);
    expect(viewport.textContent).toContain('old');
    expect(viewport.textContent).toContain('new');
    expect(viewport.textContent).toContain('context 11');
  });
});
