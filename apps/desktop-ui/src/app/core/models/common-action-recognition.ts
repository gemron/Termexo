export function recognitionPrompt(
  projectPath: string,
  workspaceId: string,
  requestId: string,
): string {
  return [
    '请只读分析当前项目，识别常用开发操作。不要修改文件、安装依赖、启动服务、执行启动命令或保存操作。',
    `项目目录：${JSON.stringify(projectPath)}。读取 README、包管理器锁文件、package.json scripts、工作区及后端配置，识别前端/后端各自的启动命令与工作目录；不要猜测不存在的脚本。`,
    '每项包含 name、command（适用于当前 Windows PowerShell 的单行命令）、workingDirectory（绝对路径）、description（识别依据和必要的前置条件）。可建议已知的 IDE 打开命令。最多 20 项，无法确定则返回空数组。',
    `若可用，请调用 Termexo MCP 的 common_action_propose，workspaceId=${JSON.stringify(workspaceId)}，requestId=${JSON.stringify(requestId)}，actionsJson 为建议 JSON 数组的字符串。该工具仅展示建议，用户确认后才会保存。禁止调用运行/终端创建等工具。`,
    '若没有此 MCP 工具，或工具返回请求不存在/已取消等错误，请仅返回同结构的 JSON 数组，供用户复制到“常用操作”的导入区审核。',
  ].join('\n');
}
