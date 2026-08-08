import { Injectable, OnDestroy, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

import { isTauriRuntime } from './tauri-runtime';

export interface UpdateCheck {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseNotes?: string;
  releaseUrl: string;
  publishedAt?: string;
  /** True when this build runs from a global npm install and can update itself. */
  installedViaNpm: boolean;
}

const AUTO_CHECK_STORAGE_KEY = 'termexo.autoCheckUpdates';
/** Dismissing a version keeps it hidden until a newer one ships. */
const DISMISSED_STORAGE_KEY = 'termexo.dismissedUpdateVersion';

/**
 * Gap between background checks.
 *
 * Six hours keeps a long-running window current without making the app a noticeable source of
 * traffic; GitHub's unauthenticated rate limit is far above this.
 */
export const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function readAutoCheckEnabled(): boolean {
  try {
    // Checking on launch is the default; only an explicit opt-out disables it.
    return window.localStorage.getItem(AUTO_CHECK_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

@Injectable({ providedIn: 'root' })
export class UpdateService implements OnDestroy {
  private readonly autoCheckValue = signal(readAutoCheckEnabled());
  private readonly checkingValue = signal(false);
  private readonly resultValue = signal<UpdateCheck | null>(null);
  private readonly errorValue = signal<string | null>(null);
  private timer?: ReturnType<typeof setInterval>;
  private periodicHandler?: (result: UpdateCheck) => void;

  readonly autoCheckEnabled = this.autoCheckValue.asReadonly();
  readonly checking = this.checkingValue.asReadonly();
  readonly result = this.resultValue.asReadonly();
  readonly error = this.errorValue.asReadonly();

  setAutoCheckEnabled(enabled: boolean): void {
    this.autoCheckValue.set(enabled);
    try {
      window.localStorage.setItem(AUTO_CHECK_STORAGE_KEY, String(enabled));
    } catch {
      // The preference stays in effect for this session even without storage.
    }
    // Switching off retires the timer rather than leaving it spinning on a no-op tick.
    if (!enabled) {
      this.stopPeriodicChecks();
    } else if (this.periodicHandler) {
      this.startPeriodicChecks(this.periodicHandler);
    }
  }

  /**
   * Checks on launch unless the user opted out.
   *
   * Failures stay silent here: a background check that cannot reach GitHub is not something
   * the user asked for, so it must not raise an error. The manual check reports them.
   */
  async checkOnStartup(): Promise<void> {
    if (!this.autoCheckValue()) {
      return;
    }
    await this.check().catch(() => undefined);
  }

  /**
   * Runs `onUpdate` whenever a periodic check finds a version the user has not dismissed.
   *
   * The timer follows the auto-check preference, so switching it off stops background traffic
   * immediately rather than at the next tick.
   */
  startPeriodicChecks(onUpdate: (result: UpdateCheck) => void): void {
    // Remembered so re-enabling the preference can resume without the caller registering again.
    this.periodicHandler = onUpdate;
    if (!isTauriRuntime() || !this.autoCheckValue() || this.timer !== undefined) {
      return;
    }
    this.timer = setInterval(() => {
      void this.runPeriodicCheck(onUpdate);
    }, PERIODIC_CHECK_INTERVAL_MS);
  }

  stopPeriodicChecks(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async runPeriodicCheck(onUpdate: (result: UpdateCheck) => void): Promise<void> {
    if (!this.autoCheckValue()) {
      return;
    }
    const result = await this.check().catch(() => null);
    if (result && this.shouldNotify()) {
      onUpdate(result);
    }
  }

  async check(): Promise<UpdateCheck | null> {
    if (!isTauriRuntime()) {
      // Browser preview has no packaged version to compare against.
      return null;
    }
    if (this.checkingValue()) {
      return this.resultValue();
    }

    this.checkingValue.set(true);
    this.errorValue.set(null);
    try {
      const result = await invoke<UpdateCheck>('check_for_update');
      this.resultValue.set(result);
      return result;
    } catch (error) {
      this.errorValue.set(typeof error === 'string' ? error : String(error));
      throw error;
    } finally {
      this.checkingValue.set(false);
    }
  }

  async openReleasePage(): Promise<void> {
    if (!isTauriRuntime()) {
      return;
    }
    await invoke('open_release_page', { url: this.resultValue()?.releaseUrl });
  }

  /**
   * Installs the newest npm release and relaunches.
   *
   * Windows locks the running executable, so the install happens after Termexo exits — the app
   * closes as part of this call and the new build starts on its own.
   */
  async updateViaNpm(): Promise<void> {
    if (!isTauriRuntime()) {
      return;
    }
    await invoke('update_via_npm');
  }

  /** True when an update is published and the user has not dismissed that exact version. */
  shouldNotify(): boolean {
    const result = this.resultValue();
    return Boolean(result?.updateAvailable) && result?.latestVersion !== this.dismissedVersion();
  }

  dismissCurrentResult(): void {
    const version = this.resultValue()?.latestVersion;
    if (!version) {
      return;
    }
    try {
      window.localStorage.setItem(DISMISSED_STORAGE_KEY, version);
    } catch {
      // Without storage the prompt returns next launch, which is the safe direction.
    }
  }

  private dismissedVersion(): string | null {
    try {
      return window.localStorage.getItem(DISMISSED_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  ngOnDestroy(): void {
    this.stopPeriodicChecks();
  }
}
