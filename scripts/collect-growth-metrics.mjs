import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repository = "gemron/Termexo";
const output = new URL("../.tooling/growth/", import.meta.url);

async function readGitHub(endpoint, extra = []) {
  try {
    const { stdout } = await exec(
      "gh",
      ["api", "--hostname", "github.com", endpoint, ...extra],
      {
        windowsHide: true,
        timeout: 45_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return { status: "ok", data: JSON.parse(stdout) };
  } catch (error) {
    // Do not save CLI diagnostics: they may contain local paths or authentication context.
    return {
      status: "unavailable",
      reason: error.code === "ENOENT" ? "gh-not-found" : "request-failed",
    };
  }
}

await mkdir(output, { recursive: true });
const previousFiles = (await readdir(output))
  .filter((name) => /^snapshot-.*\.json$/.test(name))
  .sort();
let previous;
for (const name of previousFiles.reverse()) {
  try {
    const candidate = JSON.parse(await readFile(new URL(name, output), "utf8"));
    if (
      candidate.repository === repository &&
      candidate.repo?.status === "ok"
    ) {
      previous = candidate;
      break;
    }
  } catch {
    // Preserve unreadable snapshots; an interrupted/manual edit must not prevent collection.
  }
}

const startedAt = new Date().toISOString();
const [repo, views, clones, referrers, releases] = await Promise.all([
  readGitHub(`repos/${repository}`, [
    "--jq",
    "{stars: .stargazers_count, forks: .forks_count, openIssues: .open_issues_count}",
  ]),
  readGitHub(`repos/${repository}/traffic/views`),
  readGitHub(`repos/${repository}/traffic/clones`),
  readGitHub(`repos/${repository}/traffic/popular/referrers`),
  readGitHub(`repos/${repository}/releases?per_page=100`, [
    "--paginate",
    "--slurp",
  ]),
]);
if (releases.status === "ok") {
  releases.data = releases.data
    .flat()
    .filter((release) => !release.draft)
    .map((release) => ({
      tag: release.tag_name,
      prerelease: release.prerelease,
      publishedAt: release.published_at,
      assets: release.assets.map((asset) => ({
        name: asset.name,
        downloads: asset.download_count,
      })),
    }));
}
const collectedAt = new Date().toISOString();
const snapshot = {
  schemaVersion: 1,
  repository,
  startedAt,
  collectedAt,
  repo,
  views,
  clones,
  referrers,
  releases,
};
const snapshotName = `snapshot-${collectedAt.replaceAll(":", "-")}.json`;
await writeFile(
  new URL(snapshotName, output),
  JSON.stringify(snapshot, null, 2) + "\n",
  { flag: "wx" },
);

const lines = [
  `# Termexo growth snapshot`,
  "",
  `Collected: ${collectedAt} (UTC).`,
  "",
  `Raw snapshot: ${snapshotName}`,
  "",
];
if (repo.status === "ok") {
  lines.push(`- Stars: ${repo.data.stars}`, `- Forks: ${repo.data.forks}`);
  if (previous) {
    const delta = repo.data.stars - previous.repo.data.stars;
    lines.push(
      `- Net Star change since ${previous.collectedAt}: ${delta >= 0 ? "+" : ""}${delta}`,
    );
  } else {
    lines.push("- Net Star change: unavailable (first successful snapshot).");
  }
} else {
  lines.push(
    "- Repository totals: unavailable. Check that GitHub CLI is installed and signed in.",
  );
}
for (const [name, result, key] of [
  ["Views", views, "views"],
  ["Clones", clones, "clones"],
]) {
  if (result.status !== "ok") {
    lines.push(
      `- ${name}: unavailable; traffic requires repository access. Missing data is not zero.`,
    );
    continue;
  }
  const dates = result.data[key].map((row) => row.timestamp).sort();
  lines.push(
    `- ${name}: ${result.data.count} total / ${result.data.uniques} unique; returned daily rows: ${dates[0] ?? "none"} to ${dates.at(-1) ?? "none"}.`,
  );
}
lines.push(
  "",
  "## Referring sites",
  "",
  "| Source | Views | Unique visitors |",
  "| --- | ---: | ---: |",
);
if (referrers.status === "ok") {
  for (const row of referrers.data) {
    const label = String(row.referrer).replace(/[|\r\n<>]/g, " ");
    lines.push(`| ${label} | ${row.count} | ${row.uniques} |`);
  }
  if (!referrers.data.length) lines.push("| No sources returned | — | — |");
} else lines.push("| Unavailable | — | — |");

lines.push("", "## Release assets", "");
if (releases.status === "ok") {
  const installers = releases.data.flatMap((release) =>
    release.assets.filter((asset) => /\.(exe|msi)$/i.test(asset.name)),
  );
  lines.push(
    `- EXE/MSI downloads across currently returned releases: ${installers.reduce((sum, asset) => sum + asset.downloads, 0)}.`,
  );
  const latest = releases.data
    .filter((release) => !release.prerelease)
    .sort((a, b) =>
      (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
    )[0];
  if (latest) {
    lines.push(`- Latest stable release: ${latest.tag}.`);
    for (const asset of latest.assets)
      lines.push(`- ${asset.name}: ${asset.downloads} downloads.`);
  }
} else lines.push("- Release downloads: unavailable.");

lines.push(
  "",
  "## Interpretation",
  "",
  "- Traffic can lag behind collection time. Read the returned dates before comparing campaigns.",
  "- Referrers are a partial list; unique counts may overlap and must not be summed.",
  "- Total Stars divided by traffic uniques is not a conversion rate. Net Star changes are not attributable to individual posts.",
  "- Downloads include repeats and are not successful installations or unique users. Deleted releases/assets disappear from subsequent totals.",
  "- Website UTM links alone do not produce reports: the current website counter only reports PV.",
  "- This command collects once. It does not install a scheduler or change app telemetry.",
  "- Raw traffic and these reports stay in gitignored .tooling/growth; review before sharing.",
  "",
);
await writeFile(new URL("latest.md", output), lines.join("\n"));
const unavailable = Object.entries({ repo, views, clones, referrers, releases })
  .filter(([, result]) => result.status !== "ok")
  .map(([name]) => name);
console.log(`Saved ${fileURLToPath(new URL(snapshotName, output))}`);
console.log(`Report: ${fileURLToPath(new URL("latest.md", output))}`);
console.log(
  repo.status === "ok" ? `Stars: ${repo.data.stars}` : "Stars unavailable",
);
if (unavailable.length) {
  console.error(
    `Incomplete snapshot: ${unavailable.join(", ")}. Check gh auth status and repository access, then retry.`,
  );
  process.exitCode = 1;
}
