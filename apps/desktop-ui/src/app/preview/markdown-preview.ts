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
    /^(?:https?:\/\/|\.{0,2}\/|[\w.-]+(?:\/|\.))/i.test(href) && !/^[a-z]+:(?!\/\/)/i.test(href)
      ? `<a href="${href}">${label}</a>`
      : label,
  );
  text = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return text.replace(/\u0000(\d+)\u0000/g, (_, index: string) => code[Number(index)]);
}

/** Basic document reading (headings, lists, quotes, links and fenced code); raw HTML stays text. */
export function renderMarkdown(source: string): string {
  const result: string[] = [];
  let code: string[] | null = null;
  for (const line of source.split('\n')) {
    if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
      if (code) {
        result.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = null;
      } else code = [];
    } else if (code) code.push(line);
    else if (/^#{1,6}\s/.test(line)) {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line)!;
      result.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
    } else if (/^\s*[-*+]\s/.test(line))
      result.push(`<ul><li>${inline(line.replace(/^\s*[-*+]\s+/, ''))}</li></ul>`);
    else if (/^\s*\d+\.\s/.test(line)) result.push(`<p>${inline(line)}</p>`);
    else if (/^>\s?/.test(line))
      result.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
    else if (/^\s*([-*_])\1{2,}\s*$/.test(line)) result.push('<hr>');
    else if (line.trim()) result.push(`<p>${inline(line)}</p>`);
  }
  if (code) result.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  return result.join('\n');
}
