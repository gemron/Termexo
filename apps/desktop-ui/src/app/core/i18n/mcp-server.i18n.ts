import { registerTranslations } from './i18n.service';

export function registerMcpServerTranslations(): void {
  registerTranslations(MCP_TRANSLATIONS);
}

const MCP_TRANSLATIONS = {
  en: {
    'mcpServer.tab': 'AI control (MCP)',
    'mcpServer.title': 'Let AI control Termexo',
    'mcpServer.description':
      'MCP connects AI to Termexo so it can act on your instructions: open terminals, read output and manage tasks. You can ask in everyday language.',
    'mcpServer.quickStart': 'Start here: connect in 3 steps',
    'mcpServer.stepEnable':
      'Select Enable local MCP server and keep automatic connection checked. Choose permissions, then click Apply and look for Running.',
    'mcpServer.stepLaunch':
      'Launch a new AI terminal in Termexo, such as Claude Code or Codex. Restart an already running AI session to load the connection.',
    'mcpServer.stepAsk':
      'Paste the example below into that AI terminal and press Enter. The AI chooses the tools for you.',
    'mcpServer.keepOpen':
      'Keep Termexo open. AI terminals launched here connect automatically; no address, token or configuration file is needed.',
    'mcpServer.statusHint':
      'Running means Termexo is ready for connections. Verify the AI connection with the example below.',
    'mcpServer.tryTitle': 'Try this first',
    'mcpServer.tryHint': 'Send this in the AI terminal, not in a PowerShell or CMD shell.',
    'mcpServer.firstPrompt':
      'Use Termexo MCP to list my workspaces and terminals, and tell me which are running. Do not change anything yet.',
    'mcpServer.copyPrompt': 'Copy example message',
    'mcpServer.successHint':
      'Connected: the AI calls Termexo tools and returns your actual workspace names and terminal states. Saying “I can do that” alone does not verify a connection.',
    'mcpServer.moreExamples': 'Then ask for what you need',
    'mcpServer.terminalExample':
      '“In the current workspace, open a shell terminal, run git status and tell me the result.” (Terminal access)',
    'mcpServer.taskExample':
      '“Create a Claude Code task called ‘Review project structure’ in the current workspace. Save it without starting it.” (Task access)',
    'mcpServer.settingsExample': '“Set the Termexo terminal font size to 18.” (Settings access)',
    'mcpServer.helpTitle': 'Not working? Check these first',
    'mcpServer.helpConnection':
      'AI cannot find Termexo tools: check Running and automatic connection, then restart the AI session from Termexo. Use an AI terminal, not a plain shell.',
    'mcpServer.helpPermission':
      'AI cannot act: enable the relevant permission here and click Apply. Reconnect the AI to refresh its tools, and respond to tool approval prompts in that AI client.',
    'mcpServer.helpLogin':
      'Login expired: the AI account needs to sign in again. In Claude Code, enter /login and follow the prompts, then resend your message.',
    'mcpServer.helpWaiting':
      'Input sent or task started: ask the AI to read the terminal output or task state to check the result. After a timeout, check state before asking it to retry.',
    'mcpServer.advancedTitle': 'Advanced: connect AI apps outside Termexo / change port',
    'mcpServer.manualHint':
      'Only needed for an AI app started outside Termexo on this PC. Find its MCP settings, merge the matching configuration below, then reconnect. Browser-based cloud AI cannot directly reach this local address.',
    'mcpServer.portHint':
      'Keep the default port unless it is in use. After changing it, click Apply.',
    'mcpServer.globalConfigHint':
      'Automatic connection for Grok and Antigravity adds a Termexo entry to their user MCP configuration. Disabling automatic connection and applying removes that entry.',
    'mcpServer.desktopOnly': 'Manage this connection in the Termexo desktop app.',
    'mcpServer.enabled': 'Enable local MCP server',
    'mcpServer.autoConnectAgents': 'Automatically connect agents started by Termexo',
    'mcpServer.autoConnectHint':
      'Supports Claude Code, Codex, OpenCode, Grok Build and Antigravity.',
    'mcpServer.port': 'Local port',
    'mcpServer.permissions': 'Allow AI to access',
    'mcpServer.terminals':
      'Terminals: list workspaces, open terminals, send commands and read output',
    'mcpServer.tasks': 'Tasks: create, start, stop and resume work',
    'mcpServer.settings': 'Settings: change language, font and existing model/network profiles',
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
      'The AI app must support Streamable HTTP MCP. Copy JSON for apps accepting mcpServers JSON, or TOML for Codex config.toml. Copy includes your access token; keep it private. Keep Termexo open.',
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
    'mcpServer.description':
      'MCP 是 AI 与 Termexo 之间的连接。连好后，你用日常语言提出要求，AI 就能帮你开终端、读结果、管理任务。',
    'mcpServer.quickStart': '第一次用？只需 3 步',
    'mcpServer.stepEnable':
      '勾选「启用本地 MCP 服务」，保留「自动连接」勾选。选择允许 AI 做的事，点击「应用」，看到「运行中」。',
    'mcpServer.stepLaunch':
      '在 Termexo 中新开一个 AI 终端，比如 Claude Code 或 Codex。已经打开的 AI 会话要重新启动，才能载入连接。',
    'mcpServer.stepAsk':
      '把下方示例复制到这个 AI 终端里，按回车发送。AI 会自己选择工具，你不用记工具名。',
    'mcpServer.keepOpen':
      '使用期间保持 Termexo 打开。从这里启动的 AI 会自动连接，不需要填写地址、令牌或配置文件。',
    'mcpServer.statusHint':
      '「运行中」表示 Termexo 已准备好接受连接；AI 是否连上，还要用下方示例试一次。',
    'mcpServer.tryTitle': '先发这句话，试试是否连上',
    'mcpServer.tryHint': '发给 AI 终端里的 AI，不要粘贴到普通 PowerShell 或 CMD 命令行。',
    'mcpServer.firstPrompt':
      '请通过 Termexo MCP 列出我的工作区和终端，告诉我哪些正在运行。先不要修改任何内容。',
    'mcpServer.copyPrompt': '复制这句话',
    'mcpServer.successHint':
      '成功标志：AI 实际调用 Termexo 工具，返回你电脑上的工作区名称和终端状态。只回答「我可以」还不能说明已连上。',
    'mcpServer.moreExamples': '连上后，你可以这样说',
    'mcpServer.terminalExample':
      '「在当前工作区开一个普通终端，运行 git status，并告诉我结果。」（需要终端权限）',
    'mcpServer.taskExample':
      '「在当前工作区创建一个 Claude Code 任务，标题是‘梳理项目结构’，先保存，不要执行。」（需要任务权限）',
    'mcpServer.settingsExample': '「把 Termexo 的终端字号改为 18。」（需要设置权限）',
    'mcpServer.helpTitle': '没有成功？先看这里',
    'mcpServer.helpConnection':
      'AI 找不到 Termexo 工具：确认服务「运行中」且勾选自动连接，再从 Termexo 重新启动 AI 会话。普通命令行不能直接接收这些自然语言要求。',
    'mcpServer.helpPermission':
      'AI 无法操作：勾选对应权限并点击「应用」，重新连接 AI 以刷新工具列表。如果 AI 客户端弹出工具审批，请在那里处理。',
    'mcpServer.helpLogin':
      '提示登录过期：需要重新登录 AI 账号。Claude Code 可输入 /login，按提示登录后再发一次消息。',
    'mcpServer.helpWaiting':
      '显示已发送或已启动：让 AI 继续读取终端输出或任务状态，确认实际结果。遇到超时先查状态，再决定是否重试。',
    'mcpServer.advancedTitle': '进阶：连接 Termexo 外的 AI 应用 / 修改端口',
    'mcpServer.manualHint':
      '仅当你要连接这台电脑上、在 Termexo 外启动的 AI 应用时才需要。找到该应用的 MCP 设置，合并下方对应配置，再重新连接。浏览器里的云端 AI 不能直接访问这个本机地址。',
    'mcpServer.portHint': '通常不用改端口；只有端口被占用时才修改，改完点击「应用」。',
    'mcpServer.globalConfigHint':
      'Grok 和 Antigravity 的自动连接会在用户 MCP 配置中添加 Termexo 条目；关闭自动连接并点击「应用」后移除。',
    'mcpServer.desktopOnly': '请在 Termexo 桌面应用中管理此连接。',
    'mcpServer.enabled': '启用本地 MCP 服务',
    'mcpServer.autoConnectAgents': '自动连接 Termexo 启动的 Agent',
    'mcpServer.autoConnectHint': '支持 Claude Code、Codex、OpenCode、Grok Build 和 Antigravity。',
    'mcpServer.port': '本机端口',
    'mcpServer.permissions': '允许 AI 访问',
    'mcpServer.terminals': '终端：查看工作区、开关终端、发命令、读输出',
    'mcpServer.tasks': '任务：创建、执行、停止和继续任务',
    'mcpServer.settings': '设置：修改语言、字号及已有模型 / 网络配置',
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
      'AI 应用须支持 Streamable HTTP MCP。接受 mcpServers JSON 的应用用 JSON；Codex 的 config.toml 用 TOML。复制内容已包含访问令牌，请妥善保管。连接期间保持 Termexo 打开。',
    'mcpServer.copyJson': '复制 JSON 配置',
    'mcpServer.copyCodex': '复制 TOML 配置',
    'mcpServer.copyToken': '复制令牌',
    'mcpServer.copied': '已复制',
    'mcpServer.localOnly': '此连接仅供本机使用，与工作台的远程访问独立。',
    'mcpServer.invalidPort': '请输入 1–65535 之间的端口。',
  },
};
