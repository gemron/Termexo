import { describe, expect, it } from 'vitest';

import { detectTerminalLinks, readLogicalLine, TerminalCell } from './terminal-links';

describe('detectTerminalLinks', () => {
  it('finds an address and hands over exactly what it covers', () => {
    const [link] = detectTerminalLinks('See https://termexo.com/guide for details');

    expect(link).toEqual({
      kind: 'url',
      text: 'https://termexo.com/guide',
      start: 4,
      end: 29,
    });
  });

  it('leaves the punctuation that ended the sentence out of the address', () => {
    expect(detectTerminalLinks('Docs at https://termexo.com/guide.')[0].text).toBe(
      'https://termexo.com/guide',
    );
    expect(detectTerminalLinks('(see https://termexo.com/guide)')[0].text).toBe(
      'https://termexo.com/guide',
    );
  });

  it('ignores a scheme a browser should not be handed', () => {
    expect(detectTerminalLinks('javascript:alert(1)')).toEqual([]);
    expect(detectTerminalLinks('mailto:someone@example.com')).toEqual([]);
  });

  it('reads the path inside a file address rather than following the scheme', () => {
    // Nothing is handed to a browser, but the drive path it wraps is still a path, and opening
    // it goes through the same rules as any other.
    const [link] = detectTerminalLinks('file:///D:/secret.txt');

    expect(link.kind).toBe('path');
    expect(link.text).toBe('D:/secret.txt');
  });

  it('finds a drive-letter path', () => {
    const [link] = detectTerminalLinks('wrote D:\\devlop\\Termexo\\src\\main.rs');

    expect(link.kind).toBe('path');
    expect(link.text).toBe('D:\\devlop\\Termexo\\src\\main.rs');
  });

  it('takes a quoted path whole, which is the only way one may hold spaces', () => {
    const [link] = detectTerminalLinks('opening "C:\\Program Files\\app\\readme.md" now');

    expect(link.text).toBe('C:\\Program Files\\app\\readme.md');
    // The quotes delimit the path rather than belong to it, so the range still covers them.
    expect(link.start).toBe(8);
    expect(link.end).toBe(40);
  });

  it('finds a path relative to the working directory', () => {
    expect(detectTerminalLinks('edited src/app/main.ts')[0]).toEqual({
      kind: 'path',
      text: 'src/app/main.ts',
      start: 7,
      end: 22,
    });
    expect(detectTerminalLinks('see ./docs/readme.md')[0].text).toBe('./docs/readme.md');
  });

  it('opens the file a compiler blamed, without its line and column', () => {
    const [withLine] = detectTerminalLinks('error at src/main.rs:42');
    expect(withLine.text).toBe('src/main.rs');
    // The range still covers the suffix, so the whole reference underlines as one.
    expect(withLine.end).toBe(23);

    expect(detectTerminalLinks('error at src/main.rs:42:8')[0].text).toBe('src/main.rs');
    expect(detectTerminalLinks('D:\\repo\\src\\main.rs:9')[0].text).toBe('D:\\repo\\src\\main.rs');
  });

  it('refuses a bare word, which without a separator names no path', () => {
    expect(detectTerminalLinks('running tests now')).toEqual([]);
    expect(detectTerminalLinks('README')).toEqual([]);
  });

  it('does not read an address as the relative path its host resembles', () => {
    const links = detectTerminalLinks('https://termexo.com/guide/index.html');

    expect(links).toHaveLength(1);
    expect(links[0].kind).toBe('url');
  });

  it('reports several links in the order they appear', () => {
    const links = detectTerminalLinks('src/a.ts and https://termexo.com then D:\\b\\c.txt');

    expect(links.map((link) => link.text)).toEqual([
      'src/a.ts',
      'https://termexo.com',
      'D:\\b\\c.txt',
    ]);
  });
});

/** Turns plain text into cells, giving every CJK character the two columns it draws in. */
function cells(text: string): TerminalCell[] {
  return [...text].flatMap((char) =>
    /[一-鿿　-〿＀-￯]/.test(char)
      ? [
          { chars: char, width: 2 },
          { chars: '', width: 0 },
        ]
      : [{ chars: char, width: 1 }],
  );
}

describe('readLogicalLine', () => {
  it('reports the column each character sits in', () => {
    const { text, positions } = readLogicalLine([{ row: 5, cells: cells('abc') }]);

    expect(text).toBe('abc');
    expect(positions).toEqual([
      { x: 1, y: 5 },
      { x: 2, y: 5 },
      { x: 3, y: 5 },
    ]);
  });

  it('counts a full-width character as the two columns it draws in', () => {
    // Reading this as a string would put everything after 文件 one column early per character,
    // which is the drift a Chinese line showed under the cursor.
    const { text, positions } = readLogicalLine([{ row: 2, cells: cells('文件 a') }]);

    expect(text).toBe('文件 a');
    expect(positions).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 2 },
      { x: 5, y: 2 },
      { x: 6, y: 2 },
    ]);
  });

  it('carries on through the rows a wrapped line continues onto', () => {
    const { text, positions } = readLogicalLine([
      { row: 3, cells: cells('ab') },
      { row: 4, cells: cells('cd') },
    ]);

    expect(text).toBe('abcd');
    expect(positions[2]).toEqual({ x: 1, y: 4 });
    expect(positions[3]).toEqual({ x: 2, y: 4 });
  });

  it('reads an empty cell as the blank it draws, so words stay apart', () => {
    const { text } = readLogicalLine([
      {
        row: 1,
        cells: [
          { chars: 'a', width: 1 },
          { chars: '', width: 1 },
          { chars: 'b', width: 1 },
        ],
      },
    ]);

    expect(text).toBe('a b');
  });
});
