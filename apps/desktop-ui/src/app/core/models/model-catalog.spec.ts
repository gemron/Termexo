import { describe, expect, it } from 'vitest';
import {
  catalogChoices,
  modelUpgrades,
  parsePublicCatalog,
  type CatalogModel,
} from './model-catalog';
import type { ModelProfile } from './agent.models';

export const oldModel: CatalogModel = {
  provider: 'OpenAI',
  id: 'gpt-old-sol',
  name: 'Old',
  family: 'gpt-sol',
  releaseDate: '2025-01-01',
  retired: false,
};
export const newModel: CatalogModel = {
  ...oldModel,
  id: 'gpt-new-sol',
  name: 'New',
  releaseDate: '2026-01-01',
};
export const profile: ModelProfile = {
  id: 'default-codex',
  name: 'Codex',
  provider: 'OpenAI',
  isDefault: true,
  hasCredential: true,
  claudeEnabled: false,
  claudeModel: '',
  codexEnabled: true,
  codexModel: oldModel.id,
  codexReasoningEffort: 'high',
};

describe('model catalog upgrades', () => {
  it('suggests the newest release in the same family without modifying the default', () => {
    const latest = { ...newModel, id: 'gpt-latest-sol', releaseDate: '2026-02-01' };
    const offers = modelUpgrades([profile], [oldModel, latest, newModel]);
    expect(offers).toHaveLength(1);
    expect(offers[0].model.id).toBe(latest.id);
    expect(profile.codexModel).toBe(oldModel.id);
  });

  it('does not replace a model with another tier, an older, retired, or future model', () => {
    expect(
      modelUpgrades(
        [profile],
        [
          oldModel,
          { ...newModel, family: 'gpt-luna' },
          { ...newModel, retired: true },
          { ...newModel, releaseDate: '2099-01-01' },
          { ...newModel, releaseDate: '2024-01-01' },
        ],
      ),
    ).toEqual([]);
  });

  it('uses the CLI upgrade relationship even when family metadata is unavailable', () => {
    expect(
      modelUpgrades([profile], [{ ...oldModel, family: '', upgradeTo: newModel.id }, newModel])[0]
        .model.id,
    ).toBe(newModel.id);
  });

  it('keeps moving aliases and custom gateways unchanged', () => {
    expect(modelUpgrades([{ ...profile, codexModel: 'auto' }], [oldModel, newModel])).toEqual([]);
    expect(
      modelUpgrades(
        [{ ...profile, codexBaseUrl: 'https://gateway.test/v1' }],
        [oldModel, newModel],
      ),
    ).toEqual([]);
  });

  it('only offers updates for each agent’s effective default', () => {
    expect(
      modelUpgrades(
        [{ ...profile, id: 'other', isDefault: false }, profile],
        [oldModel, newModel],
      ).map((o) => o.profileId),
    ).toEqual([profile.id]);
    expect(modelUpgrades([{ ...profile, isDefault: false }], [oldModel, newModel])).toHaveLength(1);
  });

  it('preserves an explicit 1m suffix and does not offer the same model again', () => {
    expect(
      modelUpgrades([{ ...profile, codexModel: oldModel.id + '[1m]' }], [oldModel, newModel])[0]
        .model.id,
    ).toBe(newModel.id + '[1m]');
    expect(modelUpgrades([{ ...profile, codexModel: newModel.id }], [oldModel, newModel])).toEqual(
      [],
    );
  });

  it('filters model choices by provider, agent, lifecycle and release date', () => {
    expect(
      catalogChoices([oldModel, newModel, { ...newModel, retired: true }], 'OpenAI', 'codex').map(
        (m) => m.id,
      ),
    ).toEqual([newModel.id, oldModel.id]);
    expect(catalogChoices([oldModel], 'OpenAI', 'claude')).toEqual([]);
  });

  it('accepts model metadata without copying unrelated API data', () => {
    const parsed = parsePublicCatalog({
      openai: {
        models: {
          good: {
            id: newModel.id,
            name: 'New',
            family: 'gpt-sol',
            tool_call: true,
            release_date: '2026-01-01',
            secret: 'not copied',
          },
          bad: { id: 'bad;command', tool_call: true },
          image: { id: 'image', tool_call: false },
        },
      },
    });
    expect(parsed).toEqual([newModel]);
  });
});
