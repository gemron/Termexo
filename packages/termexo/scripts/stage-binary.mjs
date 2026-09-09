import { copyFile, mkdir, open, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '..', '..');
const destinationDirectory = resolve(packageRoot, 'vendor', 'win32-x64');

/** Smallest plausible release build; anything under it is a stale or truncated artefact. */
const MINIMUM_EXECUTABLE_BYTES = 1_000_000;

/**
 * What the npm distribution has to carry beside the executable.
 *
 * `conpty.dll` and `OpenConsole.exe` are the pseudo console `portable-pty` prefers over the one in
 * the user's Windows build, and it only finds them next to the executable — so an npm install has
 * to stage them exactly as the installers do, or it silently falls back to the system's.
 */
const PAYLOAD = [
  {
    source: resolve(repositoryRoot, 'src-tauri', 'target', 'release', 'termexo.exe'),
    name: 'termexo.exe',
    minimumBytes: MINIMUM_EXECUTABLE_BYTES,
    missing: 'A current release executable was not found at %s. Run npm run tauri:build first.',
  },
  {
    source: resolve(repositoryRoot, 'src-tauri', 'vendor', 'conpty', 'conpty.dll'),
    name: 'conpty.dll',
    minimumBytes: 1,
    missing: 'The bundled ConPTY was not found at %s.',
  },
  {
    source: resolve(repositoryRoot, 'src-tauri', 'vendor', 'conpty', 'OpenConsole.exe'),
    name: 'OpenConsole.exe',
    minimumBytes: 1,
    missing: 'The bundled ConPTY host was not found at %s.',
  },
];

/** Rejects anything that is not a Windows binary, which would fail only at run time. */
async function assertWindowsBinary(path) {
  const handle = await open(path, 'r');
  try {
    const signature = Buffer.alloc(2);
    await handle.read(signature, 0, signature.length, 0);
    if (signature.toString('ascii') !== 'MZ') {
      throw new Error(`${path} is not a valid Windows binary.`);
    }
  } finally {
    await handle.close();
  }
}

await mkdir(destinationDirectory, { recursive: true });

let staged = 0;
for (const { source, name, minimumBytes, missing } of PAYLOAD) {
  const stats = await stat(source).catch(() => null);
  if (!stats?.isFile() || stats.size < minimumBytes) {
    throw new Error(missing.replace('%s', source));
  }
  await assertWindowsBinary(source);
  await copyFile(source, resolve(destinationDirectory, name));
  staged += stats.size;
}

console.log(`Staged ${staged} bytes across ${PAYLOAD.length} files for npm packaging.`);
