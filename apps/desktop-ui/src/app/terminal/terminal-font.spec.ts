import {
  DEFAULT_TERMINAL_FONT_NAME,
  filterTerminalFonts,
  isTerminalFontAvailable,
  normalizeTerminalFontName,
  SystemFont,
  TERMINAL_FONT_PRESETS,
  terminalFontFamily,
  usableTerminalFonts,
} from './terminal-font';

const INSTALLED: readonly SystemFont[] = [
  { name: 'Cascadia Mono', monospaced: true },
  { name: 'JetBrains Mono', monospaced: true },
  { name: 'Microsoft YaHei UI', monospaced: false },
  { name: '等线', monospaced: false },
];

describe('terminal font', () => {
  it('uses an explicitly monospaced font when no preference has been stored', () => {
    expect(normalizeTerminalFontName(undefined)).toBe(DEFAULT_TERMINAL_FONT_NAME);
    expect(terminalFontFamily(undefined)).toBe(
      '"Consolas", "Cascadia Mono", "JetBrains Mono", Consolas, "Lucida Console", "Microsoft YaHei UI", "Microsoft YaHei", monospace',
    );
  });

  it('distinguishes an installed font from the browser fallback', () => {
    const widths: Record<string, number> = {
      monospace: 100,
      serif: 110,
      'sans-serif': 120,
    };
    const canvas = {
      getContext: () => ({
        font: '',
        measureText(this: { font: string }) {
          const fallback = (this.font.split(', ').at(-1) ?? 'monospace').replace(/^72px /, '');
          return { width: this.font.includes('Installed Mono') ? 90 : widths[fallback] };
        },
      }),
    } as unknown as HTMLCanvasElement;

    expect(isTerminalFontAvailable('Installed Mono', () => canvas)).toBe(true);
    expect(isTerminalFontAvailable('Missing Mono', () => canvas)).toBe(false);
  });

  it('migrates the legacy proportional system font preference', () => {
    expect(normalizeTerminalFontName('system-ui')).toBe(DEFAULT_TERMINAL_FONT_NAME);
    expect(normalizeTerminalFontName('SYSTEM-UI')).toBe(DEFAULT_TERMINAL_FONT_NAME);
  });

  it('offers distinct programming and Chinese monospace presets', () => {
    expect(new Set(TERMINAL_FONT_PRESETS).size).toBe(TERMINAL_FONT_PRESETS.length);
    expect(TERMINAL_FONT_PRESETS).toContain('Fira Code');
    expect(TERMINAL_FONT_PRESETS).toContain('Maple Mono NF CN');
    expect(TERMINAL_FONT_PRESETS).toContain('Sarasa Mono SC');
    expect(TERMINAL_FONT_PRESETS).not.toContain('system-ui' as never);
  });

  it('keeps a custom installed font and adds the Windows Chinese fallback', () => {
    expect(normalizeTerminalFontName('  Cascadia Code  ')).toBe('Cascadia Code');
    expect(terminalFontFamily('Cascadia Code')).toBe(
      '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", Consolas, "Lucida Console", "Microsoft YaHei UI", "Microsoft YaHei", monospace',
    );
  });

  it('rejects CSS font stacks and control characters', () => {
    expect(normalizeTerminalFontName('Consolas, monospace')).toBe(DEFAULT_TERMINAL_FONT_NAME);
    expect(normalizeTerminalFontName('Bad\nFont')).toBe(DEFAULT_TERMINAL_FONT_NAME);
  });

  it('matches a search ignoring case and the spaces users leave out', () => {
    expect(filterTerminalFonts(INSTALLED, 'jetbrainsmono').map((font) => font.name)).toEqual([
      'JetBrains Mono',
    ]);
    expect(filterTerminalFonts(INSTALLED, 'MONO').map((font) => font.name)).toEqual([
      'Cascadia Mono',
      'JetBrains Mono',
    ]);
    // A substring anywhere in the family still matches, not just a prefix.
    expect(filterTerminalFonts(INSTALLED, 'yahei').map((font) => font.name)).toEqual([
      'Microsoft YaHei UI',
    ]);
    expect(filterTerminalFonts(INSTALLED, '等线').map((font) => font.name)).toEqual(['等线']);
  });

  it('returns every font for a blank search and none for an unmatched one', () => {
    expect(filterTerminalFonts(INSTALLED, '')).toEqual(INSTALLED);
    expect(filterTerminalFonts(INSTALLED, '   ')).toEqual(INSTALLED);
    expect(filterTerminalFonts(INSTALLED, 'nothing')).toEqual([]);
  });

  it('drops families that could not be applied as a font name', () => {
    const fonts: readonly SystemFont[] = [
      { name: 'Cascadia Mono', monospaced: true },
      { name: 'Bad, Font', monospaced: true },
      { name: 'x'.repeat(200), monospaced: true },
      { name: '  Padded  ', monospaced: true },
    ];

    expect(usableTerminalFonts(fonts).map((font) => font.name)).toEqual(['Cascadia Mono']);
  });
});
