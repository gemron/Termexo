import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

for (const [name, grammar] of Object.entries({
  bash, c, cpp, csharp, css, go, java, javascript, json, markdown,
  powershell, python, rust, sql, typescript, xml, yaml,
})) hljs.registerLanguage(name, grammar);

const LANGUAGES: Readonly<Record<string, string>> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  json: 'json', jsonc: 'json', css: 'css', scss: 'css', less: 'css',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml',
  py: 'python', pyw: 'python', rs: 'rust', go: 'go', java: 'java', cs: 'csharp',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', psm1: 'powershell',
  sql: 'sql', yaml: 'yaml', yml: 'yaml', md: 'markdown', markdown: 'markdown',
};

export function codeLanguage(path: string): string | undefined {
  return LANGUAGES[path.split('.').at(-1)?.toLowerCase() ?? ''];
}

function escapeCode(content: string): string {
  return content.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Adds token spans only. Source whitespace and line endings are never reformatted. */
export function highlightCode(path: string, content: string): string {
  const language = codeLanguage(path);
  // Very large/minified files remain readable without running a grammar over megabytes of text.
  if (!language || content.length > 200_000) return escapeCode(content);
  return hljs.highlight(content, { language, ignoreIllegals: true }).value;
}
