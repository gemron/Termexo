export const DEFAULT_TERMINAL_FONT_NAME = 'Consolas';
export const MAX_TERMINAL_FONT_NAME_LENGTH = 100;

export const TERMINAL_FONT_PRESETS = [
  'Cascadia Code',
  'Cascadia Mono',
  'JetBrains Mono',
  'Fira Code',
  'Source Code Pro',
  'IBM Plex Mono',
  'Roboto Mono',
  'Ubuntu Mono',
  'Hack',
  'Iosevka',
  'MesloLGS NF',
  'CaskaydiaCove Nerd Font',
  'FiraCode Nerd Font',
  'Maple Mono NF CN',
  'Sarasa Mono SC',
  'Noto Sans Mono CJK SC',
  'LXGW WenKai Mono',
  DEFAULT_TERMINAL_FONT_NAME,
  'Lucida Console',
  'Lucida Sans Typewriter',
  'MS Gothic',
  'NSimSun',
  'DejaVu Sans Mono',
  'Liberation Mono',
  'Cousine',
  'Menlo',
  'Monaco',
  'Courier New',
] as const;

const LEGACY_PROPORTIONAL_FONT_NAME = 'system-ui';
const WINDOWS_TERMINAL_FALLBACK =
  '"Cascadia Mono", "JetBrains Mono", Consolas, "Lucida Console", "Microsoft YaHei UI", "Microsoft YaHei", monospace';

const FONT_DETECTION_SAMPLE = 'mmmmmmmmmmlliWW00@#中文';
const FONT_DETECTION_SIZE = '72px';
const GENERIC_FONT_FAMILIES = ['monospace', 'serif', 'sans-serif'] as const;

/** Accepts one installed font name and rejects values that could alter the CSS font stack. */
export function normalizeTerminalFontName(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (
    !normalized ||
    normalized.toLowerCase() === LEGACY_PROPORTIONAL_FONT_NAME ||
    normalized.length > MAX_TERMINAL_FONT_NAME_LENGTH ||
    /[\u0000-\u001f\u007f",;]/.test(normalized)
  ) {
    return DEFAULT_TERMINAL_FONT_NAME;
  }
  return normalized;
}

/** Builds xterm's CSS font stack while keeping Windows' system Chinese font as the fallback. */
export function terminalFontFamily(fontName: string | null | undefined): string {
  const normalized = normalizeTerminalFontName(fontName);
  return `"${normalized}", ${WINDOWS_TERMINAL_FALLBACK}`;
}

/** Detects a locally installed font without mistaking the browser's fallback font for a match. */
export function isTerminalFontAvailable(
  fontName: string,
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): boolean {
  const normalized = normalizeTerminalFontName(fontName);
  const context = createCanvas().getContext('2d');
  if (!context) {
    return normalized === DEFAULT_TERMINAL_FONT_NAME;
  }

  const measure = (family: string): number => {
    context.font = `${FONT_DETECTION_SIZE} ${family}`;
    return context.measureText(FONT_DETECTION_SAMPLE).width;
  };
  return GENERIC_FONT_FAMILIES.some(
    (fallback) => measure(`"${normalized}", ${fallback}`) !== measure(fallback),
  );
}

/** An installed family the terminal can be pointed at, as reported by the Rust font enumerator. */
export interface SystemFont {
  readonly name: string;
  /** Monospaced families are the ones a terminal renders without column drift. */
  readonly monospaced: boolean;
}

/**
 * Presets the browser preview falls back to.
 *
 * Enumerating installed fonts needs the desktop shell, so the preview probes the curated list
 * instead. Every preset is a monospaced family.
 */
export function detectTerminalFontPresets(): readonly SystemFont[] {
  const available = TERMINAL_FONT_PRESETS.filter((font) => isTerminalFontAvailable(font));
  const names = available.length > 0 ? available : [DEFAULT_TERMINAL_FONT_NAME];
  return names.map((name) => ({ name, monospaced: true }));
}

/** Keeps only the families that survive `normalizeTerminalFontName` unchanged. */
export function usableTerminalFonts(fonts: readonly SystemFont[]): readonly SystemFont[] {
  return fonts.filter((font) => normalizeTerminalFontName(font.name) === font.name);
}

/** Folds case and spacing so "jetbrainsmono" still finds "JetBrains Mono". */
function foldFontName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

/** Filters by substring so a partial name typed anywhere in the family still matches. */
export function filterTerminalFonts(
  fonts: readonly SystemFont[],
  query: string,
): readonly SystemFont[] {
  const folded = foldFontName(query);
  if (!folded) {
    return fonts;
  }
  return fonts.filter((font) => foldFontName(font.name).includes(folded));
}
