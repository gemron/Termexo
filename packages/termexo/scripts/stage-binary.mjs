import { copyFile, mkdir, open, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(packageRoot, '..', '..', 'src-tauri', 'target', 'release', 'termexo.exe');
const destination = resolve(packageRoot, 'vendor', 'win32-x64', 'termexo.exe');

const sourceStats = await stat(source).catch(() => null);
if (!sourceStats?.isFile() || sourceStats.size < 1_000_000) {
  throw new Error(
    `A current release executable was not found at ${source}. Run npm run tauri:build first.`,
  );
}

const sourceHandle = await open(source, 'r');
try {
  const signature = Buffer.alloc(2);
  await sourceHandle.read(signature, 0, signature.length, 0);
  if (signature.toString('ascii') !== 'MZ') {
    throw new Error(`${source} is not a valid Windows executable.`);
  }
} finally {
  await sourceHandle.close();
}

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
console.log(`Staged ${sourceStats.size} byte Termexo executable for npm packaging.`);
