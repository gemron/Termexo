import { TerminalStatus } from './workspace.models';

export type NativeAgentType = 'claude' | 'codex';

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

export interface AccountLoginRequest {
  terminalId: string;
  workspaceId?: string;
  accountProfileId: string;
}

export interface AccountProfile {
  id: string;
  name: string;
  agentType: NativeAgentType;
  configDir?: string;
  isDefault: boolean;
  isSystem: boolean;
  authenticated: boolean;
  diagnostic: string;
}

export interface AccountProfileInput {
  id: string;
  name: string;
  agentType: NativeAgentType;
  isDefault: boolean;
}

export interface ModelProfile {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl?: string;
  credentialTarget?: string;
  apiProtocol: 'anthropic' | 'openai';
  isDefault: boolean;
  hasCredential: boolean;
}

export interface ModelProfileInput {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  clearCredential?: boolean;
  apiProtocol: 'anthropic' | 'openai';
  isDefault: boolean;
}

export interface ProviderPreset {
  provider: string;
  name: string;
  model: string;
  baseUrl: string;
  apiProtocol: 'anthropic' | 'openai';
}

export const CLAUDE_PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    provider: 'Anthropic',
    name: 'Claude Sonnet',
    model: 'sonnet',
    baseUrl: '',
    apiProtocol: 'anthropic',
  },
  {
    provider: 'DeepSeek',
    name: 'DeepSeek V4 Pro',
    model: 'deepseek-v4-pro[1m]',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiProtocol: 'anthropic',
  },
  {
    provider: 'MiniMax',
    name: 'MiniMax M3',
    model: 'MiniMax-M3',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    apiProtocol: 'anthropic',
  },
  {
    provider: 'GLM',
    name: 'GLM 5.2',
    model: 'glm-5.2[1m]',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    apiProtocol: 'anthropic',
  },
];

export const CODEX_PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    provider: 'OpenAI',
    name: 'GPT-5.6 Sol',
    model: 'gpt-5.6-sol',
    baseUrl: '',
    apiProtocol: 'openai',
  },
  {
    provider: 'ChatGPT',
    name: 'ChatGPT 最新模型',
    model: 'gpt-5.6-luna',
    baseUrl: '',
    apiProtocol: 'openai',
  },
  {
    provider: 'DeepSeek',
    name: 'DeepSeek V4',
    model: 'deepseek-v4',
    baseUrl: 'https://api.deepseek.com/v1',
    apiProtocol: 'openai',
  },
  {
    provider: 'GLM',
    name: 'GLM 5.2',
    model: 'glm-5.2',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiProtocol: 'openai',
  },
];

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  ...CLAUDE_PROVIDER_PRESETS,
  ...CODEX_PROVIDER_PRESETS,
];

/** Offered as `<datalist>` hints wherever a Codex model can be typed by hand. */
export const CODEX_MODEL_SUGGESTIONS: readonly string[] = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
];

export function isNativeModel(profile: ModelProfile): boolean {
  if (profile.baseUrl) return false;
  if (profile.apiProtocol === 'anthropic' && profile.provider === 'Anthropic') return true;
  if (
    profile.apiProtocol === 'openai' &&
    (profile.provider === 'OpenAI' || profile.provider === 'ChatGPT')
  )
    return true;
  return false;
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
