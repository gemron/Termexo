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

export interface ClaudeLaunchRequest {
  terminalId: string;
  sessionId?: string;
  name?: string;
  profileId?: string;
  mcpProfileId?: string;
}

export interface CodexLaunchRequest {
  sessionId?: string;
  model?: string;
}

export interface ModelProfile {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl?: string;
  credentialTarget?: string;
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
  isDefault: boolean;
}

export interface ClaudeProviderPreset {
  provider: string;
  name: string;
  model: string;
  baseUrl: string;
}

export const CLAUDE_PROVIDER_PRESETS: readonly ClaudeProviderPreset[] = [
  {
    provider: 'Anthropic',
    name: 'Claude Sonnet',
    model: 'sonnet',
    baseUrl: '',
  },
  {
    provider: 'DeepSeek',
    name: 'DeepSeek V4 Pro',
    model: 'deepseek-v4-pro[1m]',
    baseUrl: 'https://api.deepseek.com/anthropic',
  },
  {
    provider: 'MiniMax',
    name: 'MiniMax M2.7',
    model: 'MiniMax-M2.7',
    baseUrl: 'https://api.minimaxi.com/anthropic',
  },
  {
    provider: 'GLM',
    name: 'GLM 5.2',
    model: 'glm-5.2[1m]',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
  },
];

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

export const EVENT_STATUS: Readonly<Record<string, TerminalStatus>> = {
  'session.started': 'RUNNING',
  'agent.thinking': 'THINKING',
  'tool.started': 'RUNNING',
  'tool.completed': 'THINKING',
  'tool.failed': 'RUNNING',
  'approval.required': 'WAITING_APPROVAL',
  'user.input.required': 'WAITING_INPUT',
  'task.completed': 'COMPLETED',
  'agent.failed': 'FAILED',
  'session.ended': 'STOPPED',
};
