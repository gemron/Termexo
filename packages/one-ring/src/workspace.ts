import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { Snapshot } from './protocol.js';

export const digest = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
function git(root: string, args: string[]): Buffer { return execFileSync('git', ['-C', root, ...args], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
export function workspaceRoot(input: string): string {
  const root = realpathSync(input);
  const top = realpathSync(git(root, ['rev-parse', '--show-toplevel']).toString().trim());
  if (path.relative(root, top) !== '') throw new Error(`Use the Git working-tree root, not a subdirectory (requested ${root}; Git root ${top}).`);
  return root;
}
export function snapshot(root: string): Snapshot {
  const names = [...new Set(git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean))].sort();
  const files: Record<string, string> = {};
  for (const name of names) {
    const file = path.resolve(root, name);
    if (!file.startsWith(root + path.sep)) throw new Error('Git returned an out-of-workspace path.');
    try {
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) files[name] = digest(`link:${readlinkSync(file)}`);
      else if (stat.isFile()) files[name] = digest(Buffer.concat([Buffer.from(`${stat.mode & 0o777}:`), readFileSync(file)]).toString('base64'));
      else throw new Error(`Unsupported workspace entry (including submodules): ${name}`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') files[name] = 'deleted'; else throw error; }
  }
  let head = 'unborn';
  try { head = git(root, ['rev-parse', 'HEAD']).toString().trim(); } catch { /* A new Git fixture can have no commit. */ }
  const gitState = digest(head + '\0' + git(root, ['ls-files', '--stage', '-z']).toString());
  return { hash: digest({ git: gitState, files }), files, git: gitState };
}
export function changedFiles(before: Snapshot, after: Snapshot): string[] { return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].filter(name => before.files[name] !== after.files[name]).sort(); }
export function existingChanges(root: string): string[] { return git(root, ['status', '--porcelain=v1', '-z']).toString().split('\0').filter(Boolean); }
