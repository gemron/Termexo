import { AgentType, TerminalStatus } from './workspace.models';

export type NativeAgentType = 'claude' | 'codex' | 'opencode' | 'antigravity';

/**
 * The agents Termexo can install and upgrade itself.
 *
 * These arrive as npm packages. Antigravity does not — it ships its own installer, puts its
 * binary outside PATH and updates itself — so it is driven but never managed.
 */
export type ManagedAgentType = 'claude' | 'codex' | 'opencode' | 'antigravity';

export type CliInstaller = 'npm' | 'script';

/**
 * How each managed CLI can be installed, best-supported first.
 *
 * npm can be pinned to a version and rolled back to one; a vendor's script always fetches what
 * that vendor currently publishes and puts it where the vendor wants it. Where both are listed
 * the user picks. OpenCode publishes no Windows script (its docs point at npm, Chocolatey or
 * WSL) and Antigravity publishes no package, so those offer one way each.
 *
 * The panel needs this before a plan exists, which is why it is stated here rather than read off
 * the plan the backend returns.
 */
export const MANAGED_AGENT_INSTALLERS: Record<ManagedAgentType, readonly CliInstaller[]> = {
  claude: ['npm', 'script'],
  codex: ['npm', 'script'],
  opencode: ['npm'],
  antigravity: ['script'],
};
export type AccountAgentType = 'claude' | 'codex';

/** One model the Antigravity CLI offers, as it reports them itself. */
export interface AntigravityModel {
  /** The value passed to `--model`. */
  readonly slug: string;
  readonly displayName: string;
}

/** Whether Termexo's status feed is installed in the Antigravity CLI's own settings. */
export interface AntigravityStatusFeed {
  readonly settingsPath: string;
  readonly installed: boolean;
  /** A status line is configured that is not Termexo's, which installing would replace. */
  readonly foreignStatusLine: boolean;
}

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

/**
 * Keeps a persisted native session on the Agent that created it.
 *
 * `recordedAgentType` is present for new data. Session scans and hook events provide migration
 * evidence for older records; an unknown legacy ID is retained, while a proven mismatch is
 * discarded instead of being passed to the other CLI.
 */
export function compatibleNativeSessionId(
  agentType: NativeAgentType,
  sessionId: string | undefined,
  recordedAgentType: NativeAgentType | undefined,
  sessions: readonly Pick<AgentSession, 'agentType' | 'nativeSessionId'>[],
  events: readonly Pick<AgentEvent, 'agentType' | 'nativeSessionId'>[],
): string | undefined {
  const normalizedId = sessionId?.trim();
  if (!normalizedId) return undefined;
  if (recordedAgentType) {
    return recordedAgentType === agentType ? normalizedId : undefined;
  }

  const knownAgentTypes = new Set(
    [...sessions, ...events]
      .filter((item) => item.nativeSessionId === normalizedId)
      .map((item) => item.agentType),
  );
  return knownAgentTypes.size > 0 && !knownAgentTypes.has(agentType) ? undefined : normalizedId;
}

export interface AgentLaunchSpec {
  command: string;
  executablePath: string;
}

export interface CliOperationRequest {
  agentType: ManagedAgentType;
  /** Which of the agent's installers to use; its own default when absent. */
  installer?: CliInstaller;
  targetVersion?: string;
  workspaceId?: string;
  confirmed?: boolean;
}

export interface CliOperationPlan {
  agentType: NativeAgentType;
  displayName: string;
  packageName: string;
  targetVersion: string;
  /** `npm` for a published package, `script` for the vendor's own installer. */
  installer: CliInstaller;
  /** False when the installer offers no version to pin, as a script install does not. */
  supportsVersion: boolean;
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
  autoConfirm?: boolean;
  /** Branches the resumed conversation instead of reusing an id the CLI still has running. */
  forkSession?: boolean;
  /** Reconnects to a session the CLI still has running instead of starting a new process. */
  attachShortId?: string;
  /** Overrides the profile's 1M context window for this terminal only; omitted keeps it. */
  context1m?: boolean;
  /** Overrides the profile's reasoning depth for this terminal only; omitted keeps it. */
  effort?: string;
}

/** What to do with a session the CLI is still running when its terminal wants it back. */
export type BackgroundSessionResolution = 'attach' | 'fork' | 'skip';

/**
 * A Claude session the CLI still has running.
 *
 * Claude Code keeps a session alive when its terminal goes away, and then refuses to resume it in
 * place, so one of these has to be stopped or branched before its id can be reused.
 */
export interface ClaudeBackgroundSession {
  /** The short id `claude stop` takes, distinct from the full session id. */
  shortId: string;
  sessionId: string;
  name?: string;
  /** True while the session is mid-turn, when stopping it would discard work in flight. */
  busy: boolean;
}

export interface CodexLaunchRequest {
  terminalId: string;
  workspaceId?: string;
  sessionId?: string;
  model?: string;
  profileId?: string;
  accountProfileId?: string;
  autoConfirm?: boolean;
  /** Overrides the profile's reasoning depth for this terminal only; omitted keeps it. */
  reasoningEffort?: string;
}

export interface AntigravityLaunchRequest {
  terminalId: string;
  workspaceId?: string;
  /** Recorded as trusted, so the CLI does not stop to ask about an unfamiliar workspace. */
  workingDirectory?: string;
  sessionId?: string;
  model?: string;
  effort?: string;
  continueLast?: boolean;
  autoConfirm?: boolean;
}

export interface OpenCodeLaunchRequest {
  terminalId: string;
  workspaceId?: string;
  sessionId?: string;
  model?: string;
  continueLast?: boolean;
  autoConfirm?: boolean;
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
  /** Asks Claude Code for the model's 1M-token context window. */
  claudeContext1m?: boolean;
  /** One of {@link CLAUDE_EFFORT_LEVELS}; empty leaves the CLI's own default alone. */
  claudeEffort?: string;
  /** One of {@link CODEX_REASONING_EFFORT_LEVELS}; empty leaves the CLI's own default alone. */
  codexReasoningEffort?: string;
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
  claudeContext1m?: boolean;
  claudeEffort?: string;
  codexReasoningEffort?: string;
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
 * Picks the account profile whose subscription a launch will actually spend.
 *
 * Mirrors the backend fallback in `account_profile_environment`: an explicit choice when it still
 * exists, otherwise the agent's default account, otherwise any account it has. Callers must record
 * the resolved id on the terminal, because the backend resolves the same way silently and a
 * terminal that omits the id cannot be matched to the subscription allowance it is consuming.
 */
export function resolveAccountProfileId(
  profiles: readonly AccountProfile[],
  agent: AgentProtocol,
  preferred?: string,
): string | undefined {
  const candidates = profiles.filter((profile) => profile.agentType === agent);
  return (
    candidates.find((profile) => profile.id === preferred)?.id ??
    candidates.find((profile) => profile.isDefault)?.id ??
    candidates[0]?.id
  );
}

/**
 * Names the account a terminal is actually signed in as, empty when the agent has none.
 *
 * A terminal records the account its launch resolved to, but one restored from an older build can
 * carry none. The backend then falls back to the agent's default account, so resolving the same
 * way here names the account the terminal is really spending, rather than leaving it blank.
 */
export function terminalAccountName(
  profiles: readonly AccountProfile[],
  agentType: AgentType,
  accountProfileId?: string,
): string {
  if (agentType !== 'claude' && agentType !== 'codex') {
    return '';
  }
  const resolved = resolveAccountProfileId(profiles, agentType, accountProfileId);
  return profiles.find((profile) => profile.id === resolved)?.name ?? '';
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
 * Reasoning depth each CLI accepts at launch, weakest first.
 *
 * The two agents publish different ladders — Claude Code has no `minimal` and Codex no `max` —
 * so a level offered for one would fail the launch of the other.
 */
export const CLAUDE_EFFORT_LEVELS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const CODEX_REASONING_EFFORT_LEVELS: readonly string[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
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
