import type { AccountProfile, ProviderQuota } from './agent.models';

/** The backend files an account's allowance under this prefix plus the account id. */
const ACCOUNT_QUOTA_PREFIX = 'agent:';

/**
 * Names the allowance cards of the system accounts the way the accounts themselves are named.
 *
 * The backend sends the name it seeded them with, which is Chinese; `accounts` already carry the
 * name for the language the interface is showing.
 */
export function nameSystemAccountQuotas(
  quotas: readonly ProviderQuota[],
  accounts: readonly AccountProfile[],
): ProviderQuota[] {
  const systemNames = new Map(
    accounts
      .filter((account) => account.isSystem)
      .map((account) => [`${ACCOUNT_QUOTA_PREFIX}${account.id}`, account.name]),
  );
  return quotas.map((quota) => {
    const name = systemNames.get(quota.profileId);
    return name === undefined ? quota : { ...quota, profileName: name };
  });
}
