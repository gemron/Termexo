export type AgentType = 'claude' | 'codex' | 'opencode' | 'shell';

/**
 * Model label for an OpenCode terminal that named no model.
 *
 * OpenCode resolves the model from its own configuration, so Termexo has no id to record. The
 * label doubles as the marker that no explicit model was chosen, and a relaunch must therefore
 * pass no `--model` at all rather than feeding this text back to the CLI.
 */
export const OPENCODE_DEFAULT_MODEL = 'OpenCode 默认模型';

export type TerminalStatus =
  | 'STARTING'
  | 'RUNNING'
  | 'THINKING'
  | 'WAITING_INPUT'
  | 'WAITING_APPROVAL'
  | 'RATE_LIMITED'
  | 'IDLE'
  | 'COMPLETED'
  | 'FAILED'
  | 'STOPPED'
  | 'DISCONNECTED';

export type LayoutMode = 'single' | 'columns' | 'rows' | 'grid';

export const MIN_TERMINAL_GRID_DIMENSION = 1;
export const MAX_TERMINAL_GRID_DIMENSION = 6;
export const DEFAULT_TERMINAL_GRID_DIMENSION = 2;
export const MIN_TERMINAL_FONT_SIZE = 9;
export const MAX_TERMINAL_FONT_SIZE = 24;
export const DEFAULT_TERMINAL_FONT_SIZE = 12;
export const DEFAULT_WORKSPACE_THEME_COLOR = '#58c7a0';

export const WORKSPACE_THEME_PRESETS = [
  { name: '翡翠', color: '#58c7a0' },
  { name: '海蓝', color: '#68a9e8' },
  { name: '紫罗兰', color: '#a78bfa' },
  { name: '暖橙', color: '#e4a35a' },
  { name: '玫红', color: '#ef7890' },
  { name: '青色', color: '#52c7d9' },
] as const;

export function normalizeTerminalGridDimension(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TERMINAL_GRID_DIMENSION;
  }
  return Math.min(
    MAX_TERMINAL_GRID_DIMENSION,
    Math.max(MIN_TERMINAL_GRID_DIMENSION, Math.round(value!)),
  );
}

export function normalizeTerminalFontSize(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(value!)));
}

export function normalizeWorkspaceThemeColor(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && /^#[0-9a-f]{6}$/i.test(normalized)
    ? normalized.toLowerCase()
    : DEFAULT_WORKSPACE_THEME_COLOR;
}

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
  profileId?: string;
  mcpProfileId?: string;
  accountProfileId?: string;
  autoConfirm?: boolean;
  runtimeRevision?: number;
}

export interface Workspace {
  id: string;
  name: string;
  themeColor?: string;
  sortOrder?: number;
  projectPath: string;
  projectType: string;
  activeBranch: string;
  favorite: boolean;
  lastOpenedAt: number;
  layout: LayoutMode;
  gridColumns?: number;
  gridRows?: number;
  terminals: TerminalSession[];
}

export interface CreateTerminalInput {
  id?: string;
  agentType: AgentType;
  name?: string;
  command?: string;
  model?: string;
  nativeSessionId?: string;
  workingDirectory?: string;
  profileId?: string;
  mcpProfileId?: string;
  accountProfileId?: string;
  autoConfirm?: boolean;
}

export const TERMINAL_STATUS_LABELS: Record<TerminalStatus, string> = {
  STARTING: '启动中',
  RUNNING: '运行中',
  THINKING: '思考中',
  WAITING_INPUT: '等待输入',
  WAITING_APPROVAL: '需要确认',
  RATE_LIMITED: '429 限流',
  IDLE: '空闲',
  COMPLETED: '已完成',
  FAILED: '失败',
  STOPPED: '已停止',
  DISCONNECTED: '已断开',
};

export const AGENT_LABELS: Record<AgentType, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  opencode: 'OpenCode',
  shell: 'Shell',
};
