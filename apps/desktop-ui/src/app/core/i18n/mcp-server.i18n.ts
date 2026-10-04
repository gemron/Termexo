import { registerTranslations } from './i18n.service';

export function registerMcpServerTranslations(): void {
  registerTranslations(MCP_TRANSLATIONS);
}

const MCP_TRANSLATIONS = {
  en: {
    'mcpServer.tab': 'AI control (MCP)',
    'mcpServer.title': 'Let AI control Termexo',
    'mcpServer.description':
      'Connect an AI client on this computer to your running terminals, task board and settings.',
    'mcpServer.desktopOnly': 'Manage this connection in the Termexo desktop app.',
    'mcpServer.enabled': 'Enable local MCP server',
    'mcpServer.autoConnectAgents': 'Automatically connect agents started by Termexo',
    'mcpServer.autoConnectHint':
      'New sessions and task launches connect automatically. Restart existing agents to connect. Grok and Antigravity need a managed entry in their user MCP configuration; turning this off removes it.',
    'mcpServer.port': 'Local port',
    'mcpServer.permissions': 'Allow AI to access',
    'mcpServer.terminals': 'Terminals and workspaces',
    'mcpServer.tasks': 'Tasks and execution',
    'mcpServer.settings': 'Settings and model profiles',
    'mcpServer.accessHint':
      'Terminal and task access can run commands on this computer. Settings access can change your app preferences and model configuration.',
    'mcpServer.apply': 'Apply',
    'mcpServer.running': 'Running',
    'mcpServer.stopped': 'Stopped',
    'mcpServer.endpoint': 'Server URL',
    'mcpServer.token': 'Access token',
    'mcpServer.showToken': 'Show token',
    'mcpServer.hideToken': 'Hide token',
    'mcpServer.rotateToken': 'Regenerate token',
    'mcpServer.rotateHint':
      'Manually configured clients need the new token. Automatically connected agents update on their next request.',
    'mcpServer.config': 'Client connection',
    'mcpServer.configHint':
      'Use this configuration in a client that supports Streamable HTTP. Keep Termexo open while the AI is connected.',
    'mcpServer.copyJson': 'Copy JSON configuration',
    'mcpServer.copyCodex': 'Copy TOML configuration',
    'mcpServer.copyToken': 'Copy token',
    'mcpServer.copied': 'Copied',
    'mcpServer.localOnly':
      'This connection is available only on this computer and is independent of remote workbench access.',
    'mcpServer.invalidPort': 'Enter a port between 1 and 65535.',
  },
  'zh-CN': {
    'mcpServer.tab': 'AI 操控（MCP）',
    'mcpServer.title': '让 AI 操控 Termexo',
    'mcpServer.description': '允许本机 AI 客户端连接正在运行的终端、任务看板和设置。',
    'mcpServer.desktopOnly': '请在 Termexo 桌面应用中管理此连接。',
    'mcpServer.enabled': '启用本地 MCP 服务',
    'mcpServer.autoConnectAgents': '自动连接 Termexo 启动的 Agent',
    'mcpServer.autoConnectHint':
      '新会话及任务启动时自动连接；已有 Agent 需重新启动。Grok 和 Antigravity 会在用户 MCP 配置中添加托管条目，关闭此选项时移除。',
    'mcpServer.port': '本机端口',
    'mcpServer.permissions': '允许 AI 访问',
    'mcpServer.terminals': '终端和工作区',
    'mcpServer.tasks': '任务及执行',
    'mcpServer.settings': '设置和模型配置',
    'mcpServer.accessHint':
      '终端和任务权限允许 AI 在本机运行命令；设置权限允许修改应用偏好和模型配置。',
    'mcpServer.apply': '应用',
    'mcpServer.running': '运行中',
    'mcpServer.stopped': '已停止',
    'mcpServer.endpoint': '服务地址',
    'mcpServer.token': '访问令牌',
    'mcpServer.showToken': '显示令牌',
    'mcpServer.hideToken': '隐藏令牌',
    'mcpServer.rotateToken': '重新生成令牌',
    'mcpServer.rotateHint': '手动配置的客户端需要更新令牌；自动连接的 Agent 会在下一次请求时更新。',
    'mcpServer.config': '客户端连接',
    'mcpServer.configHint':
      '将配置用于支持 Streamable HTTP 的 AI 客户端。连接期间请保持 Termexo 打开。',
    'mcpServer.copyJson': '复制 JSON 配置',
    'mcpServer.copyCodex': '复制 TOML 配置',
    'mcpServer.copyToken': '复制令牌',
    'mcpServer.copied': '已复制',
    'mcpServer.localOnly': '此连接仅供本机使用，与工作台的远程访问独立。',
    'mcpServer.invalidPort': '请输入 1–65535 之间的端口。',
  },
};
