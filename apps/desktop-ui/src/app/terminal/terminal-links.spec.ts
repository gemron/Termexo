import { describe, expect, it } from 'vitest';

import { continueTerminalPath, detectTerminalLinks, readLogicalLine, TerminalCell } from './terminal-links';

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

  it('keeps Unicode path segments and a file name quoted as inline code', () => {
    const [relative, absolute] = detectTerminalLinks(
      '打开 输出目录/安装结果.txt 和 `D:/build/install report.zip`',
    );
    expect(relative.text).toBe('输出目录/安装结果.txt');
    expect(absolute.text).toBe('D:/build/install report.zip');
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

describe('continueTerminalPath', () => {
  it('finds the rest of a Windows filename on the next independently wrapped row', () => {
    const prefix = 'D:/devlop/inv3d/install/Output/inv3d-0.0.1-SNAPSHOT-';
    const line = readLogicalLine([{ row: 1, cells: cells(prefix + '  ') }]);
    const [link] = detectTerminalLinks(line.text);
    const continued = continueTerminalPath(link, line, '  x64-setup.exe:9:4', 95);
    expect(continued).toMatchObject({ text: prefix + 'x64-setup.exe', line: 9, column: 4 });
    expect(continueTerminalPath(link, line, 'D:/another/file.exe', 95)).toBeUndefined();
    expect(continueTerminalPath(link, line, 'https://example.com/test', 95)).toBeUndefined();
  });

  it('only extends a path at a plausible split', () => {
    const line = readLogicalLine([{ row: 1, cells: cells('D:/output/very-long') }]);
    const full = readLogicalLine([{ row: 1, cells: cells('D:/output/file') }]);
    expect(continueTerminalPath(detectTerminalLinks(line.text)[0], line, 'name.zip', 19)?.text)
      .toBe('D:/output/very-longname.zip');
    expect(continueTerminalPath(detectTerminalLinks(full.text)[0], full, 'another message', 80))
      .toBeUndefined();
  });
});

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

  it('keeps an absolute path together when a wide character wraps past one unused column', () => {
    const { text, positions } = readLogicalLine([
      { row: 3, cells: [...cells('D:/build/setup-'), { chars: '', width: 1 }] },
      { row: 4, cells: cells('安装包.exe') },
    ]);
    const [link] = detectTerminalLinks(text);
    expect(link.text).toBe('D:/build/setup-安装包.exe');
    expect(positions[link.end - 1].y).toBe(4);
  });

  it('keeps a space actually printed at the wrap boundary', () => {
    const { text } = readLogicalLine([
      { row: 3, cells: cells('"D:/build/install ') },
      { row: 4, cells: cells('report.zip"') },
    ]);
    expect(detectTerminalLinks(text)[0].text).toBe('D:/build/install report.zip');
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
