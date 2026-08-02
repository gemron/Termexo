import { inject, Injectable } from '@angular/core';
import { open } from '@tauri-apps/plugin-dialog';

import { I18nService } from '../i18n/i18n.service';
import { isTauriRuntime } from './tauri-runtime';

@Injectable({ providedIn: 'root' })
export class DirectoryPickerService {
  private readonly i18n = inject(I18nService);

  async select(initialDirectory?: string, title?: string): Promise<string | null> {
    const dialogTitle = title ?? this.i18n.t('terminal.selectDirectory');
    if (!isTauriRuntime()) {
      return window.prompt(dialogTitle, initialDirectory ?? '')?.trim() || null;
    }

    const selected = await open({
      title: dialogTitle,
      directory: true,
      multiple: false,
      defaultPath: initialDirectory || undefined,
    });
    return typeof selected === 'string' ? selected : null;
  }
}
