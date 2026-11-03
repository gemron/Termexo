import { describe, expect, it } from 'vitest';
import {
  findPreviewMatches,
  MAX_PREVIEW_MATCHES,
  parsePreviewAddress,
  previewBreadcrumbs,
  previewOffset,
  previewMatchMarkup,
  relativePreviewPath,
} from './preview-navigation';

describe('preview paths and positions', () => {
  it('accepts quoted paths, Windows drive letters and copied line references', () => {
    expect(parsePreviewAddress('"D:/代码 project/main.ts:12:3"')).toEqual({
      path: 'D:/代码 project/main.ts',
      line: 12,
      column: 3,
    });
    expect(parsePreviewAddress('src/main.ts#L8C2')).toEqual({
      path: 'src/main.ts',
      line: 8,
      column: 2,
    });
    expect(parsePreviewAddress('D:\\src\\main.ts')).toEqual({
      path: 'D:\\src\\main.ts',
      line: 1,
      column: 1,
    });
  });

  it('keeps POSIX paths case sensitive and builds navigable breadcrumbs inside the root', () => {
    expect(relativePreviewPath('d:\\Project\\src\\main.ts', 'D:/project')).toBe('src/main.ts');
    expect(relativePreviewPath('/Project/src', '/project')).toBe('/Project/src');
    expect(previewBreadcrumbs('D:/project/apps/web', 'D:/project')).toEqual([
      { name: '项目根目录', path: 'D:/project' },
      { name: 'apps', path: 'D:/project/apps' },
      { name: 'web', path: 'D:/project/apps/web' },
    ]);
    expect(previewBreadcrumbs('/src', '/')).toEqual([
      { name: '项目根目录', path: '/' },
      { name: 'src', path: '/src' },
    ]);
  });

  it('clamps line and unicode column positions to source without splitting a surrogate pair', () => {
    const source = 'first\n😀中\nlast';
    expect(previewOffset(source, 2, 2)).toBe(8);
    expect(previewOffset(source, 2, 999)).toBe(9);
    expect(previewOffset(source, 999, 999)).toBe(source.length);
    expect(previewOffset(source, NaN)).toBe(0);
  });
});

describe('literal preview search', () => {
  it('escapes regex syntax, handles case and returns offsets usable by text selection', () => {
    expect(findPreviewMatches('a.b A.B aXb', 'a.b', false).matches).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
    expect(findPreviewMatches('a.b A.B', 'a.b', true).matches).toHaveLength(1);
    expect(findPreviewMatches('😀[中] 😀', '[中]', false).matches).toEqual([{ start: 2, end: 5 }]);
    expect(findPreviewMatches('text', '', false).matches).toHaveLength(0);
    expect(previewMatchMarkup('<img>', { start: 0, end: 5 })).toBe('<mark>&lt;img&gt;</mark>');
  });

  it('bounds match storage for large or minified files and reports truncation', () => {
    const result = findPreviewMatches('a'.repeat(MAX_PREVIEW_MATCHES + 1), 'a', false);
    expect(result.matches).toHaveLength(MAX_PREVIEW_MATCHES);
    expect(result.truncated).toBe(true);
  });
});
