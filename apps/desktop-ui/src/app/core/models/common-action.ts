import type {
  CommonAction,
  CommonActionCategory,
  TerminalSession,
  TerminalStatus,
} from './workspace.models';

export const COMMON_ACTION_CATEGORIES: readonly { value: CommonActionCategory; label: string }[] = [
  { value: 'develop', label: '开发服务' },
  { value: 'test', label: '测试' },
  { value: 'build', label: '构建打包' },
  { value: 'quality', label: '代码质量' },
  { value: 'tools', label: '开发工具' },
  { value: 'custom', label: '其他操作' },
];

export const MAX_ACTION_SUGGESTIONS = 20;
export const MAX_ACTION_ENVIRONMENT_VARIABLES = 100;
export const MAX_ACTION_ENVIRONMENT_VALUE_LENGTH = 16_384;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_SUGGESTIONS_LENGTH = 100_000;
const ABSOLUTE_ACTION_DIRECTORY = /^(?:[a-z]:[\\/]|\\\\|\/)/i;
const FIELD_RULES = {
  name: { label: '名称', max: 100, required: true },
  command: { label: '命令', max: 4000, required: true },
  workingDirectory: { label: '工作目录', max: 2000, required: true },
  description: { label: '说明', max: 2000, required: false },
} as const;

/** Values are literal process environment strings, not shell expressions or dotenv syntax. */
export function validateActionEnvironment(value: unknown): Record<string, string> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('环境变量必须是键值对象。');
  const entries = Object.entries(value);
  if (entries.length > MAX_ACTION_ENVIRONMENT_VARIABLES)
    throw new Error(`环境变量最多 ${MAX_ACTION_ENVIRONMENT_VARIABLES} 项。`);
  for (const [name, content] of entries) {
    if (!ENVIRONMENT_NAME.test(name)) throw new Error('环境变量名须以字母或下划线开头，只能包含字母、数字和下划线。');
    if (typeof content !== 'string') throw new Error('环境变量值必须是文本。');
    if (content.includes('\0')) throw new Error('环境变量值不能包含空字符。');
    if (content.length > MAX_ACTION_ENVIRONMENT_VALUE_LENGTH)
      throw new Error(`环境变量值不能超过 ${MAX_ACTION_ENVIRONMENT_VALUE_LENGTH} 个字符。`);
  }
  return Object.fromEntries(entries);
}

export function validateCommonAction(value: unknown): Omit<CommonAction, 'id' | 'terminalId'> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('操作必须是 JSON 对象。');
  const action = value as Record<string, unknown>;
  const field = (key: keyof typeof FIELD_RULES): string => {
    const { label, max, required } = FIELD_RULES[key];
    const value = action[key] ?? '';
    if (typeof value !== 'string') throw new Error(`${label}必须是文本。`);
    if (required && !value.trim()) throw new Error(`请填写${label}。`);
    if (value.length > max) throw new Error(`${label}不能超过 ${max} 个字符。`);
    if (/[\x00-\x1f\x7f]/.test(value)) throw new Error(`${label}不能包含换行或控制字符。`);
    return value.trim();
  };
  const workingDirectory = field('workingDirectory');
  if (!ABSOLUTE_ACTION_DIRECTORY.test(workingDirectory))
    throw new Error('工作目录必须是绝对路径，例如 D:/project 或 /home/project。');
  const category = action['category'];
  const environment = validateActionEnvironment(action['environment']);
  if (category != null && !COMMON_ACTION_CATEGORIES.some((item) => item.value === category))
    throw new Error('请选择有效的操作分类。');
  return {
    name: field('name'),
    command: field('command'),
    workingDirectory,
    description: field('description'),
    ...(Object.keys(environment).length ? { environment } : {}),
    ...(category == null ? {} : { category: category as CommonActionCategory }),
  };
}

/** Only accept a complete array or a single Markdown JSON block, never arbitrary surrounding prose. */
export function parseActionSuggestions(json: string, projectDirectory?: string): Omit<CommonAction, 'id' | 'terminalId'>[] {
  if (json.length > MAX_SUGGESTIONS_LENGTH) throw new Error('建议内容过长。');
  const text = json.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
  let values: unknown;
  try {
    values = JSON.parse(text);
  } catch {
    throw new Error('无法解析建议，请粘贴完整的 JSON 数组或 JSON 代码块。');
  }
  if (!Array.isArray(values) || values.length > MAX_ACTION_SUGGESTIONS)
    throw new Error(`建议必须是最多 ${MAX_ACTION_SUGGESTIONS} 项的 JSON 数组。`);
  return values.map((value, index) => {
    try {
      if (projectDirectory && value && typeof value === 'object' && !Array.isArray(value)) {
        const action = value as Record<string, unknown>;
        return validateCommonAction({ ...action,
          workingDirectory: resolveSuggestedDirectory(action['workingDirectory'], projectDirectory),
        });
      }
      return validateCommonAction(value);
    } catch (error) {
      throw new Error(
        `第 ${index + 1} 项：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

/** Resolve AI-relative paths on the project host, independently of the viewing browser's OS. */
function resolveSuggestedDirectory(value: unknown, projectDirectory: string): string {
  if (value == null || value === '') return projectDirectory;
  if (typeof value !== 'string') throw new Error('工作目录必须是文本。');
  if (value.length > FIELD_RULES.workingDirectory.max || /[\x00-\x1f\x7f]/.test(value))
    throw new Error('工作目录过长或包含控制字符。');
  const directory = value.trim();
  if (!directory) return projectDirectory;
  const windows = /^(?:[a-z]:[\\/]|\\\\|\/\/)/i.test(projectDirectory);
  const driveRelative = windows && /^[\\/](?![\\/])/.test(directory);
  if (ABSOLUTE_ACTION_DIRECTORY.test(directory) && !driveRelative) return directory;
  if (/^(?:[a-z]:|~(?:[\\/]|$)|\$|%[^%]+%)/i.test(directory)
      || /\$\{|\$\(|%[a-z_][a-z0-9_]*%|(?:^|[\\/])\$[a-z_]/i.test(directory))
    throw new Error('请将工作目录中的主机变量或占位符展开为绝对路径。');
  if (!ABSOLUTE_ACTION_DIRECTORY.test(projectDirectory)) throw new Error('项目目录必须是绝对路径。');
  const base = windows ? projectDirectory.replaceAll('\\', '/') : projectDirectory;
  const relative = windows ? directory.replaceAll('\\', '/') : directory;
  let root = '/';
  let remainder = base.slice(1);
  if (/^[a-z]:\//i.test(base)) {
    root = base.slice(0, 3);
    remainder = base.slice(3);
  } else if (windows && base.startsWith('//')) {
    const parts = base.slice(2).split('/').filter(Boolean);
    if (parts.length < 2) throw new Error('项目网络目录须包含服务器和共享名称。');
    root = `//${parts.shift()}/${parts.shift()}/`;
    remainder = parts.join('/');
  }
  const parts: string[] = [];
  for (const part of (driveRelative ? relative : `${remainder}/${relative}`).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return root + parts.join('/');
}

export function normalizedActionDirectory(path: string): string {
  // POSIX paths are case sensitive. Windows drive and UNC paths are not.
  const windows = /^(?:[a-z]:[\\/]|\\\\)/i.test(path);
  const normalized = (windows ? path.replaceAll('\\', '/') : path).replace(/\/+$/, '') || '/';
  return windows ? normalized.toLowerCase() : normalized;
}

export function commonActionSignature(
  action: Pick<CommonAction, 'workingDirectory' | 'command' | 'environment'>,
): string {
  const environment = Object.entries(action.environment ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return JSON.stringify([normalizedActionDirectory(action.workingDirectory), action.command.trim(), environment]);
}

export function commonActionCategory(action: CommonAction): CommonActionCategory {
  return COMMON_ACTION_CATEGORIES.find((item) => item.value === action.category)?.value ?? 'custom';
}

export function commonActionTerminal(
  action: CommonAction,
  terminals: readonly TerminalSession[],
): TerminalSession | undefined {
  return terminals.find(
    (item) => item.id === action.terminalId && item.commonActionId === action.id,
  );
}

export type CommonActionState =
  'unstarted' | 'starting' | 'running' | 'completed' | 'failed' | 'stopped' | 'disconnected';
export const COMMON_ACTION_STATUS_LABELS: Record<CommonActionState, string> = {
  unstarted: '尚未启动',
  starting: '启动中',
  running: '运行中',
  completed: '已完成',
  failed: '执行失败',
  stopped: '已停止',
  disconnected: '已断开',
};

const TERMINAL_ACTION_STATES: Record<TerminalStatus, CommonActionState> = {
  STARTING: 'starting',
  RUNNING: 'running',
  THINKING: 'running',
  WAITING_INPUT: 'running',
  WAITING_APPROVAL: 'running',
  RATE_LIMITED: 'running',
  IDLE: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  STOPPED: 'stopped',
  DISCONNECTED: 'disconnected',
};

export function commonActionState(terminal?: TerminalSession): CommonActionState {
  return terminal ? TERMINAL_ACTION_STATES[terminal.status] : 'unstarted';
}

export function isFinishedCommonAction(
  session: Pick<TerminalSession, 'commonActionId' | 'status'>,
): boolean {
  return (
    !!session.commonActionId &&
    ['COMPLETED', 'FAILED', 'STOPPED', 'DISCONNECTED'].includes(session.status)
  );
}

export function relativeActionDirectory(path: string, projectPath: string): string {
  const root = normalizedActionDirectory(projectPath);
  const directory = normalizedActionDirectory(path);
  if (directory === root) return '项目根目录';
  const prefix = root.endsWith('/') ? root : root + '/';
  return directory.startsWith(prefix)
    ? './' + path.replaceAll('\\', '/').replace(/\/+$/, '').slice(prefix.length)
    : path;
}
