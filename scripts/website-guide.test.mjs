import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';

const site = new URL('../website/', import.meta.url);
const guide = readFileSync(new URL('guide.html', site), 'utf8');
const menuSource = readFileSync(new URL('guide.js', site), 'utf8');

function runMenus(preference, blockedStorage = false) {
  const storage = new Map(preference === undefined ? [] : [['termexo.website.language', preference]]);
  // Run the real menu script against elements and translation keys from the actual HTML.
  const elements = [...guide.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/g)].map((match) => {
    const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2]]));
    const classes = new Set((attrs.class || '').split(' '));
    return {
      tag: match[1], attrs, lang: attrs.lang,
      hidden: /\bhidden\b/.test(match[2]),
      dataset: { lang: attrs['data-lang'], guideI18n: attrs['data-guide-i18n'], guideAria: attrs['data-guide-aria'] },
      textContent: guide.slice(match.index + match[0].length).split('<')[0],
      handlers: {},
      classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name), contains: (name) => classes.has(name) },
      setAttribute(name, value) { this.attrs[name] = value; },
      addEventListener(name, handler) { this.handlers[name] = handler; },
    };
  });
  const selectors = {
    '[data-lang]': elements.filter((element) => element.dataset.lang),
    '[data-guide-i18n]': elements.filter((element) => element.dataset.guideI18n),
    '[data-guide-aria]': elements.filter((element) => element.dataset.guideAria),
  };
  const switcher = elements.find((element) => element.attrs.role === 'group');
  const document = {
    documentElement: elements.find((element) => element.tag === 'html'),
    querySelectorAll: (selector) => selectors[selector],
    querySelector: (selector) => selector === '[data-guide-language-switch]' ? switcher : null,
  };
  const before = elements.map((element) => ({ ...element.attrs }));
  vm.runInNewContext(menuSource, {
    document,
    localStorage: {
      getItem(key) { if (blockedStorage) throw new Error('Storage disabled'); return storage.get(key) ?? null; },
      setItem(key, value) { if (blockedStorage) throw new Error('Storage disabled'); storage.set(key, value); },
    },
  });
  return {
    document, elements, storage, before, switcher,
    translated: selectors['[data-guide-i18n]'],
    labelled: selectors['[data-guide-aria]'],
    buttons: selectors['[data-lang]'],
    text: (key) => elements.find((element) => element.dataset.guideI18n === key).textContent,
    click: (language) => selectors['[data-lang]'].find((button) => button.dataset.lang === language).handlers.click(),
  };
}

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
  assert.match(guide, /src="guide.js" defer/);
  assert.match(guide, /id="busuanzi_value_site_pv"[^>]*>—<\/span>/);
});

test('menus cover every translation key in both languages and reuse homepage preference', () => {
  for (const language of ['en', 'zh']) {
    const menu = runMenus(language);
    assert.equal(menu.document.documentElement.lang, language === 'zh' ? 'zh-CN' : 'en');
    assert.equal(menu.switcher.hidden, false);
    for (const element of menu.translated) {
      assert.equal(typeof element.textContent, 'string', element.dataset.guideI18n);
      assert.ok(element.textContent.trim(), element.dataset.guideI18n);
      assert.equal(element.lang, language === 'zh' ? 'zh-CN' : 'en');
    }
    for (const element of menu.labelled) assert.ok(element.attrs['aria-label'], element.dataset.guideAria);
    assert.equal(menu.text('home'), language === 'zh' ? '返回官网' : 'Home');
    assert.equal(menu.text('sessions'), language === 'zh' ? '03　恢复会话' : '03  Resume sessions');
    for (const button of menu.buttons) {
      assert.equal(button.attrs['aria-pressed'], String(button.dataset.lang === language));
      assert.equal(button.classList.contains('active'), button.dataset.lang === language);
    }
  }
});

test('language buttons persist the selection across page visits', () => {
  const menu = runMenus('en');
  menu.click('zh');
  assert.equal(menu.text('download'), '下载 PDF');
  assert.equal(menu.storage.get('termexo.website.language'), 'zh');
  assert.equal(runMenus(menu.storage.get('termexo.website.language')).text('home'), '返回官网');
  menu.click('en');
  assert.equal(menu.text('download'), 'Download PDF');
  assert.equal(menu.storage.get('termexo.website.language'), 'en');
  assert.match(menu.text('contentNotice'), /guide content and PDF are in Simplified Chinese/);
});

test('missing, invalid or unavailable saved preferences still allow switching', () => {
  for (const preference of [undefined, '', 'fr', 'constructor', '__proto__']) {
    const menu = runMenus(preference);
    assert.equal(menu.text('home'), 'Home');
  }
  const menu = runMenus('zh', true);
  assert.equal(menu.text('home'), 'Home');
  menu.click('zh');
  assert.equal(menu.text('home'), '返回官网');
});

test('switching keeps chapter targets, downloads, Chinese article and live counter intact', () => {
  const menu = runMenus('en');
  menu.click('zh');
  menu.click('en');
  menu.elements.forEach((element, index) => {
    for (const attr of ['href', 'download', 'id']) assert.equal(element.attrs[attr], menu.before[index][attr]);
  });
  assert.equal(menu.elements.find((element) => element.attrs.id === 'guide-content').lang, 'zh-CN');
  assert.equal(menu.elements.find((element) => element.attrs.id === 'busuanzi_value_site_pv').textContent, '—');
  for (const nav of guide.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g)) {
    for (const link of nav[1].matchAll(/<a\b([^>]*)>/g)) assert.match(link[1], /data-guide-i18n=/);
  }
});
