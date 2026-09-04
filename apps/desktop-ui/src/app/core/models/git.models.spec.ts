import { describe, expect, it } from 'vitest';

import { buildDiffRows } from './git.models';

describe('buildDiffRows', () => {
  it('aligns replacements for split view', () => {
    const rows = buildDiffRows('one\nold\nthree\n', 'one\nnew\nthree\n');

    expect(rows).toEqual([
      { kind: 'equal', oldLine: 1, newLine: 1, oldText: 'one', newText: 'one' },
      { kind: 'changed', oldLine: 2, newLine: 2, oldText: 'old', newText: 'new' },
      { kind: 'equal', oldLine: 3, newLine: 3, oldText: 'three', newText: 'three' },
    ]);
  });

  it('retains added lines without an old line number', () => {
    const rows = buildDiffRows('one\n', 'one\ntwo\n');

    expect(rows[1]).toEqual({
      kind: 'added',
      oldLine: undefined,
      newLine: 2,
      oldText: '',
      newText: 'two',
    });
  });

  it('distinguishes a missing final newline', () => {
    const rows = buildDiffRows('one\n', 'one');

    expect(rows.at(-1)).toMatchObject({ kind: 'removed', oldText: '', newLine: undefined });
  });

  it('keeps both sides when a line is replaced with an empty line', () => {
    const rows = buildDiffRows('value', '');

    expect(rows).toEqual([
      {
        kind: 'removed',
        oldLine: 1,
        newLine: undefined,
        oldText: 'value',
        newText: '',
      },
    ]);
  });
});
