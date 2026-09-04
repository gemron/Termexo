export interface RepositoryTarget {
  workspaceId: string;
  terminalId?: string;
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

const MAX_LCS_CELLS = 2_000_000;

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
