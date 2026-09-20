import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const site = new URL('../website/', import.meta.url);
const pages = {
  'index.html': ['app.js', 'styles.css'],
  'guide.html': ['styles.css', 'guide.css'],
  'guide.en.html': ['styles.css', 'guide.css'],
};

for (const [name, assets] of Object.entries(pages)) {
  const page = new URL(name, site);
  let html = readFileSync(page, 'utf8');
  for (const asset of assets) {
    const contents = readFileSync(new URL(asset, site), 'utf8').replace(/\r\n/g, '\n');
    const version = createHash('sha256').update(contents).digest('hex').slice(0, 12);
    const pattern = new RegExp(`((?:src|href)=")${asset.replace('.', '\\.')}([^\"]*)(")`);
    if (!pattern.test(html)) throw new Error(`Missing ${name} asset: ${asset}`);
    html = html.replace(pattern, `$1${asset}?v=${version}$3`);
    console.log(`${name}: ${asset}?v=${version}`);
  }
  writeFileSync(page, html);
}
