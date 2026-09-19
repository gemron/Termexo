import { describe, expect, it } from 'vitest';

import { buildDiffRows, changeBlockStarts, withCollapsedEquals } from './git.models';

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

describe('changeBlockStarts', () => {
  it('reports one stop per run of changed lines, not one per line', () => {
    const rows = buildDiffRows('a\nb\nc\nd\ne\n', 'a\nB\nC\nd\nE\n');

    // Rows 1 and 2 are one edit to the reader; the unchanged row 3 ends it, and row 4 is a second.
    expect(changeBlockStarts(rows)).toEqual([1, 4]);
  });

  it('stops at a change that opens the file', () => {
    const rows = buildDiffRows('old\nkeep\n', 'new\nkeep\n');

    expect(changeBlockStarts(rows)).toEqual([0]);
  });

  it('has nowhere to stop in a file that did not change', () => {
    expect(changeBlockStarts(buildDiffRows('same\n', 'same\n'))).toEqual([]);
  });
});

describe('withCollapsedEquals', () => {
  it('preserves every changed row and reaches the end of the file', () => {
    const rows = buildDiffRows('old\nkeep\nremove', 'new\nkeep\nadd\nextra');
    expect(withCollapsedEquals(rows)).toEqual(rows);
  });

  it('restores all lines when expanding separated unchanged blocks', () => {
    const context = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
    const rows = buildDiffRows(`${context}\nold\n${context}`, `${context}\nnew\n${context}`);
    const folded = withCollapsedEquals(rows);
    expect(folded.filter((row) => row.kind === 'collapsed')).toHaveLength(2);
    expect(folded.filter((row) => row.kind === 'changed')).toHaveLength(1);
    expect(withCollapsedEquals(rows, () => true)).toEqual(rows);
  });
});
