import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const site = new URL('../website/', import.meta.url);
const guide = readFileSync(new URL('guide.html', site), 'utf8');

test('guide has unique chapter anchors and no broken local links', () => {
  const ids = [...guide.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of guide.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const link = match[1];
    if (link.startsWith('#')) assert.ok(ids.includes(link.slice(1)), link);
    else if (!/^https?:/.test(link)) assert.ok(existsSync(new URL(link, site)), link);
  }
  for (const id of ['quick-start', 'workbench', 'sessions', 'profiles', 'tasks', 'remote', 'faq', 'privacy']) {
    assert.ok(ids.includes(id), id);
    assert.ok(guide.includes(`href="#${id}"`), `TOC: ${id}`);
  }
});

test('PDF download is a real document, not a placeholder', () => {
  const pdf = readFileSync(new URL('downloads/termexo-user-guide.pdf', site));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 10000);
  assert.match(guide, /href="downloads\/termexo-user-guide.pdf" download="[^"]+\.pdf"/);
});

test('homepage and sitemap expose the guide with bilingual navigation', () => {
  const home = readFileSync(new URL('index.html', site), 'utf8');
  const app = readFileSync(new URL('app.js', site), 'utf8');
  const sitemap = readFileSync(new URL('sitemap.xml', site), 'utf8');
  assert.equal([...home.matchAll(/href="guide.html" data-i18n="navGuide"/g)].length, 2);
  assert.match(app, /navGuide: "User guide"/);
  assert.match(app, /navGuide: "使用说明"/);
  assert.match(sitemap, /<loc>https:\/\/www\.termexo\.com\/guide.html<\/loc>/);
  assert.match(guide, /<html lang="zh-CN">/);
  assert.match(guide, /rel="canonical" href="https:\/\/www\.termexo\.com\/guide.html"/);
});

test('guide does not expose counter branding or depend on homepage JavaScript', () => {
  assert.doesNotMatch(guide, /不蒜子/);
  assert.doesNotMatch(guide, /src="app.js"/);
  assert.match(guide, /src="analytics.js" defer/);
  assert.match(guide, /id="busuanzi_value_site_pv"[^>]*>—<\/span>/);
});
