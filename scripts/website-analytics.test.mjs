import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = readFileSync(new URL('../website/analytics.js', import.meta.url), 'utf8');
function run(hostname, installed = false) {
  const scripts = [];
  const document = {
    getElementById: () => installed ? {} : null,
    createElement: () => ({}),
    head: { append: (script) => scripts.push(script) },
  };
  vm.runInNewContext(source, { document, location: { hostname } });
  return scripts;
}

test('local previews and lookalike domains send no counter requests', () => {
  for (const host of ['localhost', '127.0.0.1', '192.168.1.10', 'www.termexo.com.example.org']) {
    assert.equal(run(host).length, 0);
  }
});

test('production loads the public counter without an account token', () => {
  for (const host of ['www.termexo.com', 'termexo.com']) {
    const scripts = run(host);
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].src, 'https://busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js');
    assert.equal(scripts[0].async, true);
  }
});

test('does not add another counter when one is already present', () => {
  assert.equal(run('www.termexo.com', true).length, 0);
});

test('the counter starts with an unavailable marker, never a fabricated count', () => {
  const html = readFileSync(new URL('../website/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="busuanzi_value_site_pv"[^>]*>—<\/span>/);
  assert.doesNotMatch(html, /termexo-analytics-token/);
});

test('search and social metadata refer to real local assets', () => {
  const html = readFileSync(new URL('../website/index.html', import.meta.url), 'utf8');
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.name, 'Termexo');
  assert.equal(data.offers.price, '0');
  assert.equal(data.operatingSystem, 'Windows 10, Windows 11');
  for (const match of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
    if (/^(https?:|mailto:)/.test(match[1])) continue;
    assert.ok(existsSync(new URL(`../website/${match[1]}`, import.meta.url)), match[1]);
  }
  for (const match of html.matchAll(/content="https:\/\/www\.termexo\.com\/(assets\/[^"\s]+)"/g)) {
    assert.ok(existsSync(new URL(`../website/${match[1]}`, import.meta.url)), match[1]);
  }
});
