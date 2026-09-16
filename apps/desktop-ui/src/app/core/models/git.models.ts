export interface RepositoryTarget {
  workspaceId: string;
  terminalId: string;
  runtimeRevision: number;
}

export interface RepositoryChange {
  path: string;
  oldPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  untracked: boolean;
  committed: boolean;
  preExisting: boolean;
}

export interface RepositoryCommit {
  oid: string;
  shortOid: string;
  parentOids: string[];
  decorations: string[];
  author: string;
  committedAt: number;
  summary: string;
  inSession: boolean;
}

export interface RepositoryOverview {
  available: boolean;
  diagnostic: string;
  root: string;
  branch: string;
  detached: boolean;
  head?: string;
  baselineHead?: string;
  baselineCaptured: boolean;
  historyRewritten: boolean;
  changes: RepositoryChange[];
  commits: RepositoryCommit[];
  /** The backend is watching this repository and will announce changes; polling can rest. */
  watched: boolean;
}

export interface RepositoryDiff {
  path: string;
  oldText: string;
  newText: string;
  binary: boolean;
  truncated: boolean;
}

export function repositoryChangeStatus(change: RepositoryChange): 'A' | 'D' | 'M' | 'R' | 'U' {
  if (change.untracked) return 'U';
  if (change.indexStatus === 'A') return 'A';
  if (change.indexStatus === 'D' || change.worktreeStatus === 'D') return 'D';
  if (change.oldPath || change.indexStatus === 'R') return 'R';
  return 'M';
}

export type DiffLayout = 'unified' | 'split';

export interface DiffRow {
  kind: 'equal' | 'added' | 'removed' | 'changed';
  oldLine?: number;
  newLine?: number;
  oldText: string;
  newText: string;
}

/**
 * `equal` rows that the template renders behind a "show N unchanged lines" toggle. The collapse is
 * purely a render-time convenience — every original row lives in `rows`, in order, so jumping to a
 * specific line by `oldLine` / `newLine` still resolves.
 */
export interface CollapsedEqualRow {
  kind: 'collapsed';
  /** Number of equal lines the placeholder stands in for. */
  count: number;
  firstOldLine: number;
  firstNewLine: number;
  lastOldLine: number;
  lastNewLine: number;
}

export type DiffDisplayRow = DiffRow | CollapsedEqualRow;

export function isCollapsed(row: DiffDisplayRow): row is CollapsedEqualRow {
  return row.kind === 'collapsed';
}

const MAX_LCS_CELLS = 2_000_000;

/**
 * The first row of every run of changed lines.
 *
 * Navigation steps by run rather than by row: one edit spanning twenty lines is one change to the
 * reader, and stopping on each of its lines would make the button useless on exactly the diffs
 * where it matters most.
 */
export function changeBlockStarts(rows: readonly DiffDisplayRow[]): number[] {
  const starts: number[] = [];
  let inBlock = false;
  rows.forEach((row, index) => {
    const changed = row.kind !== 'equal';
    if (changed && !inBlock) starts.push(index);
    inBlock = changed;
  });
  return starts;
}

function lines(value: string): string[] {
  if (!value) return [];
  return value.replace(/\r\n/g, '\n').split('\n');
}

/** Builds aligned rows for both unified and split rendering without adding a diff dependency. */
export function buildDiffRows(oldText: string, newText: string): DiffRow[] {
  const oldLines = lines(oldText);
  const newLines = lines(newText);
  if (oldLines.length * newLines.length > MAX_LCS_CELLS) {
    return trimSharedTerminator(coarseDiffRows(oldLines, newLines), oldText, newText);
  }

  const width = newLines.length + 1;
  const table = new Uint32Array((oldLines.length + 1) * width);
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      const cell = oldIndex * width + newIndex;
      table[cell] =
        oldLines[oldIndex] === newLines[newIndex]
          ? table[(oldIndex + 1) * width + newIndex + 1] + 1
          : Math.max(table[(oldIndex + 1) * width + newIndex], table[cell + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length &&
      newIndex < newLines.length &&
      oldLines[oldIndex] === newLines[newIndex]
    ) {
      rows.push({
        kind: 'equal',
        oldLine: oldIndex + 1,
        newLine: newIndex + 1,
        oldText: oldLines[oldIndex],
        newText: newLines[newIndex],
      });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      newIndex < newLines.length &&
      (oldIndex === oldLines.length ||
        table[oldIndex * width + newIndex + 1] >= table[(oldIndex + 1) * width + newIndex])
    ) {
      rows.push({
        kind: 'added',
        newLine: newIndex + 1,
        oldText: '',
        newText: newLines[newIndex],
      });
      newIndex += 1;
    } else {
      rows.push({
        kind: 'removed',
        oldLine: oldIndex + 1,
        oldText: oldLines[oldIndex],
        newText: '',
      });
      oldIndex += 1;
    }
  }
  return trimSharedTerminator(alignChangedRows(rows), oldText, newText);
}

function trimSharedTerminator(rows: DiffRow[], oldText: string, newText: string): DiffRow[] {
  const last = rows.at(-1);
  if (
    oldText.endsWith('\n') &&
    newText.endsWith('\n') &&
    last?.kind === 'equal' &&
    last.oldText === '' &&
    last.newText === ''
  ) {
    rows.pop();
  }
  return rows;
}

function alignChangedRows(rows: DiffRow[]): DiffRow[] {
  const aligned: DiffRow[] = [];
  for (let index = 0; index < rows.length;) {
    if (rows[index].kind === 'equal') {
      aligned.push(rows[index]);
      index += 1;
      continue;
    }
    const removed: DiffRow[] = [];
    const added: DiffRow[] = [];
    while (index < rows.length && rows[index].kind !== 'equal') {
      (rows[index].kind === 'removed' ? removed : added).push(rows[index]);
      index += 1;
    }
    const count = Math.max(removed.length, added.length);
    for (let offset = 0; offset < count; offset += 1) {
      const oldRow = removed[offset];
      const newRow = added[offset];
      aligned.push({
        kind: oldRow && newRow ? 'changed' : oldRow ? 'removed' : 'added',
        oldLine: oldRow?.oldLine,
        newLine: newRow?.newLine,
        oldText: oldRow?.oldText ?? '',
        newText: newRow?.newText ?? '',
      });
    }
  }
  return aligned;
}

function coarseDiffRows(oldLines: string[], newLines: string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const count = Math.max(oldLines.length, newLines.length);
  for (let index = 0; index < count; index += 1) {
    const oldText = oldLines[index] ?? '';
    const newText = newLines[index] ?? '';
    rows.push({
      kind: oldText === newText ? 'equal' : oldText ? 'removed' : 'added',
      oldLine: index < oldLines.length ? index + 1 : undefined,
      newLine: index < newLines.length ? index + 1 : undefined,
      oldText,
      newText,
    });
  }
  return rows;
}

/**
 * Replaces every run of ≥ {@link EQUAL_FOLD_THRESHOLD} consecutive `equal` rows with a single
 * placeholder so a 200-line file with one edit does not render all 200 unchanged lines. Two
 * untouched lines are always shown around each placeholder so the reader can still see the edit
 * in context.
 */
export const EQUAL_FOLD_THRESHOLD = 3;

/**
 * Replaces every run of ≥ {@link EQUAL_FOLD_THRESHOLD} consecutive `equal` rows with a single
 * placeholder so a 200-line file with one edit does not render all 200 unchanged lines. Two
 * untouched lines are always shown around each placeholder so the reader can still see the edit
 * in context. `shouldExpand(placeholder)` lets the caller pass through a previously-collapsed
 * run (e.g. the user clicked "show N lines").
 */
export function withCollapsedEquals(
  rows: readonly DiffRow[],
  shouldExpand: (placeholder: CollapsedEqualRow) => boolean = () => false,
): DiffDisplayRow[] {
  const out: DiffDisplayRow[] = [];
  let index = 0;
  while (index < rows.length) {
    const start = index;
    while (index < rows.length && rows[index].kind === 'equal') {
      index += 1;
    }
    const equalRun = index - start;
    if (equalRun <= EQUAL_FOLD_THRESHOLD) {
      for (let i = start; i < index; i += 1) out.push(rows[i]);
      continue;
    }
    const visible = EQUAL_FOLD_THRESHOLD;
    const head = Math.min(visible, Math.floor(equalRun / 2));
    const tail = Math.min(visible, equalRun - head);
    for (let i = 0; i < head; i += 1) out.push(rows[start + i]);
    const collapsedRows = rows.slice(start + head, start + equalRun - tail);
    const firstOldLine = collapsedRows[0]?.oldLine;
    const firstNewLine = collapsedRows[0]?.newLine;
    const lastOldLine = collapsedRows.at(-1)?.oldLine;
    const lastNewLine = collapsedRows.at(-1)?.newLine;
    if (
      firstOldLine !== undefined &&
      firstNewLine !== undefined &&
      lastOldLine !== undefined &&
      lastNewLine !== undefined
    ) {
      const placeholder: CollapsedEqualRow = {
        kind: 'collapsed',
        count: collapsedRows.length,
        firstOldLine,
        firstNewLine,
        lastOldLine,
        lastNewLine,
      };
      if (shouldExpand(placeholder)) {
        for (const row of collapsedRows) out.push(row);
      } else {
        out.push(placeholder);
      }
    } else {
      for (const row of collapsedRows) out.push(row);
    }
    for (let i = equalRun - tail; i < equalRun; i += 1) out.push(rows[start + i]);
  }
  return out;
}
