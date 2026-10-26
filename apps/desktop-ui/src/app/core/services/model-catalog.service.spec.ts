import { TestBed } from '@angular/core/testing';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ModelCatalogService } from './model-catalog.service';
import { AgentService } from './agent.service';
import type { CatalogModel } from '../models/model-catalog';

const invoke = vi.fn<(command: string) => Promise<unknown>>();
const oldModel: CatalogModel = {
  provider: 'OpenAI',
  id: 'gpt-old-sol',
  name: 'Old',
  family: 'gpt-sol',
  releaseDate: '2025-01-01',
  retired: false,
};
const newModel = { ...oldModel, id: 'gpt-new-sol', releaseDate: '2026-01-01' };
const key = 'termexo.model-catalog.v1';

describe('ModelCatalogService', () => {
  beforeEach(() => {
    localStorage.removeItem(key);
    localStorage.removeItem('termexo.model-upgrades.dismissed');
    vi.mocked(invoke).mockReset();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: { invoke }, configurable: true });
  });
  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    vi.unstubAllGlobals();
  });

  it('uses the daily cache and only makes a request when forced', async () => {
    localStorage.setItem(key, JSON.stringify({ models: [oldModel], updatedAt: Date.now() }));
    const service = TestBed.inject(ModelCatalogService);
    await service.refresh();
    expect(invoke).not.toHaveBeenCalled();
    vi.mocked(invoke).mockResolvedValue({ models: [oldModel, newModel] });
    await service.refresh(true);
    expect(invoke.mock.calls.map((call) => call[0])).toEqual(['read_model_catalog']);
    expect(service.choices('OpenAI', 'codex')[0].id).toBe(newModel.id);
  });

  it('deduplicates pending checks and preserves cached models on failure', async () => {
    localStorage.setItem(key, JSON.stringify({ models: [oldModel], updatedAt: 1 }));
    let reject!: (error: Error) => void;
    vi.mocked(invoke).mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const service = TestBed.inject(ModelCatalogService);
    const pending = service.refresh();
    expect(service.refresh(true)).toBe(pending);
    reject(new Error('offline'));
    await pending;
    expect(service.models()).toEqual([oldModel]);
    expect(service.error()).toBe('offline');
    expect(service.loading()).toBe(false);
    expect(service.updatedAt()).toBe(1);
  });

  it('merges a local CLI list into offline metadata without losing release dates', async () => {
    localStorage.setItem(key, JSON.stringify({ models: [oldModel], updatedAt: 1 }));
    vi.mocked(invoke).mockResolvedValue({
      models: [{ ...oldModel, family: '', releaseDate: '', upgradeTo: newModel.id }, newModel],
      warning: 'offline',
    });
    const service = TestBed.inject(ModelCatalogService);
    await service.refresh(true);
    expect(service.models()[0]).toEqual({ ...oldModel, upgradeTo: newModel.id });
    expect(service.updatedAt()).toBe(1);
    expect(service.error()).toBe('offline');
  });

  it('dismisses only the current upgrade and remembers that choice across restarts', async () => {
    vi.mocked(invoke).mockResolvedValue({ models: [oldModel, newModel] });
    const service = TestBed.inject(ModelCatalogService);
    TestBed.inject(AgentService)['modelProfileItems'].set([
      {
        id: 'default',
        name: 'Default',
        provider: 'OpenAI',
        isDefault: true,
        hasCredential: false,
        claudeEnabled: false,
        claudeModel: '',
        codexEnabled: true,
        codexModel: oldModel.id,
      },
    ]);
    await service.refresh(true);
    expect(service.upgrades()).toHaveLength(1);
    service.dismiss(service.upgrades()[0]);
    expect(service.upgrades()).toEqual([]);
    expect(JSON.parse(localStorage.getItem('termexo.model-upgrades.dismissed')!)).toHaveLength(1);
  });

  it('rejects a malformed catalog without replacing the last usable list', async () => {
    localStorage.setItem(key, JSON.stringify({ models: [oldModel], updatedAt: 1 }));
    vi.mocked(invoke).mockResolvedValue({ models: [{ id: 'invalid' }] });
    const service = TestBed.inject(ModelCatalogService);
    await service.refresh(true);
    expect(service.models()).toEqual([oldModel]);
    expect(service.error()).toBeTruthy();
  });

  it('moves the upgrade prompt to the newly saved default profile', async () => {
    const original = {
      id: 'old-default',
      name: 'Old default',
      provider: 'OpenAI',
      isDefault: true,
      hasCredential: false,
      claudeEnabled: false,
      claudeModel: '',
      codexEnabled: true,
      codexModel: oldModel.id,
    };
    const next = { ...original, id: 'new-default', name: 'New default', isDefault: false };
    const agents = TestBed.inject(AgentService);
    const service = TestBed.inject(ModelCatalogService);
    agents['modelProfileItems'].set([original, next]);
    service['items'].set([oldModel, newModel]);
    expect(service.upgrades().map((upgrade) => upgrade.profileId)).toEqual([original.id]);
    vi.mocked(invoke).mockResolvedValue({ ...next, isDefault: true });
    await agents.saveModelProfile({ ...next, isDefault: true });
    expect(agents.modelProfiles().find((profile) => profile.id === original.id)?.isDefault).toBe(
      false,
    );
    expect(service.upgrades().map((upgrade) => upgrade.profileId)).toEqual([next.id]);
  });
});
