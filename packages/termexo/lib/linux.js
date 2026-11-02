import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const vendorRoot = fileURLToPath(new URL('../vendor/', import.meta.url));
export const LINUX_ARCHITECTURES = ['x64'];
export const LINUX_RESOURCE_FILES = [
  'plugin.json',
  'bundle.json',
  'server/index.mjs',
  'runtime/node',
  'runtime/LICENSE.txt',
  'THIRD_PARTY_NOTICES.txt',
  'skills/one-ring/SKILL.md',
  'skills/setup/SKILL.md',
  'skills/status/SKILL.md',
];

export function linuxCacheRoot(environment = process.env, home = homedir()) {
  const configured = environment.XDG_CACHE_HOME;
  return join(
    configured && isAbsolute(configured) ? configured : join(home, '.cache'),
    'Termexo',
    'npm',
  );
}

function executable(file) {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Keep the Debian usr/bin + usr/lib layout so Tauri finds the complete bundled runtime. */
export function linuxPayloadComplete(root) {
  const resources = join(root, 'usr/lib/Termexo/one-ring');
  return (
    executable(join(root, 'usr/bin/termexo')) &&
    executable(join(resources, 'runtime/node')) &&
    LINUX_RESOURCE_FILES.every((name) => existsSync(join(resources, name)))
  );
}

export function prepareLinuxApplication({
  version,
  arch = process.arch,
  archivePath,
  cacheRoot = linuxCacheRoot(),
  extract = (archive, destination) =>
    execFileSync('tar', ['-xzf', archive, '-C', destination], { timeout: 120000 }),
} = {}) {
  if (!LINUX_ARCHITECTURES.includes(arch))
    throw new Error(
      `Unsupported Linux architecture: ${arch}. The npm payload currently supports Linux x64; build other architectures from source.`,
    );
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid Termexo package version');
  const archive = archivePath ?? join(vendorRoot, `linux-${arch}`, 'Termexo.tar.gz');
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
  const destination = join(cacheRoot, `${version}-linux-${arch}-${digest.slice(0, 16)}`);
  const binary = join(destination, 'usr/bin/termexo');
  if (linuxPayloadComplete(destination)) return binary;
  mkdirSync(cacheRoot, { recursive: true });
  const temporary = mkdtempSync(join(cacheRoot, '.extract-'));
  try {
    extract(archive, temporary);
    if (!linuxPayloadComplete(temporary))
      throw new Error(
        'The npm archive does not contain a complete executable Linux application and One Ring runtime.',
      );
    // A broken cache can be repaired from the verified archive without touching application data.
    if (existsSync(destination) && !linuxPayloadComplete(destination))
      rmSync(destination, { recursive: true, force: true });
    try {
      renameSync(temporary, destination);
    } catch (error) {
      if (!linuxPayloadComplete(destination)) throw error;
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  return binary;
}

export function checkLinuxRuntime(
  binary,
  {
    environment = process.env,
    probe = (file) =>
      spawnSync('ldd', [file], { encoding: 'utf8', timeout: 10000, env: environment }),
  } = {},
) {
  if (!executable(binary))
    throw new Error(`Linux executable is missing or not executable: ${binary}`);
  if (!environment.DISPLAY && !environment.WAYLAND_DISPLAY)
    throw new Error(
      'Termexo needs a graphical Linux desktop session (DISPLAY or WAYLAND_DISPLAY). --help and --version also work without a desktop.',
    );
  const result = probe(binary);
  const details = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.error || result.status !== 0 || /\bnot found\b/.test(details)) {
    const missing = details
      .split('\n')
      .filter((line) => /\bnot found\b/.test(line))
      .map((line) => line.trim())
      .join('\n');
    throw new Error(
      `Linux runtime dependency check failed.${missing ? `\n${missing}` : `\n${result.error?.message ?? details.trim()}`}\nOn Ubuntu 24.04+: sudo apt-get install libwebkit2gtk-4.1-0 libgtk-3-0t64 libayatana-appindicator3-1 libsecret-1-0 gnome-keyring fontconfig xdg-utils\nOther distributions need equivalent GTK 3/WebKitGTK 4.1 packages. See docs/linux.md.`,
    );
  }
}
