import type { ITheme } from '@xterm/xterm';

import { createAppThemePalette, mixThemeColor } from '../core/models/theme-palette';

export function createTerminalTheme(color: string | undefined): ITheme {
  const palette = createAppThemePalette(color);
  const background = mixThemeColor('#070a09', palette.accent, 0.075);

  return {
    background,
    foreground: mixThemeColor('#d5dcda', palette.accent, 0.055),
    cursor: palette.accent,
    cursorAccent: background,
    selectionBackground: mixThemeColor(background, palette.accent, 0.34),
    selectionInactiveBackground: mixThemeColor(background, palette.accent, 0.22),
    black: mixThemeColor('#111513', palette.accent, 0.08),
    red: '#e06c75',
    green: mixThemeColor('#70bd91', palette.accent, 0.18),
    yellow: '#d6a34a',
    blue: mixThemeColor('#68a9e8', palette.accent, 0.12),
    magenta: '#b494d6',
    cyan: mixThemeColor('#61b8b5', palette.accent, 0.2),
    white: mixThemeColor('#d8dcd9', palette.accent, 0.04),
    brightBlack: mixThemeColor('#656b68', palette.accent, 0.1),
  };
}
