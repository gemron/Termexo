/** Escapes source before formatting: local Markdown never becomes executable HTML. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function inline(value: string): string {
  const code: string[] = [];
  let text = escapeHtml(value).replace(/`([^`]+)`/g, (_, body: string) => {
    code.push(`<code>${body}</code>`);
    return `\u0000${code.length - 1}\u0000`;
  });
  text = text.replace(/!?\[([^\]]+)\]\(([^\s)]+)\)/g, (_, label: string, href: string) =>
    safeLink(href) ? `<a href="${href}">${label}</a>` : label,
  );
  text = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return text.replace(/\u0000(\d+)\u0000/g, (_, index: string) => code[Number(index)]);
}

function safeLink(href: string): boolean {
  if (/^https?:\/\//i.test(href)) return true;
  if (/^(?:\/\/|[a-z][a-z\d+.-]*:)/i.test(href)) return false;
  return /^[#.\p{L}\p{N}_~/-]/u.test(href);
}

export function markdownAnchor(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'section'
  );
}

/** Document formatting is built only from escaped text and fixed tags; raw HTML stays text. */
export function renderMarkdown(source: string): string {
  const result: string[] = [];
  const lines = source.split('\n');
  let code: string[] | null = null;
  let fence = '';
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (list) result.push(`</${list}>`);
    list = null;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (code) {
      if (
        marker &&
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      ) {
        result.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = null;
      } else code.push(line);
      continue;
    }
    if (marker) {
      closeList();
      fence = marker[1];
      code = [];
      continue;
    }
    const listItem = /^\s*(?:([-*+])|\d+\.)\s+(.+)$/.exec(line);
    if (listItem && !/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      const kind = listItem[1] ? 'ul' : 'ol';
      if (kind !== list) {
        closeList();
        list = kind;
        result.push(`<${kind}>`);
      }
      result.push(`<li>${inline(listItem[2])}</li>`);
      continue;
    }
    closeList();
    if (/^#{1,6}\s/.test(line)) {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line)!;
      result.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
    } else if (line.includes('|') && index + 1 < lines.length && tableSeparator(lines[index + 1])) {
      const headers = tableCells(line);
      const alignments = tableCells(lines[++index]).map((cell) =>
        cell.endsWith(':') ? (cell.startsWith(':') ? 'center' : 'right') : 'left',
      );
      const cell = (tag: 'td' | 'th', text: string, column: number) =>
        `<${tag} class="align-${alignments[column] || 'left'}">${inline(text)}</${tag}>`;
      result.push(
        `<div class="table-scroll"><table><thead><tr>${headers.map((text, column) => cell('th', text, column)).join('')}</tr></thead><tbody>`,
      );
      while (
        index + 1 < lines.length &&
        lines[index + 1].includes('|') &&
        lines[index + 1].trim()
      ) {
        const values = tableCells(lines[++index]);
        result.push(
          `<tr>${headers.map((_, column) => cell('td', values[column] ?? '', column)).join('')}</tr>`,
        );
      }
      result.push('</tbody></table></div>');
    } else if (/^>\s?/.test(line))
      result.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
    else if (/^\s*([-*_])\1{2,}\s*$/.test(line)) result.push('<hr>');
    else if (line.trim()) result.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (code) result.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  return result.join('\n');
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replaceAll('\\|', '|'));
}

function tableSeparator(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}
