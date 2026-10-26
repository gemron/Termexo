import { computed, Injectable, signal } from '@angular/core';
import { invoke } from './backend-bridge';
import { runtimeMode } from './tauri-runtime';

interface ThirdPartyNotificationsSettings { enabled: boolean }

/** Global delivery gate. Each channel keeps its own configuration and opt-in. */
@Injectable({ providedIn: 'root' })
export class ThirdPartyNotificationsService {
  readonly enabled = signal(true);
  readonly initialized = signal(false);
  readonly saving = signal(false);
  readonly generation = signal(0);
  private readonly pausing = signal(false);
  readonly canSend = computed(() => this.initialized() && this.enabled() && !this.pausing());
  private loading?: Promise<void>;

  initialize(): Promise<void> {
    if (this.initialized() || runtimeMode() !== 'desktop') return Promise.resolve();
    return this.loading ??= this.load().catch((error) => {
      this.loading = undefined;
      throw error;
    });
  }

  private async load(): Promise<void> {
    const settings = await invoke<ThirdPartyNotificationsSettings>('read_third_party_notifications');
    this.enabled.set(settings.enabled);
    this.initialized.set(true);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (runtimeMode() !== 'desktop' || this.saving()) return;
    this.saving.set(true);
    this.pausing.set(!enabled);
    this.generation.update((value) => value + 1);
    try {
      await this.initialize();
      const saved = await invoke<ThirdPartyNotificationsSettings>(
        'set_third_party_notifications_enabled', { enabled },
      );
      this.enabled.set(saved.enabled);
    } finally {
      this.pausing.set(false);
      this.saving.set(false);
    }
  }
}
