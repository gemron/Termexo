import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Channel } from '@tauri-apps/api/core';

import { invoke } from './backend-bridge';
import { isTauriRuntime } from './tauri-runtime';
import { I18nService } from '../i18n/i18n.service';

export interface UpdateCheck {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseNotes?: string;
  releaseUrl: string;
  publishedAt?: string;
  installedViaNpm: boolean;
  installMethod: InstallMethod;
}

export type InstallMethod = 'restart' | 'openInstaller' | 'manual';
export type UpdateSourcePreference = 'auto' | 'china' | 'official';

export interface UpdateProgress {
  source: 'github' | 'chinaMirror' | 'npmRegistry';
  received: number;
  total: number | null;
  verifying: boolean;
}

const UPDATE_SOURCE_STORAGE_KEY = 'termexo.updateSource';
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

function readSource(): UpdateSourcePreference {
  try {
    const value = window.localStorage.getItem(UPDATE_SOURCE_STORAGE_KEY);
    if (value === 'china' || value === 'official') return value;
  } catch {
    // Auto stays usable when storage is unavailable.
  }
  return 'auto';
}

@Injectable({ providedIn: 'root' })
export class UpdateService implements OnDestroy {
  private readonly i18n = inject(I18nService);
  private readonly sourceValue = signal(readSource());
  private readonly downloadedVersion = signal<string | null>(null);
  private checkInFlight?: Promise<UpdateCheck>;
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
  readonly source = this.sourceValue.asReadonly();
  readonly desktop = isTauriRuntime();
  readonly downloading = signal(false);
  readonly installing = signal(false);
  readonly progress = signal<UpdateProgress | null>(null);
  readonly operationError = signal<string | null>(null);
  readonly installerOpened = signal(false);
  readonly ready = computed(() =>
    this.downloadedVersion() !== null && this.downloadedVersion() === this.resultValue()?.latestVersion,
  );
  private readonly preferChina = computed(() =>
    this.sourceValue() === 'china' ||
    (this.sourceValue() === 'auto' && this.i18n.locale() === 'zh-CN'),
  );

  setSource(source: UpdateSourcePreference): void {
    this.sourceValue.set(source);
    try {
      window.localStorage.setItem(UPDATE_SOURCE_STORAGE_KEY, source);
    } catch {
      // The choice still applies during this session.
    }
  }

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
    if (!isTauriRuntime() || this.downloading() || this.installing()) return null;
    if (this.checkInFlight) return this.checkInFlight;

    this.checkingValue.set(true);
    this.errorValue.set(null);
    const request = invoke<UpdateCheck>('check_for_update', { preferChina: this.preferChina() });
    this.checkInFlight = request;
    try {
      const result = await request;
      if (result.latestVersion !== this.resultValue()?.latestVersion) {
        this.installerOpened.set(false);
        this.operationError.set(null);
      }
      this.resultValue.set(result);
      return result;
    } catch (error) {
      this.errorValue.set(this.describeError(error));
      throw error;
    } finally {
      this.checkInFlight = undefined;
      this.checkingValue.set(false);
    }
  }

  async openReleasePage(): Promise<void> {
    const url = this.resultValue()?.releaseUrl;
    if (!url) {
      return;
    }
    this.operationError.set(null);
    try {
      if (isTauriRuntime()) {
        await invoke('open_release_page', { url });
      } else {
        window.open(url, '_blank', 'noopener');
      }
    } catch (error) {
      this.operationError.set(this.describeError(error));
    }
  }

  async download(): Promise<void> {
    const result = this.resultValue();
    if (!isTauriRuntime() || !result?.updateAvailable || result.installMethod === 'manual' ||
        this.checkingValue() || this.downloading() || this.installing() || this.ready()) return;

    this.downloading.set(true);
    this.installerOpened.set(false);
    this.operationError.set(null);
    this.progress.set(null);
    try {
      const progress = new Channel<UpdateProgress>((event) => this.progress.set(event));
      await invoke('download_update', {
        version: result.latestVersion,
        preferChina: this.preferChina(),
        progress,
      });
      this.downloadedVersion.set(result.latestVersion);
    } catch (error) {
      this.operationError.set(this.describeError(error));
    } finally {
      this.downloading.set(false);
    }
  }

  async install(): Promise<void> {
    const version = this.downloadedVersion();
    if (!isTauriRuntime() || !version || !this.ready() || this.checkingValue() || this.installing()) return;

    this.installing.set(true);
    this.operationError.set(null);
    try {
      const method = await invoke<InstallMethod>('install_downloaded_update', { version });
      this.installerOpened.set(method === 'openInstaller');
    } catch (error) {
      this.downloadedVersion.set(null);
      this.operationError.set(this.describeError(error));
    } finally {
      this.installing.set(false);
    }
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
