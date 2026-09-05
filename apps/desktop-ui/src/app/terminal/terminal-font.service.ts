import { Injectable, signal } from '@angular/core';

import { invoke } from '../core/services/backend-bridge';
import { hasBackend } from '../core/services/tauri-runtime';
import { detectTerminalFontPresets, SystemFont, usableTerminalFonts } from './terminal-font';

/**
 * Supplies the installed font families the picker lists.
 *
 * The list only changes when the user installs a font, so it is fetched once per session and
 * shared; the picker calls `load()` every time it opens and gets the cached result after the
 * first.
 */
@Injectable({ providedIn: 'root' })
export class TerminalFontService {
  private readonly fontsValue = signal<readonly SystemFont[]>([]);
  private readonly loadingValue = signal(false);
  private readonly errorValue = signal<string | null>(null);
  private pending: Promise<void> | null = null;
  private loaded = false;

  readonly fonts = this.fontsValue.asReadonly();
  readonly loading = this.loadingValue.asReadonly();
  readonly error = this.errorValue.asReadonly();

  /** Loads once; concurrent callers share the in-flight request rather than starting another. */
  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.pending ??= this.fetch();
    await this.pending;
  }

  /** Drops the cache so the next `load()` picks up fonts installed since. */
  refresh(): Promise<void> {
    this.loaded = false;
    this.pending = null;
    return this.load();
  }

  private async fetch(): Promise<void> {
    this.loadingValue.set(true);
    this.errorValue.set(null);
    try {
      const fonts = hasBackend()
        ? await invoke<SystemFont[]>('list_system_fonts')
        : detectTerminalFontPresets();
      const usable = usableTerminalFonts(fonts);
      // An empty result would leave the picker with nothing to select, so the curated presets
      // stand in — they are probed against the same machine and never come back empty.
      this.fontsValue.set(usable.length > 0 ? usable : detectTerminalFontPresets());
      this.loaded = true;
    } catch (error) {
      this.errorValue.set(typeof error === 'string' ? error : String(error));
      this.fontsValue.set(detectTerminalFontPresets());
    } finally {
      this.loadingValue.set(false);
      this.pending = null;
    }
  }
}
