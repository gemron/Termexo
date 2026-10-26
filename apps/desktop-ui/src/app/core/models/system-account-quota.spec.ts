import type { AccountProfile, ProviderQuota } from './agent.models';
import { nameSystemAccountQuotas } from './system-account-quota';

const account = (id: string, name: string, isSystem: boolean): AccountProfile => ({
  id,
  name,
  agentType: 'claude',
  isDefault: isSystem,
  isSystem,
  authenticated: true,
  diagnostic: '',
});

const quota = (profileId: string, profileName: string): ProviderQuota => ({
  profileId,
  profileName,
  provider: 'Claude Code',
  official: true,
  entries: [],
  checkedAt: 0,
});

describe('nameSystemAccountQuotas', () => {
  it('uses the interface-language name for a system account and leaves the rest alone', () => {
    const accounts = [
      account('claude-system', 'System-Konto von Claude', true),
      account('work', 'Work', false),
    ];

    const named = nameSystemAccountQuotas(
      [
        quota('agent:claude-system', '系统 Claude 账号'),
        quota('agent:work', 'Work'),
        quota('model-profile', 'Custom'),
      ],
      accounts,
    );

    expect(named.map((item) => item.profileName)).toEqual([
      'System-Konto von Claude',
      'Work',
      'Custom',
    ]);
  });
});
