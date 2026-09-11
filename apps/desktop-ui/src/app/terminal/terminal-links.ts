/**
 * Finds the addresses and file paths in a line of terminal output.
 *
 * An agent spends most of its output naming things the user then wants to look at — a file it
 * changed, a test that failed at a line, a page it is quoting. Copying those out by hand is the
 * friction this removes.
 *
 * Detection is deliberately generous and never touches the disk: a match only becomes an action
 * when the user holds Ctrl and clicks, and the backend is what decides whether the path exists.
 * A word that merely looks like a path therefore costs nothing.
 */

/** What the match names, which decides how it is opened. */
export type TerminalLinkKind = 'url' | 'path';

export interface TerminalLink {
  readonly kind: TerminalLinkKind;
  /** What to open: the address, or the path with any `:line:column` suffix removed. */
  readonly text: string;
  /** Half-open range of the whole match in the line, the suffix included. */
  readonly start: number;
  readonly end: number;
}

/** Only the two schemes a browser should be handed; anything else is left as plain text. */
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

/** A drive-letter path in quotes, which is the only form that may contain spaces. */
const QUOTED_ABSOLUTE_PATH_PATTERN = /"([A-Za-z]:[\\/][^"\r\n]+)"/g;

/** Characters Windows forbids in a path, plus `:`, which only the drive and the suffix may use. */
const PATH_BODY = String.raw`[^\s<>"'|?*:]`;

/**
 * A drive-letter path, guarded against the scheme of an address it is no part of.
 *
 * The letter may not follow another, or `file:///D:/x` would read its own `e://` as a drive, and
 * the separator may not be doubled, which is what an authority looks like and a path never does.
 */
const ABSOLUTE_PATH_PATTERN = new RegExp(
  String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\/](?![\\/])${PATH_BODY}*(?::\d+){0,2}`,
  'g',
);

/**
 * A path relative to the terminal's working directory, which needs a separator to be one at all.
 *
 * Without that requirement every bare word in a sentence would underline. `and/or` still matches,
 * and is meant to: refusing it would need a dictionary, while opening it simply reports that no
 * such file exists.
 */
const RELATIVE_PATH_PATTERN = new RegExp(
  String.raw`(?:\.{1,2}[\\/])?[\w.@~+-]+(?:[\\/][\w.@~+-]+)+(?::\d+){0,2}`,
  'g',
);

/** Trailing characters that end a sentence rather than an address. */
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/;

/** The `:12` or `:12:7` a compiler or test runner appends to a path. */
const LINE_SUFFIX = /(?::\d+){1,2}$/;

/**
 * The links in one line, ordered by position and never overlapping.
 *
 * Earlier patterns win the characters they cover, so an address is not also read as the relative
 * path its host and port resemble.
 */
export function detectTerminalLinks(line: string): TerminalLink[] {
  const links: TerminalLink[] = [];
  const claim = (start: number, end: number): boolean =>
    !links.some((link) => start < link.end && end > link.start);

  for (const match of line.matchAll(URL_PATTERN)) {
    const start = match.index;
    const text = trimTrailingPunctuation(match[0]);
    if (text && claim(start, start + text.length)) {
      links.push({ kind: 'url', text, start, end: start + text.length });
    }
  }

  for (const match of line.matchAll(QUOTED_ABSOLUTE_PATH_PATTERN)) {
    // The quotes delimit the path rather than belong to it, so the range covers them and the
    // text does not.
    addPath(links, claim, match.index, match[0].length, match[1]);
  }

  for (const pattern of [ABSOLUTE_PATH_PATTERN, RELATIVE_PATH_PATTERN]) {
    for (const match of line.matchAll(pattern)) {
      const matched = trimTrailingPunctuation(match[0]);
      if (matched) {
        addPath(links, claim, match.index, matched.length, matched);
      }
    }
  }

  return links.sort((left, right) => left.start - right.start);
}

function addPath(
  links: TerminalLink[],
  claim: (start: number, end: number) => boolean,
  start: number,
  length: number,
  matched: string,
): void {
  const end = start + length;
  if (!claim(start, end)) {
    return;
  }
  const text = matched.replace(LINE_SUFFIX, '');
  if (text) {
    links.push({ kind: 'path', text, start, end });
  }
}

/**
 * Drops the punctuation that ended the sentence rather than the address.
 *
 * A closing bracket is kept when the match opened one, so a path inside parentheses loses the
 * bracket while `run(a/b)` keeps what belongs to it.
 */
function trimTrailingPunctuation(value: string): string {
  let trimmed = value.replace(TRAILING_PUNCTUATION, '');
  for (const [open, close] of [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ]) {
    while (trimmed.endsWith(close) && !trimmed.includes(open)) {
      trimmed = trimmed.slice(0, -1).replace(TRAILING_PUNCTUATION, '');
    }
  }
  return trimmed;
}

/** One cell as the buffer holds it: the characters in it, and the columns it spans. */
export interface TerminalCell {
  /** Empty for a cell nothing was written to, and for the second half of a wide one. */
  readonly chars: string;
  /** 2 for a full-width character, 0 for the column it spills into, 1 otherwise. */
  readonly width: number;
}

/** A row of the buffer, numbered the way a buffer position is: from one. */
export interface TerminalRow {
  readonly row: number;
  readonly cells: readonly TerminalCell[];
}

/** A logical line as text, with the buffer position every character of it came from. */
export interface TerminalLineText {
  readonly text: string;
  /** One entry per character of `text`, holding the 1-based column and row it sits at. */
  readonly positions: readonly { readonly x: number; readonly y: number }[];
}

/**
 * Joins the rows of a wrapped line into the text the agent wrote, remembering where each
 * character came from.
 *
 * Offsets cannot be turned back into columns by arithmetic. A full-width character — every CJK
 * one — is a single character occupying two columns, so counting characters puts a match one
 * column to the left for each that preceded it, which is exactly how far a Chinese line drifts.
 * Recording the position while reading is the only mapping that survives them.
 */
export function readLogicalLine(rows: readonly TerminalRow[]): TerminalLineText {
  let text = '';
  const positions: { x: number; y: number }[] = [];
  for (const { row, cells } of rows) {
    let column = 1;
    for (const cell of cells) {
      if (cell.width === 0) {
        // The second column of a full-width character, which carries no characters of its own.
        continue;
      }
      // A cell nothing was written to reads as the blank it draws, so words stay separated.
      const chars = cell.chars === '' ? ' ' : cell.chars;
      for (let index = 0; index < chars.length; index += 1) {
        positions.push({ x: column, y: row });
      }
      text += chars;
      column += cell.width;
    }
  }
  return { text, positions };
}
