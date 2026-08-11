import {
  findProviderPreset,
  groupProfilesByProvider,
  isNativeModel,
  ModelProfile,
  needsCredential,
  PROVIDER_PRESETS,
} from './agent.models';

const profile = (id: string, provider: string, overrides: Partial<ModelProfile> = {}) =>
  ({
    id,
    name: provider,
    provider,
    isDefault: false,
    hasCredential: false,
    claudeEnabled: true,
    claudeModel: 'model',
    codexEnabled: true,
    codexModel: 'model',
    ...overrides,
  }) satisfies ModelProfile;

describe('provider presets', () => {
  it('uses the provider model id for MiniMax M3 without a context annotation', () => {
    expect(findProviderPreset('MiniMax')).toEqual(
      expect.objectContaining({
        claudeModel: 'MiniMax-M3',
        claudeBaseUrl: 'https://api.minimaxi.com/anthropic',
      }),
    );
  });

  it('points each agent at the path its own protocol is served on', () => {
    for (const preset of PROVIDER_PRESETS) {
      if (!preset.claudeBaseUrl || !preset.codexBaseUrl) {
        continue;
      }
      // Sharing one URL would send an agent to the other protocol's endpoint.
      expect(preset.claudeBaseUrl).not.toBe(preset.codexBaseUrl);
    }
  });

  it('covers every provider the settings dialog offers, including a blank custom entry', () => {
    const providers = PROVIDER_PRESETS.map((preset) => preset.provider);

    expect(providers).toEqual(
      expect.arrayContaining(['DeepSeek', 'MiniMax', 'GLM', 'Kimi', 'SCNet', 'Custom']),
    );
  });

  it('matches a provider regardless of the casing a stored profile used', () => {
    expect(findProviderPreset('deepseek')?.provider).toBe('DeepSeek');
  });
});

describe('groupProfilesByProvider', () => {
  it('groups profiles under their provider in preset order', () => {
    const groups = groupProfilesByProvider([
      profile('a', 'Kimi'),
      profile('b', 'DeepSeek'),
      profile('c', 'Kimi'),
    ]);

    expect(groups.map((group) => group.provider)).toEqual(['DeepSeek', 'Kimi']);
    expect(groups[1].profiles.map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('sorts a provider with no preset after the known ones', () => {
    const groups = groupProfilesByProvider([profile('a', 'HomeGrown'), profile('b', 'GLM')]);

    expect(groups.map((group) => group.provider)).toEqual(['GLM', 'HomeGrown']);
  });
});

describe('needsCredential', () => {
  it('only asks for a key on the side that goes through a compatibility endpoint', () => {
    const mixed = profile('mixed', 'Anthropic', {
      claudeBaseUrl: undefined,
      codexBaseUrl: 'https://api.example.test/v1',
    });

    expect(needsCredential(mixed, 'claude')).toBe(false);
    expect(needsCredential(mixed, 'codex')).toBe(true);
  });

  it('is satisfied once the profile has a stored key', () => {
    const stored = profile('stored', 'GLM', {
      claudeBaseUrl: 'https://open.bigmodel.cn/api/anthropic',
      hasCredential: true,
    });

    expect(needsCredential(stored, 'claude')).toBe(false);
  });
});

describe('isNativeModel', () => {
  it('treats each vendor as native only for the agent it builds', () => {
    const anthropic = profile('anthropic', 'Anthropic');
    const openai = profile('openai', 'OpenAI');

    expect(isNativeModel(anthropic, 'claude')).toBe(true);
    expect(isNativeModel(anthropic, 'codex')).toBe(false);
    expect(isNativeModel(openai, 'codex')).toBe(true);
  });

  it('stops being native once that side points at an endpoint of our own', () => {
    const proxied = profile('anthropic', 'Anthropic', {
      claudeBaseUrl: 'https://gateway.example.test/anthropic',
    });

    expect(isNativeModel(proxied, 'claude')).toBe(false);
  });
});
