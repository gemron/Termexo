export type AgentType = 'claude' | 'codex' | 'opencode' | 'grok' | 'antigravity' | 'shell';

/**
 * Model label for an OpenCode terminal that named no model.
 *
 * OpenCode resolves the model from its own configuration, so Termexo has no id to record. The
 * label doubles as the marker that no explicit model was chosen, and a relaunch must therefore
 * pass no `--model` at all rather than feeding this text back to the CLI.
 */
export const OPENCODE_DEFAULT_MODEL = 'OpenCode 默认模型';
/** Shown until the CLI reports which model it chose; Antigravity picks its own default. */
export const ANTIGRAVITY_DEFAULT_MODEL = 'Antigravity 默认模型';

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

/**
 * The one source of truth for terminal status presentation.
 *
 * The tone drives the colour across panels, labels, banners and the session centre so a status
 * only ever uses one visual language. Status itself carries the i18n key; tone does not. The
 * `pulse` flag is reserved for states where the user must act (waiting_*), the rest stay still
 * so a busy workbench does not have five dots blinking in unison.
 */
export const TERMINAL_STATUS_META: Record<
  TerminalStatus,
  {
    tone: 'progress' | 'attention' | 'warning' | 'danger' | 'success' | 'neutral';
    labelKey: string;
    pulse: boolean;
  }
> = {
  STARTING: { tone: 'progress', labelKey: 'status.starting', pulse: false },
  RUNNING: { tone: 'progress', labelKey: 'status.running', pulse: false },
  THINKING: { tone: 'progress', labelKey: 'status.thinking', pulse: false },
  WAITING_INPUT: { tone: 'attention', labelKey: 'status.waitingInput', pulse: true },
  WAITING_APPROVAL: { tone: 'attention', labelKey: 'status.waitingApproval', pulse: true },
  RATE_LIMITED: { tone: 'warning', labelKey: 'status.rateLimited', pulse: false },
  IDLE: { tone: 'neutral', labelKey: 'status.idle', pulse: false },
  COMPLETED: { tone: 'success', labelKey: 'status.completed', pulse: false },
  FAILED: { tone: 'danger', labelKey: 'status.failed', pulse: false },
  STOPPED: { tone: 'neutral', labelKey: 'status.stopped', pulse: false },
  DISCONNECTED: { tone: 'neutral', labelKey: 'status.disconnected', pulse: false },
};

/**
 * The mark each agent is shown by, wherever it is shown.
 *
 * Every place that draws an agent reads this: the new-terminal menu, a terminal's own title, the
 * session centre and the settings health strip. They used to choose separately, which had three of
 * the four agents sharing one generic icon and made them hard to tell apart at a glance.
 */
export const AGENT_ICONS: Record<AgentType, string> = {
  claude: 'brand-claude',
  codex: 'brand-codex',
  opencode: 'brand-opencode',
  grok: 'brand-grok',
  antigravity: 'brand-antigravity',
  /** A plain shell is not a product and has no mark of its own. */
  shell: 'terminal',
};

export const AGENT_LABELS: Record<AgentType, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  opencode: 'OpenCode',
  grok: 'Grok Build',
  antigravity: 'Antigravity',
  shell: 'Shell',
};
