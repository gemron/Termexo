import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const site = new URL("../website/", import.meta.url);
const pages = {
  "index.html": [
    "app.js",
    "styles.css",
    "assets/termexo-workbench-demo.mp4",
    "assets/termexo-workbench-demo.png",
  ],
  "guide.html": ["styles.css", "guide.css"],
  "guide.en.html": ["styles.css", "guide.css"],
};

for (const [name, assets] of Object.entries(pages)) {
  const page = new URL(name, site);
  let html = readFileSync(page, "utf8");
  for (const asset of assets) {
    const bytes = readFileSync(new URL(asset, site));
    const contents = /\.(?:js|css)$/.test(asset)
      ? bytes.toString("utf8").replace(/\r\n/g, "\n")
      : bytes;
    const version = createHash("sha256")
      .update(contents)
      .digest("hex")
      .slice(0, 12);
    const escapedAsset = asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `((?:src|href|poster|content)=")((?:https://www\\.termexo\\.com/)?${escapedAsset})(?:\\?[^\"]*)?(")`,
      "g",
    );
    if (!pattern.test(html)) throw new Error(`Missing ${name} asset: ${asset}`);
    html = html.replace(pattern, `$1$2?v=${version}$3`);
    console.log(`${name}: ${asset}?v=${version}`);
  }
  writeFileSync(page, html);
}
