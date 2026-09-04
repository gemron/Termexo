import { describe, expect, it } from 'vitest';

import type { RepositoryCommit } from '../core/models/git.models';
import { buildCommitGraph } from './git-workbench';

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
