import { Injectable } from '@angular/core';
import { invoke } from './backend-bridge';
import { runtimeMode } from './tauri-runtime';

export interface OneRingSettings {
  enabled: boolean;
  sourcePath: string;
  nodePath: string;
}
export interface OneRingStatus {
  settings: OneRingSettings;
  supported: boolean;
  ready: boolean;
  diagnostic: string;
}

@Injectable({ providedIn: 'root' })
export class OneRingPluginService {
  readonly desktop = runtimeMode() === 'desktop';
  get(): Promise<OneRingStatus> {
    if (!this.desktop)
      return Promise.resolve({
        settings: { enabled: false, sourcePath: '', nodePath: '' },
        supported: false,
        ready: false,
        diagnostic: '',
      });
    return invoke('get_one_ring_plugin');
  }
  check(settings: OneRingSettings): Promise<OneRingStatus> {
    return this.desktop ? invoke('check_one_ring_plugin', { settings }) : this.get();
  }
  save(settings: OneRingSettings): Promise<OneRingStatus> {
    if (!this.desktop) return Promise.reject(new Error('请在 Termexo 桌面应用中管理 Codex 插件。'));
    return invoke('save_one_ring_plugin', { settings });
  }
}
