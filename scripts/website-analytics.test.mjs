import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = readFileSync(new URL('../website/analytics.js', import.meta.url), 'utf8');
const validToken = '0123456789abcdef0123456789abcdef';

function run(hostname, token, installed = false) {
  const scripts = [];
  const document = {
    querySelector: (selector) => selector.startsWith('meta') ? { content: token } : installed ? {} : null,
    createElement: () => ({ dataset: {} }),
    head: { append: (script) => scripts.push(script) },
  };
  vm.runInNewContext(source, { document, location: { hostname } });
  return scripts;
}

test('unconfigured, malformed and local previews send no analytics', () => {
  for (const token of ['', 'not-a-site-token', '0123']) {
    assert.equal(run('www.termexo.com', token).length, 0);
  }
  for (const host of ['localhost', '127.0.0.1', '192.168.1.10', 'www.termexo.com.example.org']) {
    assert.equal(run(host, validToken).length, 0);
  }
});

test('production uses only the configured public token and official beacon', () => {
  for (const host of ['www.termexo.com', 'termexo.com']) {
    const scripts = run(host, validToken);
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].src, 'https://static.cloudflareinsights.com/beacon.min.js');
    assert.equal(JSON.parse(scripts[0].dataset.cfBeacon).token, validToken);
    assert.equal(scripts[0].defer, true);
  }
});

test('does not add another beacon when one is already present', () => {
  assert.equal(run('www.termexo.com', validToken, true).length, 0);
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
