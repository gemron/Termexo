import type { AccountAgentType } from './agent.models';

export type AccountLoginMethod = 'browser' | 'console' | 'sso' | 'device-code' | 'interactive';

export interface AccountLoginOption {
  id: AccountLoginMethod;
  labelKey: string;
  helpKey: string;
  command: string;
}

export const ACCOUNT_LOGIN_OPTIONS: Record<AccountAgentType, readonly AccountLoginOption[]> = {
  claude: [
    {
      id: 'browser',
      labelKey: 'account.method.claudeBrowser',
      helpKey: 'account.method.claudeBrowserHelp',
      command: 'claude auth login',
    },
    {
      id: 'console',
      labelKey: 'account.method.console',
      helpKey: 'account.method.consoleHelp',
      command: 'claude auth login --console',
    },
    {
      id: 'sso',
      labelKey: 'account.method.sso',
      helpKey: 'account.method.ssoHelp',
      command: 'claude auth login --sso',
    },
  ],
  codex: [
    {
      id: 'browser',
      labelKey: 'account.method.codexBrowser',
      helpKey: 'account.method.codexBrowserHelp',
      command: 'codex login',
    },
    {
      id: 'device-code',
      labelKey: 'account.method.deviceCode',
      helpKey: 'account.method.deviceCodeHelp',
      command: 'codex login --device-auth',
    },
  ],
  opencode: [
    {
      id: 'browser',
      labelKey: 'account.method.opencodeBrowser',
      helpKey: 'account.method.opencodeBrowserHelp',
      command: 'opencode auth login',
    },
  ],
  pi: [
    {
      id: 'interactive',
      labelKey: 'account.method.piInteractive',
      helpKey: 'account.method.piInteractiveHelp',
      command: 'pi',
    },
  ],
  grok: [
    {
      id: 'browser',
      labelKey: 'account.method.grokBrowser',
      helpKey: 'account.method.grokBrowserHelp',
      command: 'grok login',
    },
    {
      id: 'device-code',
      labelKey: 'account.method.grokDeviceCode',
      helpKey: 'account.method.grokDeviceCodeHelp',
      command: 'grok login --device-auth',
    },
  ],
};

export function accountLoginOption(
  agent: AccountAgentType,
  method?: AccountLoginMethod,
): AccountLoginOption {
  return (
    ACCOUNT_LOGIN_OPTIONS[agent].find((option) => option.id === method) ??
    ACCOUNT_LOGIN_OPTIONS[agent][0]
  );
}
