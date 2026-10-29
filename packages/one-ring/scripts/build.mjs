import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await mkdir('plugins/codex/server', { recursive: true });
await build({ entryPoints: ['src/main.ts'], outfile: 'dist/server.mjs', bundle: true, platform: 'node', target: 'node24', format: 'esm', banner: { js: "import { createRequire as __oneRingCreateRequire } from 'node:module'; const require = __oneRingCreateRequire(import.meta.url);" } });
await copyFile('dist/server.mjs', 'plugins/codex/server/index.mjs');
console.log('Built self-contained local MCP server and plugin runtime.');
