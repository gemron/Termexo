export type PromptAssetKind = 'draft' | 'history';

export interface PromptAsset {
  id: string;
  workspaceId: string;
  terminalId?: string;
  terminalName: string;
  agentType: 'claude' | 'codex';
  kind: PromptAssetKind;
  content: string;
  redacted: boolean;
  favorite: boolean;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PromptCaptureResult {
  draft: string;
  submitted: string[];
  changed: boolean;
}

const BRACKETED_PASTE_START = '\u001b[200~';
const BRACKETED_PASTE_END = '\u001b[201~';
const MAX_PROMPT_LENGTH = 256 * 1024;

/**
 * Mirrors the common readline controls used by Claude Code and Codex without touching the PTY.
 * The capture is deliberately independent per terminal, so output in another xterm cannot move
 * or overwrite the draft currently being composed.
 */
export class TerminalPromptCapture {
  private characters: string[] = [];
  private cursor = 0;
  private bracketedPaste = false;

  get draft(): string {
    return this.characters.join('');
  }

  restore(value: string): void {
    this.characters = Array.from(value).slice(0, MAX_PROMPT_LENGTH);
    this.cursor = this.characters.length;
  }

  consume(data: string): PromptCaptureResult {
    const before = this.draft;
    const submitted: string[] = [];
    let index = 0;

    while (index < data.length) {
      if (data.startsWith(BRACKETED_PASTE_START, index)) {
        this.bracketedPaste = true;
        index += BRACKETED_PASTE_START.length;
        continue;
      }
      if (data.startsWith(BRACKETED_PASTE_END, index)) {
        this.bracketedPaste = false;
        index += BRACKETED_PASTE_END.length;
        continue;
      }

      const codePoint = data.codePointAt(index);
      if (codePoint === undefined) {
        break;
      }
      const character = String.fromCodePoint(codePoint);
      index += character.length;

      if (this.bracketedPaste) {
        this.insert(character);
        continue;
      }

      if (character === '\r' || character === '\n') {
        const prompt = this.draft.trim();
        if (prompt) {
          submitted.push(prompt);
        }
        this.characters = [];
        this.cursor = 0;
        continue;
      }
      if (character === '\u0003') {
        this.characters = [];
        this.cursor = 0;
        continue;
      }
      if (character === '\u0001') {
        this.cursor = 0;
        continue;
      }
      if (character === '\u0005') {
        this.cursor = this.characters.length;
        continue;
      }
      if (character === '\u000b') {
        this.characters.splice(this.cursor);
        continue;
      }
      if (character === '\u0015') {
        this.characters.splice(0, this.cursor);
        this.cursor = 0;
        continue;
      }
      if (character === '\u0017') {
        this.deletePreviousWord();
        continue;
      }
      if (character === '\b' || character === '\u007f') {
        if (this.cursor > 0) {
          this.characters.splice(--this.cursor, 1);
        }
        continue;
      }
      if (character === '\u001b') {
        index = this.consumeEscapeSequence(data, index);
        continue;
      }
      if (codePoint >= 0x20 && codePoint !== 0x7f) {
        this.insert(character);
      }
    }

    return { draft: this.draft, submitted, changed: before !== this.draft || submitted.length > 0 };
  }

  private insert(value: string): void {
    if (this.characters.length >= MAX_PROMPT_LENGTH) {
      return;
    }
    this.characters.splice(this.cursor, 0, value);
    this.cursor += 1;
  }

  private consumeEscapeSequence(data: string, start: number): number {
    if (data[start] !== '[') {
      return Math.min(data.length, start + 1);
    }
    let end = start + 1;
    while (end < data.length && !/[A-Za-z~]/.test(data[end])) {
      end += 1;
    }
    if (end >= data.length) {
      return data.length;
    }

    const sequence = data.slice(start, end + 1);
    switch (sequence) {
      case '[D':
        this.cursor = Math.max(0, this.cursor - 1);
        break;
      case '[C':
        this.cursor = Math.min(this.characters.length, this.cursor + 1);
        break;
      case '[H':
      case '[1~':
        this.cursor = 0;
        break;
      case '[F':
      case '[4~':
        this.cursor = this.characters.length;
        break;
      case '[3~':
        if (this.cursor < this.characters.length) {
          this.characters.splice(this.cursor, 1);
        }
        break;
    }
    return end + 1;
  }

  private deletePreviousWord(): void {
    while (this.cursor > 0 && /\s/.test(this.characters[this.cursor - 1])) {
      this.characters.splice(--this.cursor, 1);
    }
    while (this.cursor > 0 && !/\s/.test(this.characters[this.cursor - 1])) {
      this.characters.splice(--this.cursor, 1);
    }
  }
}

export interface RedactionResult {
  content: string;
  redactions: number;
}

/** Removes common credentials before a draft, history item, or handoff package is persisted. */
export function redactSensitiveContent(value: string): RedactionResult {
  let redactions = 0;
  const replace = (
    pattern: RegExp,
    replacement: string | ((...args: string[]) => string),
  ): void => {
    value = value.replace(pattern, (...args: string[]) => {
      redactions += 1;
      return typeof replacement === 'string' ? replacement : replacement(...args);
    });
  };

  replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED]');
  replace(/\b(?:sk|gh[opusr]|xox[baprs])-?[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]');
  replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]');
  replace(
    /\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\b(\s*[:=]\s*)(["']?)(?!\[REDACTED\])[^\s,"']{6,}\3/gi,
    (_match, label, separator) => `${label}${separator}[REDACTED]`,
  );

  return { content: value, redactions };
}

export function promptAssetMatches(asset: PromptAsset, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  return (
    !normalized ||
    asset.content.toLocaleLowerCase().includes(normalized) ||
    asset.terminalName.toLocaleLowerCase().includes(normalized) ||
    asset.agentType.includes(normalized)
  );
}
