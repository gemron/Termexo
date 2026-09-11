import { Injectable } from '@angular/core';

import { invoke } from './backend-bridge';
import { hasBackend } from './tauri-runtime';

/** One file inside the data directory, as the panel lists it. */
export interface StorageEntry {
  readonly name: string;
  readonly path: string;
  /** Null when the file does not exist yet, which is normal on a fresh installation. */
  readonly bytes: number | null;
}

/** Where Termexo keeps its data and what is in there. */
export interface StorageOverview {
  readonly dataDirectory: string;
  readonly defaultDirectory: string;
  /** Whether the data sits somewhere other than the directory Windows hands out. */
  readonly relocated: boolean;
  readonly totalBytes: number;
  readonly entries: readonly StorageEntry[];
  readonly executable: string;
  readonly version: string;
}

@Injectable({ providedIn: 'root' })
export class StorageLocationService {
  /**
   * Reads the current location, or null in a browser.
   *
   * The preview has no data directory of its own to describe — it is looking at a backend that
   * may not be running at all — so the panel says so rather than inventing a path.
   */
  async overview(): Promise<StorageOverview | null> {
    if (!hasBackend()) {
      return null;
    }
    return invoke<StorageOverview>('read_storage_overview');
  }

  /**
   * Copies the data to another directory and records it for the next start.
   *
   * Resolves with the directory the data was copied from, which is still holding it: nothing is
   * deleted, so the panel can tell the user where their space went and let them reclaim it once
   * they are satisfied the move worked.
   */
  async relocate(target: string): Promise<string> {
    return invoke<string>('relocate_application_data', { target });
  }

  /** Points the next start back at the default directory, leaving the moved copy in place. */
  async resetToDefault(): Promise<void> {
    await invoke('reset_application_data_location');
  }
}
