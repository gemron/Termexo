import { findProviderPreset, type AgentProtocol, type ModelProfile } from './agent.models';

export interface CatalogModel {
  provider: string;
  id: string;
  name: string;
  family: string;
  releaseDate: string;
  retired: boolean;
  upgradeTo?: string | null;
}

export interface ModelUpgrade {
  key: string;
  profileId: string;
  agent: AgentProtocol;
  current: string;
  model: CatalogModel;
}

const PROVIDERS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  zhipuai: 'GLM',
  moonshotai: 'Kimi',
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MODEL_ID = /^[a-zA-Z0-9._:/-]{1,200}$/;

export function isCatalogModel(value: unknown): value is CatalogModel {
  if (!value || typeof value !== 'object') return false;
  const model = value as CatalogModel;
  return (
    Object.values(PROVIDERS).includes(model.provider) &&
    typeof model.id === 'string' &&
    MODEL_ID.test(model.id) &&
    typeof model.name === 'string' &&
    typeof model.family === 'string' &&
    typeof model.releaseDate === 'string' &&
    typeof model.retired === 'boolean' &&
    (model.upgradeTo == null ||
      (typeof model.upgradeTo === 'string' && MODEL_ID.test(model.upgradeTo)))
  );
}

/** Browser preview uses the same public directory without needing a desktop backend. */
export function parsePublicCatalog(value: unknown): CatalogModel[] {
  if (!value || typeof value !== 'object') return [];
  const result: CatalogModel[] = [];
  for (const [key, provider] of Object.entries(PROVIDERS)) {
    const models = (value as Record<string, { models?: Record<string, Record<string, unknown>> }>)[
      key
    ]?.models;
    for (const model of Object.values(models ?? {})) {
      if (model['tool_call'] !== true || String(model['id']).includes('realtime')) continue;
      const item = {
        provider,
        id: model['id'],
        name: model['name'] ?? model['id'],
        family: model['family'] ?? '',
        releaseDate: model['release_date'] ?? '',
        retired: ['deprecated', 'alpha', 'beta'].includes(String(model['status'])),
      };
      if (isCatalogModel(item)) result.push(item);
    }
  }
  return result;
}

export function catalogChoices(
  models: readonly CatalogModel[],
  provider: string,
  agent: AgentProtocol,
): CatalogModel[] {
  if (
    (provider === 'Anthropic' && agent !== 'claude') ||
    (provider === 'OpenAI' && agent !== 'codex')
  )
    return [];
  const today = new Date().toISOString().slice(0, 10);
  return models
    .filter(
      (model) =>
        model.provider.toLowerCase() === provider.toLowerCase() &&
        !model.id.includes('realtime') &&
        !model.retired &&
        (!model.releaseDate || model.releaseDate <= today),
    )
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name));
}

export function modelUpgrades(
  profiles: readonly ModelProfile[],
  models: readonly CatalogModel[],
): ModelUpgrade[] {
  const result: ModelUpgrade[] = [];
  for (const profile of profiles) {
    const preset = findProviderPreset(profile.provider);
    if (!preset) continue;
    for (const agent of ['claude', 'codex'] as const) {
      if (!(agent === 'claude' ? profile.claudeEnabled : profile.codexEnabled)) continue;
      const enabled = profiles.filter((p) =>
        agent === 'claude' ? p.claudeEnabled : p.codexEnabled,
      );
      if ((enabled.find((p) => p.isDefault) ?? enabled[0])?.id !== profile.id) continue;
      const endpoint = agent === 'claude' ? profile.claudeBaseUrl : profile.codexBaseUrl;
      const expectedEndpoint = agent === 'claude' ? preset.claudeBaseUrl : preset.codexBaseUrl;
      // A gateway can expose a different catalog from the provider it is named after.
      if ((endpoint ?? '').replace(/\/$/, '') !== expectedEndpoint.replace(/\/$/, '')) continue;
      const current = agent === 'claude' ? profile.claudeModel : profile.codexModel;
      const suffix = current.endsWith('[1m]') ? '[1m]' : '';
      const currentId = current.slice(0, current.length - suffix.length);
      const known = models.find((m) => m.provider === preset.provider && m.id === currentId);
      if (!known) continue; // Native moving aliases and custom model ids need no migration.
      const choices = catalogChoices(models, preset.provider, agent);
      const replacement =
        choices.find((m) => m.id === known.upgradeTo) ??
        (known.family && DATE.test(known.releaseDate)
          ? choices.find(
              (m) =>
                m.family === known.family &&
                DATE.test(m.releaseDate) &&
                m.releaseDate > known.releaseDate,
            )
          : undefined);
      if (!replacement || replacement.id === known.id) continue;
      result.push({
        key: `${profile.id}:${agent}:${current}:${replacement.id}`,
        profileId: profile.id,
        agent,
        current,
        model: { ...replacement, id: replacement.id + suffix },
      });
    }
  }
  return result;
}
