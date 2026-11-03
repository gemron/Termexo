export interface PreviewMatch {
  start: number;
  end: number;
}
export const MAX_PREVIEW_MATCHES = 1000;
export const CODE_LINE_HEIGHT = 20;

export function previewMatchMarkup(content: string, match?: PreviewMatch): string {
  const escape = (text: string) =>
    text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  if (!match) return '';
  return (
    escape(content.slice(0, match.start)) +
    '<mark>' +
    escape(content.slice(match.start, match.end)) +
    '</mark>' +
    escape(content.slice(match.end))
  );
}

export function previewFilename(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? path;
}

function normalizedPath(path: string): string {
  const value = path.replaceAll('\\', '/').replace(/\/+$/, '') || '/';
  return /^(?:[a-z]:[\\/]|\\\\)/i.test(path) ? value.toLowerCase() : value;
}

export function relativePreviewPath(path: string, root: string): string {
  const directory = normalizedPath(root);
  const prefix = directory.endsWith('/') ? directory : directory + '/';
  if (normalizedPath(path) === directory) return '项目根目录';
  return normalizedPath(path).startsWith(prefix)
    ? path.replaceAll('\\', '/').slice(prefix.length)
    : path;
}

export function previewBreadcrumbs(path: string, root: string): { name: string; path: string }[] {
  const result = [{ name: '项目根目录', path: root }];
  const relative = relativePreviewPath(path, root);
  if (relative === '项目根目录' || relative === path) return result;
  let current = root.replace(/[\\/]+$/, '');
  for (const name of relative.split('/').filter(Boolean)) {
    current += '/' + name;
    result.push({ name, path: current });
  }
  return result;
}

export function parsePreviewAddress(value: string): { path: string; line: number; column: number } {
  const path = value.trim().replace(/^(["'])(.*)\1$/, '$2');
  const match = /^(.+?)(?::([1-9]\d*)(?::([1-9]\d*))?|#L([1-9]\d*)(?:C([1-9]\d*))?)$/.exec(path);
  return match
    ? {
        path: match[1],
        line: Number(match[2] || match[4]),
        column: Number(match[3] || match[5] || 1),
      }
    : { path, line: 1, column: 1 };
}

export function previewOffset(content: string, line: number, column = 1): number {
  const lines = content.split('\n');
  const index =
    Math.min(lines.length, Math.max(1, Number.isFinite(line) ? Math.trunc(line) : 1)) - 1;
  const prefix = lines.slice(0, index).reduce((total, text) => total + text.length + 1, 0);
  return (
    prefix +
    Array.from(lines[index])
      .slice(0, Math.max(0, column - 1))
      .join('').length
  );
}

export function findPreviewMatches(
  content: string,
  query: string,
  matchCase: boolean,
): { matches: PreviewMatch[]; truncated: boolean } {
  if (!query) return { matches: [], truncated: false };
  const pattern = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    matchCase ? 'gu' : 'giu',
  );
  const matches: PreviewMatch[] = [];
  for (const match of content.matchAll(pattern)) {
    if (matches.length === MAX_PREVIEW_MATCHES) return { matches, truncated: true };
    matches.push({ start: match.index, end: match.index + match[0].length });
  }
  return { matches, truncated: false };
}
