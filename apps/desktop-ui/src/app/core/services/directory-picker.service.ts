import { Injectable } from '@angular/core';
import { open } from '@tauri-apps/plugin-dialog';

import { isTauriRuntime } from './tauri-runtime';

@Injectable({ providedIn: 'root' })
export class DirectoryPickerService {
  async select(initialDirectory?: string, title = '选择终端工作目录'): Promise<string | null> {
    if (!isTauriRuntime()) {
      return window.prompt(title, initialDirectory ?? '')?.trim() || null;
    }

    const selected = await open({
      title,
      directory: true,
      multiple: false,
      defaultPath: initialDirectory || undefined,
    });
    return typeof selected === 'string' ? selected : null;
  }
}
