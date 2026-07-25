import { TerminalStatus } from './workspace.models';

export interface AgentInstallation {
  agentType: 'claude';
  installed: boolean;
  executablePath?: string;
  version?: string;
  healthy: boolean;
  diagnostic: string;
}

export interface AgentSession {
  id: string;
  agentType: 'claude';
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
  agentType: 'claude';
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
