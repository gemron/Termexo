import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

const site = new URL("../website/", import.meta.url);
const html = readFileSync(new URL("index.html", site), "utf8");
const app = readFileSync(new URL("app.js", site), "utf8").replace(
  /\r\n/g,
  "\n",
);
const hero = html.slice(
  html.indexOf('<section class="hero'),
  html.indexOf('<section class="signal-strip'),
);
const dictionaryContext = vm.createContext({});
vm.runInContext(
  app.slice(0, app.indexOf("const languageButtons")),
  dictionaryContext,
);
const dictionaries = vm.runInContext("translations", dictionaryContext);

test("desktop and phone workflow have complete bilingual copy and honest boundaries", () => {
  assert.ok(hero.length > 0);
  const keys = [...hero.matchAll(/data-i18n="([^"]+)"/g)].map(
    (match) => match[1],
  );
  for (const lang of ["en", "zh"]) {
    for (const key of keys)
      assert.ok(dictionaries[lang][key]?.trim(), `${lang}: ${key}`);
    assert.match(dictionaries[lang].heroRemoteNote, /VPN/);
    assert.match(dictionaries[lang].heroRemoteNote, /token|令牌/);
    assert.match(
      dictionaries[lang].heroRemoteNote,
      /PC running|电脑需保持运行/,
    );
    assert.match(
      dictionaries[lang].sceneCaption,
      /not a live session|非实时会话/,
    );
  }
  assert.match(dictionaries.zh.heroLine2, /跨网络/);
  assert.match(dictionaries.en.heroLine2, /networks/);
  assert.doesNotMatch(
    hero,
    /termexo agent status|7 agents active|Nothing leaves your PC/,
  );
  const scene = hero.slice(
    hero.indexOf("<figure"),
    hero.indexOf("</figure>") + "</figure>".length,
  );
  assert.match(scene, /class="desktop-window"/);
  assert.match(scene, /class="mobile-window"/);
  assert.doesNotMatch(scene, /<(button|input|textarea)\b/);
  assert.match(scene, /aria-labelledby="scene-caption"/);
  assert.match(scene, /id="scene-caption"/);
});

test("remote guide follows language changes and preserves the remote chapter", () => {
  const link = {
    dataset: { i18n: "heroRemoteGuide" },
    attrs: {},
    setAttribute(key, value) {
      this.attrs[key] = value;
    },
  };
  const context = vm.createContext({
    document: {
      documentElement: {},
      querySelector: () => null,
      querySelectorAll: (selector) =>
        selector === "[data-i18n]" ? [link] : [],
    },
    localStorage: { setItem() {} },
  });
  const end = app.indexOf(
    "\nlanguageButtons.forEach((button) => {\n  button.addEventListener",
  );
  assert.ok(end > 0);
  vm.runInContext(app.slice(0, end), context);
  for (const lang of ["zh", "en", "zh"]) {
    vm.runInContext(`setLanguage('${lang}')`, context);
    assert.equal(
      link.attrs.href,
      lang === "zh" ? "guide.html#remote" : "guide.en.html#remote",
    );
    assert.equal(link.textContent, dictionaries[lang].heroRemoteGuide);
    const guide = readFileSync(
      new URL(link.attrs.href.split("#")[0], site),
      "utf8",
    );
    assert.match(guide, /id="remote"/);
  }
});

test("static homepage links resolve and existing social artwork is preserved", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, link] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^https?:/.test(link)) continue;
    if (link.startsWith("#")) assert.ok(ids.includes(link.slice(1)), link);
    else assert.ok(existsSync(new URL(link.split("#")[0], site)), link);
  }
  assert.match(html, /href="guide.en.html#remote"\s+data-i18n="heroRemoteGuide"/);
  assert.match(
    html,
    /property="og:image"\s+content="https:\/\/www.termexo.com\/assets\/termexo-phone.png"/,
  );
  const { version } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.ok(html.includes(`<small>${version}</small>`));
  const metadata = JSON.parse(
    html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1],
  );
  assert.equal(metadata.softwareVersion, version);
});
