import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';

const site = new URL('../website/', import.meta.url);
const pages = { zh: 'guide.html', en: 'guide.en.html' };
const pdfs = { zh: 'termexo-user-guide.pdf', en: 'termexo-user-guide-en.pdf' };
const locales = { zh: 'zh-CN', en: 'en' };
const guides = Object.fromEntries(Object.entries(pages).map(([lang, name]) => [lang, readFileSync(new URL(name, site), 'utf8')]));
const source = readFileSync(new URL('guide.js', site), 'utf8');
const chapters = ['quick-start', 'workbench', 'sessions', 'profiles', 'tasks', 'remote', 'faq', 'privacy'];
const attributes = (tag) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
const languageLinks = (html) => [...html.matchAll(/<a\b[^>]*data-lang="[^"]+"[^>]*>/g)].map((match) => attributes(match[0]));

function runGuide(lang, preference, blocked = false, hash = '') {
  const links = languageLinks(guides[lang]).map((attrs) => ({
    attrs, dataset: { lang: attrs['data-lang'] }, handlers: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(name, handler) { this.handlers[name] = handler; },
  }));
  const storage = new Map([['termexo.website.language', preference]]);
  const location = { hash };
  const events = {};
  const document = { documentElement: { lang: locales[lang] }, querySelectorAll: () => links };
  vm.runInNewContext(source, {
    document, location,
    window: { addEventListener: (name, handler) => { events[name] = handler; } },
    localStorage: { setItem(key, value) { if (blocked) throw new Error('Storage disabled'); storage.set(key, value); } },
  });
  return { links, storage, location, events, document };
}

for (const lang of ['zh', 'en']) {
  const html = guides[lang];
  test(lang + ': chapters and all local links resolve', () => {
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length);
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const link = match[1];
      if (link.startsWith('#')) assert.ok(ids.includes(link.slice(1)), link);
      else if (!/^https?:/.test(link)) assert.ok(existsSync(new URL(link, site)), link);
    }
    for (const id of chapters) {
      assert.ok(ids.includes(id), id);
      assert.ok(html.includes('href="#' + id + '"'), 'TOC: ' + id);
    }
  });

  test(lang + ': static language links and matching PDF work without JavaScript', () => {
    const links = languageLinks(html);
    assert.equal(links.length, 2);
    for (const link of links) {
      assert.equal(link.href, pages[link['data-lang']]);
      assert.equal(link.hreflang, locales[link['data-lang']]);
      assert.equal(link['aria-current'], link['data-lang'] === lang ? 'page' : undefined);
    }
    assert.doesNotMatch(html, /data-guide-language-switch|aria-pressed|data-guide-i18n/);
    const downloads = [...html.matchAll(/<a\b[^>]*download="[^"]+"[^>]*>/g)].map((match) => attributes(match[0]));
    assert.equal(downloads.length, 3);
    downloads.forEach((link) => assert.equal(link.href, 'downloads/' + pdfs[lang]));
    const pdf = readFileSync(new URL('downloads/' + pdfs[lang], site));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 10000);
  });

  test(lang + ': page metadata, language and translation discovery are consistent', () => {
    assert.ok(html.includes('<html lang="' + locales[lang] + '">'));
    assert.ok(html.includes('class="guide-content" lang="' + locales[lang] + '"'));
    assert.ok(html.includes('rel="canonical" href="https://www.termexo.com/' + pages[lang] + '"'));
    assert.ok(html.includes('property="og:url" content="https://www.termexo.com/' + pages[lang] + '"'));
    for (const other of ['en', 'zh']) {
      assert.ok(html.includes('hreflang="' + locales[other] + '" href="https://www.termexo.com/' + pages[other] + '"'));
    }
    const sitemap = readFileSync(new URL('sitemap.xml', site), 'utf8');
    assert.ok(sitemap.includes('<loc>https://www.termexo.com/' + pages[lang] + '</loc>'));
  });

  test(lang + ': public counter has no provider branding or fabricated number', () => {
    assert.doesNotMatch(html, /不蒜子/);
    assert.doesNotMatch(html, /src="app.js"/);
    assert.match(html, /src="guide.js" defer/);
    assert.match(html, /src="analytics.js" defer/);
    assert.match(html, /id="busuanzi_value_site_pv"[^>]*>—<\/span>/);
  });
}

test('English is a complete translated article, not just translated menus', () => {
  const sections = (html) => [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)].map((match) => match[1]);
  const chinese = sections(guides.zh), english = sections(guides.en);
  assert.equal(english.length, 8);
  const structure = (section) => [...section.matchAll(/<(h2|h3|p|li|pre|figcaption)\b/g)].map((match) => match[1]);
  english.forEach((section, index) => {
    assert.deepEqual(structure(section), structure(chinese[index]));
    assert.doesNotMatch(section, /[\u3400-\u9fff]/);
  });
  assert.match(guides.en, /Restoring a workspace layout does not bring an exited process back to life/);
  assert.match(guides.en, /Do not expose the service directly to the public internet/);
  assert.match(guides.en, /Automatic redaction cannot guarantee removal of every secret/);
});

test('explicit guide URLs win over stale preferences and remember the selected language', () => {
  for (const lang of ['en', 'zh']) {
    const guide = runGuide(lang, lang === 'en' ? 'zh' : 'en');
    assert.equal(guide.document.documentElement.lang, locales[lang]);
    assert.equal(guide.storage.get('termexo.website.language'), lang);
    const target = guide.links.find((link) => link.dataset.lang !== lang);
    target.handlers.click();
    assert.equal(guide.storage.get('termexo.website.language'), target.dataset.lang);
  }
});

test('language switching preserves the current chapter, including after hash changes', () => {
  const guide = runGuide('en', 'en', false, '#remote');
  guide.links.forEach((link) => assert.equal(link.attrs.href, pages[link.dataset.lang] + '#remote'));
  guide.location.hash = '#sessions';
  guide.events.hashchange();
  guide.links.forEach((link) => assert.equal(link.attrs.href, pages[link.dataset.lang] + '#sessions'));
});

test('disabled storage does not break native language navigation', () => {
  const guide = runGuide('zh', 'en', true, '#faq');
  guide.links.forEach((link) => {
    link.handlers.click();
    assert.equal(link.attrs.href, pages[link.dataset.lang] + '#faq');
  });
});

test('homepage language changes both guide links to the matching full translation', () => {
  const home = readFileSync(new URL('index.html', site), 'utf8');
  const links = [...home.matchAll(/<a\b[^>]*data-i18n="navGuide"[^>]*>/g)].map((match) => ({
    attrs: attributes(match[0]), dataset: { i18n: 'navGuide' }, setAttribute(key, value) { this.attrs[key] = value; },
  }));
  assert.equal(links.length, 2);
  links.forEach((link) => assert.equal(link.attrs.href, pages.en));
  const app = readFileSync(new URL('app.js', site), 'utf8').replace(/\r\n/g, '\n');
  const start = app.indexOf('\nlanguageButtons.forEach((button) => {\n  button.addEventListener');
  assert.ok(start > 0);
  const context = vm.createContext({
    document: { documentElement: {}, querySelector: () => null, querySelectorAll: (selector) => selector === '[data-i18n]' ? links : [] },
    localStorage: { setItem() {} },
  });
  vm.runInContext(app.slice(0, start), context);
  for (const lang of ['en', 'zh', 'en']) {
    vm.runInContext('setLanguage("' + lang + '")', context);
    links.forEach((link) => {
      assert.equal(link.attrs.href, pages[lang]);
      assert.equal(link.textContent, lang === 'zh' ? '使用说明' : 'User guide');
    });
  }
});
