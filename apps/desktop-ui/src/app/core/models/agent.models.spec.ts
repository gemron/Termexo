import {
  AccountProfile,
  compatibleNativeSessionId,
  findProviderPreset,
  groupProfilesByProvider,
  isNativeModel,
  ModelProfile,
  needsCredential,
  PROVIDER_PRESETS,
  resolveAccountProfileId,
  terminalAccountName,
} from './agent.models';

describe('compatibleNativeSessionId', () => {
  it('rejects a session proven to belong to the other Agent', () => {
    expect(
      compatibleNativeSessionId(
        'codex',
        'claude-session',
        undefined,
        [],
        [{ agentType: 'claude', nativeSessionId: 'claude-session' }],
      ),
    ).toBeUndefined();
  });

  it('retains compatible and unknown legacy sessions', () => {
    expect(compatibleNativeSessionId('codex', 'codex-session', 'codex', [], [])).toBe(
      'codex-session',
    );
    expect(compatibleNativeSessionId('codex', 'legacy-session', undefined, [], [])).toBe(
      'legacy-session',
    );
  });
});

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

const account = (
  id: string,
  agentType: AccountProfile['agentType'],
  isDefault = false,
): AccountProfile => ({
  id,
  name: id,
  agentType,
  isDefault,
  isSystem: false,
  authenticated: true,
  diagnostic: '',
});

describe('resolveAccountProfileId', () => {
  const accounts = [
    account('claude-system', 'claude', true),
    account('claude-work', 'claude'),
    account('codex-work', 'codex'),
  ];

  it('keeps an explicit choice that still belongs to the agent', () => {
    expect(resolveAccountProfileId(accounts, 'claude', 'claude-work')).toBe('claude-work');
  });

  it('falls back to the agent default when nothing was chosen', () => {
    expect(resolveAccountProfileId(accounts, 'claude')).toBe('claude-system');
  });

  it('ignores a choice belonging to the other agent', () => {
    expect(resolveAccountProfileId(accounts, 'codex', 'claude-work')).toBe('codex-work');
  });

  it('uses the only account of an agent that has no default', () => {
    expect(resolveAccountProfileId(accounts, 'codex')).toBe('codex-work');
  });

  it('reports nothing when the agent has no account at all', () => {
    expect(resolveAccountProfileId([account('codex-work', 'codex')], 'claude')).toBeUndefined();
  });
});

describe('terminalAccountName', () => {
  const accounts = [
    { ...account('claude-system', 'claude', true), name: '系统 Claude 账号' },
    { ...account('claude-work', 'claude'), name: '工作账号' },
    { ...account('codex-work', 'codex'), name: 'Codex 账号' },
  ];

  it('names the account a terminal recorded when it launched', () => {
    expect(terminalAccountName(accounts, 'claude', 'claude-work')).toBe('工作账号');
  });

  it('names the default a terminal restored without an account actually falls back to', () => {
    expect(terminalAccountName(accounts, 'claude')).toBe('系统 Claude 账号');
  });

  it('names nothing for agents that run on no account of their own', () => {
    expect(terminalAccountName(accounts, 'shell')).toBe('');
    expect(terminalAccountName(accounts, 'opencode')).toBe('');
  });

  it('names nothing when the agent has no account configured at all', () => {
    expect(terminalAccountName([], 'claude')).toBe('');
  });
});
