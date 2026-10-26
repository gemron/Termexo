import { describe, expect, it } from 'vitest';
import { highlightCode } from './code-highlight';

describe('code highlighting', () => {
  it.each([
    ['main.ts', 'const value: number = 42;'],
    ['MAIN.PY', 'def greeting():\n\treturn "hello"\n'],
    ['main.rs', 'fn main() { let value = 42; }'],
    ['config.json', '{\n  "enabled": true\n}'],
    ['index.html', '<main class="content">text</main>'],
    ['setup.ps1', '$value = "hello"\nWrite-Output $value'],
  ])('adds tokens without changing the text of %s', (path, content) => {
    const html = highlightCode(path, content);
    expect(html).toContain('class="hljs-');
    const element = document.createElement('pre');
    element.innerHTML = html;
    expect(element.textContent).toBe(content);
  });

  it('escapes unknown text formats and falls back for very large files', () => {
    const raw = '<script>alert("x")</script> &  text\n\t';
    for (const [path, content] of [['file.txt', raw], ['large.ts', raw.repeat(10_000)]]) {
      const html = highlightCode(path, content);
      expect(html).not.toContain('<script>');
      const element = document.createElement('pre');
      element.innerHTML = html;
      expect(element.textContent).toBe(content);
    }
  });
});
