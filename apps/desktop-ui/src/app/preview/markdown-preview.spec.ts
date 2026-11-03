import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown-preview';

describe('Markdown document reading', () => {
  it('groups real ordered and unordered lists, preserves headings and renders tables', () => {
    const html = renderMarkdown(
      '# 说明\n# 说明\n- 一\n- 二\n\n1. 安装\n2. 启动\n\n| 名称 | 状态 |\n| --- | ---: |\n| 开发 | 完成 |',
    );
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.querySelectorAll('h1')).toHaveLength(2);
    expect(document.querySelectorAll('ul')).toHaveLength(1);
    expect(document.querySelectorAll('ol > li')).toHaveLength(2);
    expect(document.querySelectorAll('th')).toHaveLength(2);
    expect(document.querySelector('td.align-right')?.textContent).toBe('完成');
  });

  it('keeps different fence characters inside code and never enables executable links or raw HTML', () => {
    const html = renderMarkdown(
      '```js\n~~~\n<script>alert(1)</script>\n```\n[本地](文档/说明.md)\n[服务](http://localhost:3000)\n[目录](#说明)\n[坏链接](vbscript:evil)\n[坏链接](//example.com)',
    );
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.querySelector('pre code')?.textContent).toContain('~~~\n<script>');
    expect(document.querySelector('script')).toBeNull();
    expect([...document.querySelectorAll('a')].map((item) => item.getAttribute('href'))).toEqual([
      '文档/说明.md',
      'http://localhost:3000',
      '#说明',
    ]);
  });
});
