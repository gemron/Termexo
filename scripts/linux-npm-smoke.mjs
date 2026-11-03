import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

assert.equal(process.platform, 'linux');
const repository = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8')).version;
const output = resolve(
  repository,
  process.env.TERMEXO_NPM_SMOKE_OUTPUT ?? 'validation-results/linux-npm',
);
const archive = resolve(
  repository,
  process.env.TERMEXO_NPM_ARCHIVE ?? `${output}/termexo-${version}.tgz`,
);
const state = await mkdtemp(join(tmpdir(), 'termexo-npm-smoke-'));
const prefix = join(state, "prefix's ! 中文");
const env = {
  ...process.env,
  HOME: join(state, 'home'),
  XDG_CACHE_HOME: join(state, "cache's ! 中文"),
  XDG_DATA_HOME: join(state, 'data'),
  XDG_CONFIG_HOME: join(state, 'config'),
  npm_config_cache: join(state, 'npm-cache'),
};
delete env.TERMEXO_PATH;
await Promise.all([mkdir(output, { recursive: true }), mkdir(env.HOME)]);
const npm = (args) =>
  process.env.npm_execpath
    ? execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
        env,
        encoding: 'utf8',
        timeout: 120000,
      })
    : execFileSync('npm', args, { env, encoding: 'utf8', timeout: 120000 });
await writeFile(
  join(output, 'install.log'),
  npm(['install', '--global', '--prefix', prefix, archive, '--offline', '--no-audit', '--no-fund']),
);
const command = join(prefix, 'bin/termexo');
assert.equal(execFileSync(command, ['--version'], { env, encoding: 'utf8' }).trim(), version);
const headless = { ...env };
delete headless.DISPLAY;
delete headless.WAYLAND_DISPLAY;
assert.match(
  execFileSync(command, ['--help'], { env: headless, encoding: 'utf8' }),
  /Linux termexo executable/,
);
const rejected = spawnSync(command, [], { env: headless, encoding: 'utf8', timeout: 30000 });
assert.equal(rejected.status, 1);
assert.match(rejected.stderr, /graphical Linux desktop/);
const pkgRoot = join(prefix, 'lib/node_modules/termexo');
const prepare = `import {prepareLinuxApplication} from ${JSON.stringify(pathToFileURL(join(pkgRoot, 'lib/linux.js')).href)}; console.log(prepareLinuxApplication({version:${JSON.stringify(version)}}));`;
const binary = execFileSync(process.execPath, ['--input-type=module', '-e', prepare], {
  env,
  encoding: 'utf8',
}).trim();
const result = execFileSync(command, [], { env, encoding: 'utf8', timeout: 30000 });
assert(result.includes(binary));
let pid;
try {
  for (let count = 0; count < 40 && !pid; count++) {
    const lines = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).split('\n');
    pid = lines
      .find((line) => line.trim().replace(/^\d+\s+/, '') === binary)
      ?.trim()
      .split(/\s+/)[0];
    if (!pid) await delay(100);
  }
  assert(pid, 'The npm command must launch the cached native executable');
  await delay(2000);
  process.kill(Number(pid), 0);
  await writeFile(join(output, 'launcher.log'), result);
} finally {
  if (pid) {
    try {
      process.kill(-Number(pid), 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    await delay(1000);
    try {
      process.kill(-Number(pid), 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}
// Drive the exact npm-installed and extracted payload with native WebKit, PTYs and the Bash matrix.
const desktop = spawnSync(process.execPath, [join(repository, 'scripts/linux-desktop-smoke.mjs')], {
  cwd: repository,
  env: {
    ...process.env,
    TERMEXO_DESKTOP_BINARY: binary,
    TERMEXO_SMOKE_REAL_AGENT: '',
    TERMEXO_SMOKE_BASH_MATRIX: '1',
    TERMEXO_SMOKE_OUTPUT: join(output, 'desktop'),
  },
  encoding: 'utf8',
  timeout: 180000,
});
await writeFile(join(output, 'desktop.log'), `${desktop.stdout ?? ''}\n${desktop.stderr ?? ''}`);
assert.equal(desktop.status, 0, desktop.error?.message ?? desktop.stderr);
const report = {
  status: 'passed',
  version,
  archive,
  prefix,
  binary,
  state,
  checks: [
    'offline global npm installation',
    'installed --version and headless --help',
    'headless start fails with guidance',
    'real npm command launches GUI process',
    'cached npm payload passes native desktop and eight Bash argv checks',
  ],
};
await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
