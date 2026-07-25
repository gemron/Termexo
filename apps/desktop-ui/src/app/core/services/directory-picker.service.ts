import { Injectable } from '@angular/core';
import { open } from '@tauri-apps/plugin-dialog';

import { isTauriRuntime } from './tauri-runtime';

@Injectable({ providedIn: 'root' })
export class DirectoryPickerService {
  async select(initialDirectory?: string): Promise<string | null> {
    if (!isTauriRuntime()) {
      return window.prompt('请输入终端工作目录', initialDirectory ?? '')?.trim() || null;
    }

    const selected = await open({
      title: '选择终端工作目录',
      directory: true,
      multiple: false,
      defaultPath: initialDirectory || undefined,
    });
    return typeof selected === 'string' ? selected : null;
  }
}
