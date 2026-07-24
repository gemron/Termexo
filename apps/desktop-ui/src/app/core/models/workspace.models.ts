export type AgentType = 'claude' | 'codex' | 'gemini' | 'shell';

export type TerminalStatus =
  | 'STARTING'
  | 'RUNNING'
  | 'THINKING'
  | 'WAITING_INPUT'
  | 'WAITING_APPROVAL'
  | 'IDLE'
  | 'COMPLETED'
  | 'FAILED'
  | 'STOPPED'
  | 'DISCONNECTED';

export type LayoutMode = 'single' | 'columns' | 'rows' | 'grid';

export interface TerminalSession {
  id: string;
  name: string;
  workingDirectory: string;
  shell: string;
  agentType: AgentType;
  status: TerminalStatus;
  model: string;
  branch: string;
  command?: string;
  nativeSessionId?: string;
}

export interface Workspace {
  id: string;
  name: string;
  projectPath: string;
  projectType: string;
  activeBranch: string;
  favorite: boolean;
  lastOpenedAt: number;
  layout: LayoutMode;
  terminals: TerminalSession[];
}

export interface CreateTerminalInput {
  agentType: AgentType;
  name?: string;
  command?: string;
  model?: string;
}

export interface ModelProfile {
  id: string;
  name: string;
  provider: string;
  model: string;
  tone: string;
}

export interface GitSummary {
  branch: string;
  ahead: number;
  behind: number;
  changedFiles: number;
  additions: number;
  deletions: number;
}

export interface TaskSummary {
  id: string;
  title: string;
  status: '进行中' | '等待确认' | '已完成';
  progress: number;
}

export const TERMINAL_STATUS_LABELS: Record<TerminalStatus, string> = {
  STARTING: '启动中',
  RUNNING: '运行中',
  THINKING: '思考中',
  WAITING_INPUT: '等待输入',
  WAITING_APPROVAL: '需要确认',
  IDLE: '空闲',
  COMPLETED: '已完成',
  FAILED: '失败',
  STOPPED: '已停止',
  DISCONNECTED: '已断开',
};

export const AGENT_LABELS: Record<AgentType, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  shell: 'Shell',
};

export const MODEL_PROFILES: ModelProfile[] = [
  {
    id: 'claude-sonnet',
    name: 'Claude Sonnet',
    provider: 'Anthropic',
    model: 'claude-sonnet-4-5',
    tone: '#58c7a0',
  },
  {
    id: 'gpt-codex',
    name: 'GPT Codex',
    provider: 'OpenAI',
    model: 'gpt-5-codex',
    tone: '#68a9e8',
  },
  {
    id: 'gemini-pro',
    name: 'Gemini Pro',
    provider: 'Google',
    model: 'gemini-2.5-pro',
    tone: '#d6a34a',
  },
];
