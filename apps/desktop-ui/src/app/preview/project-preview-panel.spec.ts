import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPreviewPanelComponent } from './project-preview-panel';
import {
  codePosition,
  codeReference,
  previewUrl,
  type ProjectDirectory,
  ProjectPreviewService,
} from '../core/services/project-preview.service';
import { renderMarkdown } from './markdown-preview';

const content = 'first line\n第二行 😀 text\nthird';
const path = 'D:/代码 project/src/main.ts';

describe('read-only project preview and code references', () => {
  const preview = {
    file: signal({ path, content, kind: 'text', mime: 'text/plain' }),
    location: signal({ line: 2, column: 1 }),
    url: signal(''),
    error: signal(''),
    failedPath: signal(''),
    loading: signal(false),
    directory: signal<ProjectDirectory | null>(null),
    listing: signal(false),
    workspaceId: signal('w'),
    root: () => 'D:/代码 project',
    close: vi.fn(),
    browse: vi.fn(),
    openFile: vi.fn(),
    external: vi.fn(),
  };
  const clipboardWrite = vi.fn().mockResolvedValue(undefined);
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.restoreAllMocks();
    preview.file.set({ path, content, kind: 'text', mime: 'text/plain' });
    preview.location.set({ line: 2, column: 1 });
    preview.error.set('');
    preview.failedPath.set('');
    preview.directory.set(null);
    preview.url.set('');
    preview.browse.mockReset();
    preview.openFile.mockReset();
    vi.stubGlobal('navigator', {
      userAgent: 'Test browser',
      clipboard: { writeText: clipboardWrite },
    });
    TestBed.configureTestingModule({
      providers: [{ provide: ProjectPreviewService, useValue: preview }],
    });
  });

  it('shows read-only selectable source and copies true path, selected range, and code without gutter text', async () => {
    const fixture = TestBed.createComponent(ProjectPreviewPanelComponent);
    fixture.detectChanges();
    const code = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    expect(code.readOnly).toBe(true);
    expect(code.value).toBe(content);
    const buttons = () =>
      Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const click = async (label: string) => {
      buttons()
        .find((button) => button.textContent?.trim() === label)!
        .click();
      await fixture.whenStable();
    };
    await click('复制路径');
    expect(clipboardWrite).toHaveBeenLastCalledWith(path);
    code.setSelectionRange(11, content.length);
    code.dispatchEvent(new Event('select'));
    fixture.detectChanges();
    await click('复制位置');
    expect(clipboardWrite).toHaveBeenLastCalledWith(`${path}:2:1-3:6`);
    await click('复制代码及位置');
    expect(clipboardWrite).toHaveBeenLastCalledWith(`${path}:2:1-3:6\n第二行 😀 text\nthird`);
    await click('复制全部代码');
    expect(clipboardWrite).toHaveBeenLastCalledWith(content);
    code.setSelectionRange(13, 13);
    code.dispatchEvent(new Event('select'));
    fixture.detectChanges();
    await click('复制位置');
    expect(clipboardWrite).toHaveBeenLastCalledWith(`${path}:2:3`);
    await click('复制代码及位置');
    expect(clipboardWrite).toHaveBeenLastCalledWith(`${path}:2:1-2:11\n第二行 😀 text`);
  });

  it('quotes the first empty line at its real location without a selection', async () => {
    preview.file.set({ path, content: '\nnext', kind: 'text', mime: 'text/plain' });
    preview.location.set({ line: 1, column: 1 });
    const fixture = TestBed.createComponent(ProjectPreviewPanelComponent);
    fixture.detectChanges();
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    buttons.find((button) => button.textContent?.trim() === '复制代码及位置')!.click();
    await fixture.whenStable();
    expect(clipboardWrite).toHaveBeenLastCalledWith(`${path}:1:1\n`);
  });

  it('offers source references only after switching Markdown to selectable source', async () => {
    preview.file.set({ path, content: '# 文档\n正文', kind: 'markdown', mime: 'text/markdown' });
    const fixture = TestBed.createComponent(ProjectPreviewPanelComponent);
    fixture.detectChanges();
    const buttons = () =>
      [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    expect(buttons().some((b) => b.textContent?.trim() === '复制位置')).toBe(false);
    expect(buttons().some((b) => b.textContent?.trim() === '复制全部源文')).toBe(true);
    buttons()
      .find((b) => b.textContent?.trim() === '查看源文')!
      .click();
    fixture.detectChanges();
    expect(buttons().some((b) => b.textContent?.trim() === '复制位置')).toBe(true);
    expect(fixture.nativeElement.querySelector('textarea').readOnly).toBe(true);
  });

  it('shows a failed file open once rather than duplicating the service error as status text', async () => {
    preview.openFile.mockImplementationOnce(async () => {
      preview.error.set('文件不存在。');
      throw '文件不存在。';
    });
    const fixture = TestBed.createComponent(ProjectPreviewPanelComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('.address input') as HTMLInputElement;
    input.value = 'missing.ts';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[role="alert"]').length).toBe(1);
    expect(fixture.nativeElement.textContent.match(/文件不存在。/g)?.length).toBe(1);
  });

  it('keeps files available after opening and reopens the same directory after collapsing', async () => {
    const directory = 'D:/project/src';
    const first = `${directory}/first.ts`;
    const second = `${directory}/second.ts`;
    preview.directory.set({
      path: directory,
      entries: [
        { name: 'first.ts', path: first, directory: false },
        { name: 'second.ts', path: second, directory: false },
      ],
      truncated: false,
    });
    preview.openFile.mockImplementation(async (_workspaceId: string, nextPath: string) => {
      preview.file.set({ path: nextPath, content: nextPath, kind: 'text', mime: 'text/plain' });
    });
    const fixture = TestBed.createComponent(ProjectPreviewPanelComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const entries = () =>
      [...fixture.nativeElement.querySelectorAll('.file-entry')] as HTMLButtonElement[];

    expect(entries()).toHaveLength(2);
    entries()[0].click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(preview.file().path).toBe(first);
    expect(entries()).toHaveLength(2);
    entries()[1].click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(preview.file().path).toBe(second);
    expect(entries()).toHaveLength(2);

    const toggle = fixture.nativeElement.querySelector('[data-testid="preview-file-browser-toggle"]') as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    expect(entries()).toHaveLength(0);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(preview.browse).toHaveBeenLastCalledWith('w', directory);
    expect(entries()).toHaveLength(2);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('counts unicode columns and clamps positions to real source', () => {
    expect(codePosition('a\n😀b', 4)).toEqual({ line: 2, column: 2 });
    expect(codePosition('a', 999)).toEqual({ line: 1, column: 2 });
    expect(codeReference(path, content, 0, 0)).toBe(`${path}:1:1`);
  });

  it('highlights code while keeping indentation, blank lines, trailing spaces and copy text unchanged', async () => {
    const original = 'const message = "<img src=x onerror=alert(1)>";  \n\n\tif (true) {\n    console.log(message);\n}\n';
    preview.file.set({ path, content: original, kind: 'text', mime: 'text/plain' });
    const fixture = TestBed.createComponent(ProjectPreviewPanelComponent);
    fixture.detectChanges();
    const tokens = fixture.nativeElement.querySelector('.syntax-layer code') as HTMLElement;
    const code = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    expect(tokens.querySelector('.hljs-keyword')?.textContent).toBe('const');
    expect(tokens.querySelector('.hljs-string')).not.toBeNull();
    expect(tokens.textContent).toBe(original);
    expect(tokens.querySelector('img')).toBeNull();
    expect(code.value).toBe(original);
    const copy = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) => button.textContent?.trim() === '复制全部代码',
    ) as HTMLButtonElement;
    copy.click();
    await fixture.whenStable();
    expect(clipboardWrite).toHaveBeenLastCalledWith(original);

    code.scrollTop = 40;
    code.scrollLeft = 65;
    code.dispatchEvent(new Event('scroll'));
    expect(tokens.style.transform).toBe('translate(-65px, -40px)');
    expect(fixture.nativeElement.querySelector('.gutter').scrollTop).toBe(40);
  });

  it('only embeds HTTP(S), rejecting executable schemes and embedded credentials', () => {
    expect(previewUrl('http://localhost:4200')).toBe('http://localhost:4200/');
    for (const value of [
      'javascript:alert(1)',
      'file:///D:/x',
      'data:text/html,x',
      'https://user:pass@example.com',
    ])
      expect(() => previewUrl(value)).toThrow();
  });

  it('renders Markdown without raw HTML or executable links', () => {
    const html = renderMarkdown(
      '# Heading\n**bold** and `code`\n<script>alert(1)</script>\n[x](javascript:alert)\n```js\n<tag>\n```',
    );
    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('&lt;tag&gt;');
  });
});
