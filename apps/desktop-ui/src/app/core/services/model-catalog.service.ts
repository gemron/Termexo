import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import {
  catalogChoices,
  isCatalogModel,
  modelUpgrades,
  parsePublicCatalog,
  type CatalogModel,
  type ModelUpgrade,
} from '../models/model-catalog';
import type { AgentProtocol } from '../models/agent.models';
import { AgentService } from './agent.service';
import { invoke } from './backend-bridge';
import { hasBackend } from './tauri-runtime';

const CACHE_KEY = 'termexo.model-catalog.v1';
const DISMISSED_KEY = 'termexo.model-upgrades.dismissed';
const MAX_AGE = 24 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class ModelCatalogService {
  private readonly agents = inject(AgentService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly items = signal<CatalogModel[]>([]);
  private readonly dismissed = signal<string[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly updatedAt = signal(0);
  readonly models = this.items.asReadonly();
  readonly upgrades = computed(() =>
    modelUpgrades(this.agents.modelProfiles(), this.items()).filter(
      (upgrade) => !this.dismissed().includes(upgrade.key),
    ),
  );
  private pending: Promise<void> | null = null;
  private initialized = false;

  constructor() {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
      if (
        Array.isArray(cache?.models) &&
        cache.models.every(isCatalogModel) &&
        Number.isFinite(cache.updatedAt)
      ) {
        this.items.set(cache.models);
        this.updatedAt.set(Math.min(Date.now(), cache.updatedAt));
      }
      const dismissed: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
      if (Array.isArray(dismissed))
        this.dismissed.set(dismissed.filter((value) => typeof value === 'string'));
    } catch {
      /* Corrupt or unavailable storage must not prevent opening the app. */
    }
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    void this.refresh();
    const timer = window.setInterval(() => void this.refresh(), 60 * 60 * 1000);
    this.destroyRef.onDestroy(() => window.clearInterval(timer));
  }

  choices(provider: string, agent: AgentProtocol): CatalogModel[] {
    return catalogChoices(this.items(), provider, agent);
  }

  dismiss(upgrade: ModelUpgrade): void {
    this.dismissed.update((keys) =>
      [...keys.filter((key) => key !== upgrade.key), upgrade.key].slice(-200),
    );
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(this.dismissed()));
    } catch {
      /* optional persistence */
    }
  }

  refresh(force = false): Promise<void> {
    if (this.pending) return this.pending;
    if (!force && this.items().length && Date.now() - this.updatedAt() < MAX_AGE)
      return Promise.resolve();
    this.loading.set(true);
    this.error.set(null);
    this.pending = this.load().finally(() => {
      this.loading.set(false);
      this.pending = null;
    });
    return this.pending;
  }

  private async load(): Promise<void> {
    try {
      const result = hasBackend()
        ? await invoke<{ models: CatalogModel[]; warning?: string | null }>('read_model_catalog')
        : {
            models: parsePublicCatalog(
              await (
                await fetch('https://models.dev/api.json', { signal: AbortSignal.timeout(15000) })
              ).json(),
            ),
          };
      if (!Array.isArray(result.models) || !result.models.every(isCatalogModel))
        throw new Error('Invalid model catalog');
      if (result.warning) {
        // Keep the last public metadata while still accepting new models from the local CLI.
        const merged = new Map(
          this.items().map((model) => [`${model.provider}:${model.id}`, model]),
        );
        for (const model of result.models) {
          const key = `${model.provider}:${model.id}`;
          merged.set(key, {
            ...merged.get(key),
            ...model,
            family: model.family || merged.get(key)?.family || '',
            releaseDate: model.releaseDate || merged.get(key)?.releaseDate || '',
          });
        }
        this.items.set([...merged.values()]);
        this.error.set(result.warning);
      } else {
        if (!result.models.length) throw new Error('Empty model catalog');
        this.items.set(result.models);
        this.updatedAt.set(Date.now());
      }
      try {
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ models: this.items(), updatedAt: this.updatedAt() }),
        );
      } catch {
        /* optional cache */
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }
}
