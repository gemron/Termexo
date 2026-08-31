import { execFile } from 'node:child_process';
import { renameSync, rmSync } from 'node:fs';
import { access, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

/**
 * Temporarily moves the real Termexo database aside so a script can drive a first-run instance.
 *
 * Recording promotional material must not expose real workspace names, project paths or task
 * titles, and must not write demo data into the user's own database. Tauri resolves its app data
 * directory through the Windows known-folder API rather than the APPDATA environment variable,
 * so redirecting the environment does not isolate anything — the database file itself has to move.
 *
 * The stash is deliberately conservative: it refuses to run while the application is open, it
 * refuses to overwrite an existing stash, and restoring always puts the original file back.
 */

const execFileAsync = promisify(execFile);

const APPLICATION_IDENTIFIER = 'dev.agentdock.desktop';
const DATABASE_FILE_NAME = 'agentdock.db';
/** SQLite keeps the write-ahead log and shared-memory files beside the database. */
const SQLITE_SIDECAR_SUFFIXES = ['', '-wal', '-shm'];
const STASH_SUFFIX = '.recording-stash';
const LEFTOVER_SUFFIX = '.demo-leftover-';
const PROCESS_NAME = 'termexo';

export function resolveApplicationDataDirectory() {
  const roamingDirectory = process.env.APPDATA;
  if (!roamingDirectory) {
    throw new Error('APPDATA is not set; cannot locate the Termexo application data directory.');
  }
  return join(roamingDirectory, APPLICATION_IDENTIFIER);
}

/** Returns the process ids of any running Termexo instance. */
export async function findRunningInstances() {
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-Process ${PROCESS_NAME} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`,
      ],
      { windowsHide: true },
    );
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Moves the database aside and returns a restore function.
 * The caller must invoke the restore function from a finally block.
 */
export async function stashApplicationDatabase() {
  const runningInstances = await findRunningInstances();
  if (runningInstances.length > 0) {
    throw new Error(
      `Close Termexo before recording — the database cannot be moved while it is open ` +
        `(running process ids: ${runningInstances.join(', ')}).`,
    );
  }

  const directory = resolveApplicationDataDirectory();
  const stashedFiles = [];

  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const originalPath = join(directory, `${DATABASE_FILE_NAME}${suffix}`);
    const stashPath = `${originalPath}${STASH_SUFFIX}`;
    if (!(await pathExists(originalPath))) {
      continue;
    }
    if (await pathExists(stashPath)) {
      throw new Error(
        `A stash from an interrupted recording already exists at ${stashPath}. ` +
          `Restore it manually before recording again so the real data is not lost.`,
      );
    }
    await rename(originalPath, stashPath);
    stashedFiles.push({ originalPath, stashPath });
  }

  let restored = false;
  const handle = {
    stashedFiles,
    async restore() {
      if (restored) {
        return;
      }
      restored = true;
      for (const path of throwawayDatabasePaths(directory)) {
        await rm(path, { force: true });
      }
      for (const { originalPath, stashPath } of stashedFiles) {
        await rename(stashPath, originalPath);
      }
    },
    /**
     * Synchronous restore for process exit handlers.
     * A signal or a broken stdout pipe kills the process without waiting for pending promises,
     * so an async restore in a finally block is not enough on its own to protect the real data.
     */
    restoreSync() {
      if (restored) {
        return;
      }
      restored = true;
      for (const path of throwawayDatabasePaths(directory)) {
        rmSync(path, { force: true });
      }
      for (const { originalPath, stashPath } of stashedFiles) {
        renameSync(stashPath, originalPath);
      }
    },
  };
  return handle;
}

/**
 * Every file the throwaway database may have created, not only the ones that were stashed.
 *
 * A stash only registers files that existed at the time, so a `-wal` the recording created is
 * not on that list. Leaving it behind is not harmless: SQLite replays the orphaned write-ahead
 * log into the next throwaway database, and the demo starts with the previous run's workspaces
 * and tasks already in it.
 */
function throwawayDatabasePaths(directory) {
  return SQLITE_SIDECAR_SUFFIXES.map((suffix) => join(directory, `${DATABASE_FILE_NAME}${suffix}`));
}

/**
 * Puts back a stash left behind by an interrupted run.
 * Returns the files it restored, or an empty array when there was nothing to do.
 */
export async function restorePendingStash() {
  const directory = resolveApplicationDataDirectory();
  const runningInstances = await findRunningInstances();
  if (runningInstances.length > 0) {
    throw new Error(`Close Termexo first (running process ids: ${runningInstances.join(', ')}).`);
  }

  const restoredFiles = [];
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const originalPath = join(directory, `${DATABASE_FILE_NAME}${suffix}`);
    const stashPath = `${originalPath}${STASH_SUFFIX}`;
    if (!(await pathExists(stashPath))) {
      continue;
    }
    // Keep the throwaway database rather than deleting it, so a mistaken restore is recoverable.
    if (await pathExists(originalPath)) {
      await rename(originalPath, `${originalPath}${LEFTOVER_SUFFIX}${Date.now()}`);
    }
    await rename(stashPath, originalPath);
    restoredFiles.push(originalPath);
  }
  return restoredFiles;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
