import { normalizeWorkspaceThemeColor } from './workspace.models';

export interface AppThemePalette {
  accent: string;
  surface0: string;
  surface1: string;
  surface2: string;
  surfaceRaised: string;
  surfaceInset: string;
  sidebar: string;
  primarySoft: string;
}

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

function parseHex(color: string): RgbColor {
  const normalized = normalizeWorkspaceThemeColor(color).slice(1);
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function toHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0');
}

export function mixThemeColor(base: string, accent: string, accentRatio: number): string {
  const baseRgb = parseHex(base);
  const accentRgb = parseHex(accent);
  const ratio = Math.min(1, Math.max(0, accentRatio));
  return `#${toHex(baseRgb.red + (accentRgb.red - baseRgb.red) * ratio)}${toHex(
    baseRgb.green + (accentRgb.green - baseRgb.green) * ratio,
  )}${toHex(baseRgb.blue + (accentRgb.blue - baseRgb.blue) * ratio)}`;
}

export function createAppThemePalette(color: string | undefined): AppThemePalette {
  const accent = normalizeWorkspaceThemeColor(color);
  return {
    accent,
    surface0: mixThemeColor('#080b0a', accent, 0.08),
    surface1: mixThemeColor('#0d1210', accent, 0.11),
    surface2: mixThemeColor('#151b18', accent, 0.15),
    surfaceRaised: mixThemeColor('#111714', accent, 0.17),
    surfaceInset: mixThemeColor('#060908', accent, 0.06),
    sidebar: mixThemeColor('#0b100e', accent, 0.13),
    primarySoft: mixThemeColor('#121916', accent, 0.24),
  };
}
