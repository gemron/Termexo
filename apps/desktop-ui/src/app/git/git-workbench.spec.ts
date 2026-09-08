import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  RepositoryChange,
  RepositoryCommit,
  RepositoryOverview,
} from '../core/models/git.models';
import { GitService } from '../core/services/git.service';
import { buildCommitGraph, GitWorkbenchComponent } from './git-workbench';

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

    expect(rows[0].lane).toBe(0);
    expect(rows[0].parentLanes).toEqual([0, 1]);
    expect(rows[1].lanes).toBe(2);
    expect(rows[2].lane).toBe(0);
  });

  it('collapses duplicate lanes when merge parents converge', () => {
    const rows = buildCommitGraph([
      commit('merge', ['left', 'right']),
      commit('left', ['root']),
      commit('right', ['root']),
      commit('root', []),
    ]);

    expect(rows[2].parentLanes).toEqual([0]);
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

  beforeEach(async () => {
    window.localStorage.clear();
    await TestBed.configureTestingModule({ imports: [GitWorkbenchComponent] }).compileComponents();
    git = TestBed.inject(GitService);
    git.selectPath('');
    fixture = TestBed.createComponent(GitWorkbenchComponent);
    root = fixture.nativeElement as HTMLElement;
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
});
