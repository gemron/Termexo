import { spawnSync, execFileSync } from 'node:child_process';
import { mkdir, copyFile, cp, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = path.join(repository, 'packages/one-ring');
const destination = path.join(repository, 'src-tauri/vendor/one-ring');
const node = path.join(repository, 'apps/desktop-ui/node_modules/node/bin', process.platform === 'win32' ? 'node.exe' : 'node');
if (!existsSync(node)) throw new Error('请先安装 desktop-ui 依赖，以准备锁定的内置 Node 运行时。');
const version = execFileSync(node, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
if (Number(version.slice(1).split('.')[0]) < 24) throw new Error('内置 One Ring 需要 Node 24 或更新版本。');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('请通过 npm run one-ring:stage 运行此构建步骤。');
function npm(args) {
  const environment = { ...process.env };
  const pathKey = Object.keys(environment).find(key => key.toUpperCase() === 'PATH') || 'PATH';
  environment[pathKey] = [path.dirname(node), environment[pathKey] || ''].join(path.delimiter);
  const result = spawnSync(node, [npmCli, ...args], { cwd: engine, env: environment, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`One Ring 构建命令失败：npm ${args.join(' ')}`);
}
if (!existsSync(path.join(engine, 'node_modules/@modelcontextprotocol/sdk/package.json'))) npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
npm(['run', 'build']);
await mkdir(path.join(destination, 'runtime'), { recursive: true });
await mkdir(path.join(destination, 'server'), { recursive: true });
await copyFile(path.join(engine, 'plugins/codex/plugin.json'), path.join(destination, 'plugin.json'));
await copyFile(path.join(engine, 'plugins/codex/server/index.mjs'), path.join(destination, 'server/index.mjs'));
await cp(path.join(engine, 'plugins/codex/skills'), path.join(destination, 'skills'), { recursive: true });
await copyFile(node, path.join(destination, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'));
const nodeLicense = path.join(engine, 'third-party', `node-${version}.LICENSE.txt`);
if (!existsSync(nodeLicense)) throw new Error(`缺少 ${version} 的 Node 授权文件：${nodeLicense}`);
await copyFile(nodeLicense, path.join(destination, 'runtime/LICENSE.txt'));
const lock = JSON.parse(await readFile(path.join(engine, 'package-lock.json'), 'utf8'));
const notices = ['# One Ring bundled dependency notices', 'Node.js license and bundled notices are included in runtime/LICENSE.txt.'];
for (const [relative, item] of Object.entries(lock.packages || {})) {
  if (!relative || item.dev || !relative.startsWith('node_modules/')) continue;
  const directory = path.join(engine, relative);
  if (!existsSync(directory)) continue;
  const licenseFile = readdirSync(directory).find(name => /^(licen[sc]e|copying)(\.|$)/i.test(name));
  notices.push(`\n## ${relative} ${item.version || ''}\nLicense: ${item.license || 'see package notice'}\n`);
  if (licenseFile && (await stat(path.join(directory, licenseFile))).isFile()) notices.push(await readFile(path.join(directory, licenseFile), 'utf8'));
}
await writeFile(path.join(destination, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'));
await writeFile(path.join(destination, 'bundle.json'), JSON.stringify({ engine: 'one-ring', version: JSON.parse(await readFile(path.join(engine, 'package.json'), 'utf8')).version, node: version, platform: process.platform, arch: process.arch }, null, 2));
console.log(`已准备 Termexo 内置 One Ring（${version}），无需用户配置插件或运行时路径。`);
