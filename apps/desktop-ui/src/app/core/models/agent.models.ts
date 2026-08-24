import { TerminalStatus } from './workspace.models';

export type NativeAgentType = 'claude' | 'codex' | 'opencode';
export type AccountAgentType = 'claude' | 'codex';

export interface AgentInstallation {
  agentType: NativeAgentType;
  installed: boolean;
  executablePath?: string;
  version?: string;
  healthy: boolean;
  diagnostic: string;
}

export interface AgentSession {
  id: string;
  agentType: NativeAgentType;
  nativeSessionId: string;
  accountProfileId?: string;
  projectPath?: string;
  modelName?: string;
  title: string;
  summary?: string;
  branch?: string;
  status: string;
  messageCount: number;
  transcriptPath: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface AgentEvent {
  eventKey: string;
  agentType: NativeAgentType;
  nativeSessionId?: string;
  terminalId: string;
  eventType: string;
  detail: Record<string, unknown>;
  createdAt: number;
}

export interface AgentLaunchSpec {
  command: string;
  executablePath: string;
}

export interface CliOperationRequest {
  agentType: NativeAgentType;
  targetVersion?: string;
  workspaceId?: string;
  confirmed?: boolean;
}

export interface CliOperationPlan {
  agentType: NativeAgentType;
  displayName: string;
  packageName: string;
  targetVersion: string;
  packageSpec: string;
  /** `reinstall` when the installed version already matches the resolved one. */
  action: 'install' | 'upgrade' | 'reinstall';
  currentVersion?: string;
  /** Version the registry resolves the target to, when it could be queried. */
  resolvedVersion?: string;
  upToDate: boolean;
  npmPath?: string;
  npmVersion?: string;
  commandPreview: string;
  networkProfileId?: string;
  networkProfileName?: string;
  npmRegistry?: string;
  ready: boolean;
  diagnostic: string;
}

export interface CliOperationResult {
  success: boolean;
  plan: CliOperationPlan;
  installation: AgentInstallation;
  stdout: string;
  stderr: string;
  durationMs: number;
  diagnostic: string;
  rollbackAttempted: boolean;
  rollbackSucceeded?: boolean;
  rollbackDiagnostic?: string;
}

/**
 * What a provider charges against: money for the pay-as-you-go providers, tokens or requests for
 * the ones that sell a plan.
 */
export type QuotaUnit = 'currency' | 'tokens' | 'requests' | 'percent';

/** One allowance line — a balance, or one of the windows a plan is capped on. */
export interface QuotaEntry {
  label: string;
  unit: QuotaUnit;
  currency?: string;
  total?: number;
  used?: number;
  remaining?: number;
  /** Consumed share, 0-100. */
  percent?: number;
  resetsAt?: number;
}

/**
 * What a provider reports for one model profile.
 *
 * Every number here comes from the provider itself. When it cannot be read — the provider offers
 * no endpoint, the key is missing, the request failed — `entries` is empty and `diagnostic` says
 * why, because a locally guessed allowance is worse than none.
 */
export interface ProviderQuota {
  profileId: string;
  profileName: string;
  provider: string;
  /** False when the endpoint is not part of the provider's published documentation. */
  official: boolean;
  entries: QuotaEntry[];
  checkedAt: number;
  diagnostic?: string;
}

export interface ClaudeLaunchRequest {
  terminalId: string;
  workspaceId?: string;
  sessionId?: string;
  name?: string;
  profileId?: string;
  mcpProfileId?: string;
  accountProfileId?: string;
}

export interface CodexLaunchRequest {
  terminalId: string;
  workspaceId?: string;
  sessionId?: string;
  model?: string;
  profileId?: string;
  accountProfileId?: string;
}

export interface OpenCodeLaunchRequest {
  terminalId: string;
  workspaceId?: string;
  sessionId?: string;
  model?: string;
  continueLast?: boolean;
}

export interface AccountLoginRequest {
  terminalId: string;
  workspaceId?: string;
  accountProfileId: string;
}

export interface AccountProfile {
  id: string;
  name: string;
  agentType: AccountAgentType;
  configDir?: string;
  isDefault: boolean;
  isSystem: boolean;
  authenticated: boolean;
  diagnostic: string;
}

export interface AccountProfileInput {
  id: string;
  name: string;
  agentType: AccountAgentType;
  isDefault: boolean;
}

export type AgentProtocol = AccountAgentType;

/**
 * One provider's credentials plus the endpoint each agent reaches it through.
 *
 * A provider answers Claude over the Anthropic protocol and Codex over the OpenAI one, usually at
 * different paths on the same host, so both sides live here and either can be switched off. The
 * API key is shared: the provider issues it, not the protocol.
 */
export interface ModelProfile {
  id: string;
  name: string;
  provider: string;
  credentialTarget?: string;
  isDefault: boolean;
  hasCredential: boolean;
  claudeEnabled: boolean;
  claudeModel: string;
  claudeBaseUrl?: string;
  codexEnabled: boolean;
  codexModel: string;
  codexBaseUrl?: string;
  /** Share of the provider-reported allowance at which the UI warns. */
  planAlertThreshold?: number;
}

export interface ModelProfileInput {
  id: string;
  name: string;
  provider: string;
  apiKey?: string;
  clearCredential?: boolean;
  isDefault: boolean;
  claudeEnabled: boolean;
  claudeModel: string;
  claudeBaseUrl?: string;
  codexEnabled: boolean;
  codexModel: string;
  codexBaseUrl?: string;
  /** Share of the provider-reported allowance at which the UI warns. */
  planAlertThreshold?: number;
}

/** What a provider's published API docs say each agent should be pointed at. */
export interface ProviderPreset {
  /** Stable key used to group profiles and to look a preset back up. */
  provider: string;
  label: string;
  claudeModel: string;
  claudeBaseUrl: string;
  codexModel: string;
  codexBaseUrl: string;
  /** Where these values came from, shown so the user can check them against the source. */
  docsUrl?: string;
}

/** Returned for a profile that matches no preset, so the form always has a shape to fill. */
export const CUSTOM_PROVIDER = 'Custom';

/** Reads the model a profile offers one agent. */
export function profileModel(profile: ModelProfile, agent: AgentProtocol): string {
  return agent === 'claude' ? profile.claudeModel : profile.codexModel;
}

/** Reads the endpoint a profile offers one agent; empty means the provider's official host. */
export function profileBaseUrl(profile: ModelProfile, agent: AgentProtocol): string | undefined {
  return agent === 'claude' ? profile.claudeBaseUrl : profile.codexBaseUrl;
}

export function profileServes(profile: ModelProfile, agent: AgentProtocol): boolean {
  return agent === 'claude' ? profile.claudeEnabled : profile.codexEnabled;
}

/**
 * Whether launching this agent would hit a third-party endpoint with no key to authenticate.
 *
 * Only the side being launched matters: a profile may reach one agent through the vendor's own
 * host, which needs no key of ours, while the other goes through a compatibility endpoint.
 */
export function needsCredential(profile: ModelProfile, agent: AgentProtocol): boolean {
  return Boolean(profileBaseUrl(profile, agent)) && !profile.hasCredential;
}

/**
 * Endpoint parameters taken from each provider's published API documentation.
 *
 * The official Anthropic and OpenAI entries carry no base URL: their agent already talks to them
 * directly, and only one side applies. Everyone else exposes both protocols on the same host under
 * different paths, so selecting one fills in both agents at once.
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    provider: 'Anthropic',
    label: 'Anthropic 官方',
    claudeModel: 'sonnet',
    claudeBaseUrl: '',
    codexModel: '',
    codexBaseUrl: '',
  },
  {
    provider: 'OpenAI',
    label: 'OpenAI 官方',
    claudeModel: '',
    claudeBaseUrl: '',
    codexModel: 'gpt-5.6-sol',
    codexBaseUrl: '',
  },
  {
    provider: 'DeepSeek',
    label: 'DeepSeek 深度求索',
    claudeModel: 'deepseek-v4-pro[1m]',
    claudeBaseUrl: 'https://api.deepseek.com/anthropic',
    codexModel: 'deepseek-v4',
    codexBaseUrl: 'https://api.deepseek.com/v1',
    docsUrl: 'https://api-docs.deepseek.com/',
  },
  {
    provider: 'MiniMax',
    label: 'MiniMax 稀宇',
    claudeModel: 'MiniMax-M3',
    claudeBaseUrl: 'https://api.minimaxi.com/anthropic',
    codexModel: 'MiniMax-M3',
    codexBaseUrl: 'https://api.minimaxi.com/v1',
    docsUrl: 'https://platform.minimaxi.com/document',
  },
  {
    provider: 'GLM',
    label: 'GLM 智谱',
    claudeModel: 'glm-5.2[1m]',
    claudeBaseUrl: 'https://open.bigmodel.cn/api/anthropic',
    codexModel: 'glm-5.2',
    codexBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    docsUrl: 'https://docs.bigmodel.cn/',
  },
  {
    provider: 'Kimi',
    label: 'Kimi 月之暗面',
    claudeModel: 'kimi-k3',
    claudeBaseUrl: 'https://api.moonshot.cn/anthropic',
    codexModel: 'kimi-k3',
    codexBaseUrl: 'https://api.moonshot.cn/v1',
    docsUrl: 'https://platform.kimi.com/docs/guide/claude-code-kimi',
  },
  {
    provider: 'SCNet',
    label: '超算互联网',
    claudeModel: 'DeepSeek-V4',
    claudeBaseUrl: 'https://api.scnet.cn/api/llm/anthropic',
    codexModel: 'DeepSeek-V4',
    codexBaseUrl: 'https://api.scnet.cn/api/llm/v1',
    docsUrl: 'https://www.scnet.cn/ac/openapi/doc/2.0/moduleapi/api/chat.html',
  },
  {
    provider: CUSTOM_PROVIDER,
    label: '自定义',
    claudeModel: '',
    claudeBaseUrl: '',
    codexModel: '',
    codexBaseUrl: '',
  },
];

export function findProviderPreset(provider: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(
    (preset) => preset.provider.toLowerCase() === provider.trim().toLowerCase(),
  );
}

/** Groups profiles under their provider, in the order the presets declare them. */
export function groupProfilesByProvider(
  profiles: readonly ModelProfile[],
): { provider: string; label: string; profiles: ModelProfile[] }[] {
  const groups = new Map<string, { provider: string; label: string; profiles: ModelProfile[] }>();
  for (const profile of profiles) {
    const preset = findProviderPreset(profile.provider);
    const provider = preset?.provider ?? profile.provider;
    const group = groups.get(provider) ?? {
      provider,
      label: preset?.label ?? profile.provider,
      profiles: [],
    };
    group.profiles.push(profile);
    groups.set(provider, group);
  }
  const order = PROVIDER_PRESETS.map((preset) => preset.provider);
  return [...groups.values()].sort(
    (left, right) =>
      // Providers with no preset sort after the known ones, then alphabetically.
      (order.indexOf(left.provider) + 1 || order.length + 1) -
        (order.indexOf(right.provider) + 1 || order.length + 1) ||
      left.provider.localeCompare(right.provider),
  );
}

/** Offered as `<datalist>` hints wherever a Codex model can be typed by hand. */
export const CODEX_MODEL_SUGGESTIONS: readonly string[] = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
];

/**
 * Whether an agent reaches this profile through its own vendor rather than a compatibility layer.
 *
 * A native model needs no base URL and no API key of ours — the agent already authenticates with
 * the vendor that built it, which is why the launch dialogs call it out.
 */
export function isNativeModel(profile: ModelProfile, agent: AgentProtocol): boolean {
  if (profileBaseUrl(profile, agent)) {
    return false;
  }
  return agent === 'claude' ? profile.provider === 'Anthropic' : profile.provider === 'OpenAI';
}

export interface McpProfile {
  id: string;
  name: string;
  configJson: string;
}

export interface McpProfileInput {
  id: string;
  name: string;
  configJson: string;
}

export type NetworkProfileScope = 'global' | 'workspace';

export interface NetworkProfile {
  id: string;
  name: string;
  scope: NetworkProfileScope;
  workspaceId?: string;
  enabled: boolean;
  isDefault: boolean;
  httpProxy?: string;
  httpsProxy?: string;
  allProxy?: string;
  noProxy?: string;
  npmRegistry?: string;
  npmProxy?: string;
  npmHttpsProxy?: string;
  npmStrictSsl: boolean;
  npmCaPath?: string;
  proxyUsername?: string;
  credentialTarget?: string;
  hasCredential: boolean;
}

export interface NetworkProfileInput {
  id: string;
  name: string;
  scope: NetworkProfileScope;
  workspaceId?: string;
  enabled: boolean;
  isDefault: boolean;
  httpProxy?: string;
  httpsProxy?: string;
  allProxy?: string;
  noProxy?: string;
  npmRegistry?: string;
  npmProxy?: string;
  npmHttpsProxy?: string;
  npmStrictSsl: boolean;
  npmCaPath?: string;
  proxyUsername?: string;
  proxyPassword?: string;
  clearCredential?: boolean;
}

export interface NetworkTestResult {
  profileId: string;
  healthy: boolean;
  target: string;
  message: string;
  latencyMs: number;
}

export interface SystemProxyDiscovery {
  source: 'environment' | 'windows' | string;
  httpProxy?: string;
  httpsProxy?: string;
  allProxy?: string;
  noProxy?: string;
  diagnostic: string;
}

/** Outcome of importing an exported proxy file. */
export interface ImportSummary {
  imported: number;
  /** Profiles whose password has to be re-entered, since files never carry credentials. */
  needsPassword: string[];
  /** Reasons for entries that were rejected instead of imported. */
  skipped: string[];
}

export const EVENT_STATUS: Readonly<Record<string, TerminalStatus>> = {
  'session.started': 'RUNNING',
  'agent.thinking': 'THINKING',
  'tool.started': 'RUNNING',
  'tool.completed': 'THINKING',
  'tool.failed': 'RUNNING',
  'approval.required': 'WAITING_APPROVAL',
  'user.input.required': 'WAITING_INPUT',
  'agent.rate_limited': 'RATE_LIMITED',
  'agent.timeout': 'WAITING_INPUT',
  'task.completed': 'COMPLETED',
  'agent.failed': 'FAILED',
  'session.ended': 'STOPPED',
};
