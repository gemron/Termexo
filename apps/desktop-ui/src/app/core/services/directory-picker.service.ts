import { inject, Injectable, signal } from '@angular/core';
import { open } from '@tauri-apps/plugin-dialog';

import { I18nService } from '../i18n/i18n.service';
import { isTauriRuntime } from './tauri-runtime';

/** An open in-app prompt, waiting for the dialog to report what the user typed. */
export interface DirectoryPromptRequest {
  title: string;
  initialDirectory: string;
  resolve: (directory: string | null) => void;
}

@Injectable({ providedIn: 'root' })
export class DirectoryPickerService {
  private readonly i18n = inject(I18nService);
  private readonly request = signal<DirectoryPromptRequest | null>(null);
  /** The prompt to render, or null while none is open. */
  readonly prompt = this.request.asReadonly();

  async select(initialDirectory?: string, title?: string): Promise<string | null> {
    const dialogTitle = title ?? this.i18n.t('terminal.selectDirectory');
    if (!isTauriRuntime()) {
      return this.askInApp(dialogTitle, initialDirectory ?? '');
    }

    const selected = await open({
      title: dialogTitle,
      directory: true,
      multiple: false,
      defaultPath: initialDirectory || undefined,
    });
    return typeof selected === 'string' ? selected : null;
  }

  /** Reports what the user chose; `null` cancels. Called by the dialog component. */
  resolvePrompt(directory: string | null): void {
    const pending = this.request();
    if (!pending) {
      return;
    }
    this.request.set(null);
    pending.resolve(directory?.trim() ? directory.trim() : null);
  }

  /**
   * Asks inside the app, which is the only option outside the Tauri window: a browser has no
   * native directory dialog, and `window.prompt` was unusable where this matters most — typing a
   * Windows path on a phone keyboard, in a box some mobile browsers suppress outright.
   *
   * The path names a folder on the machine running the desktop app, not on the device holding
   * the browser, so it arrives prefilled with the workspace folder and is usually just accepted.
   */
  private askInApp(title: string, initialDirectory: string): Promise<string | null> {
    // A second prompt would strand the first one's caller awaiting a promise nothing settles.
    this.request()?.resolve(null);
    return new Promise((resolve) => {
      this.request.set({ title, initialDirectory, resolve });
    });
  }
}
