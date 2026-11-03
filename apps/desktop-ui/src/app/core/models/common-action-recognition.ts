import { MAX_ACTION_SUGGESTIONS } from './common-action';

export function recognitionPrompt(
  projectPath: string,
  workspaceId: string,
  requestId: string,
): string {
  return [
    '请只读分析当前项目，识别常用开发操作。不要修改文件、安装依赖、启动服务、执行启动命令或保存操作。',
    `项目目录：${JSON.stringify(projectPath)}。先阅读项目 AGENTS.md 和 README，再按实际技术栈检查 package.json scripts、packageManager、锁文件、monorepo 工作区、Cargo.toml、pyproject.toml、Makefile、compose 及后端配置。区分项目根目录和子项目目录，只推荐文件中有依据的命令，不要猜测不存在的脚本、端口或工具。`,
    '对每条操作自动确定实际工作目录和所需环境变量，不要留给用户再次手填。前端、后端等子项目分别使用对应目录；从根目录通过工作区选择器启动的命令仍使用项目根目录。workingDirectory 必须填主机上的绝对路径，不使用 ~、$PWD、${workspaceFolder} 等未展开占位符。',
    '先只读确认项目所在宿主系统及实际终端 shell，不要仅根据保存的路径或 shell 名称推断平台。Linux/Bash 使用 POSIX/Bash 语法，Windows PowerShell 使用 PowerShell 语法。兼容 Windows PowerShell 5.1，不使用 &&，需要串联时检查前一步退出码。根据 packageManager 和锁文件选择包管理器；含空格路径正确引用，workingDirectory 已指定执行位置，无需在命令中 cd。',
    '优先覆盖开发服务、测试、生产构建、lint/类型检查/格式检查等日常流程；多服务项目分别命名，如“前端 · 开发服务”。不要推荐发布、部署、删库、清理数据或自动修改代码的操作。不要把需先后执行的命令误当作可独立启动的服务。',
    '检查 README、脚本中的内联赋值/cross-env、公开的 compose environment 和 .env.example/.env.template 中的非敏感示例值。自动把有依据的变量填入 environment，所有值均为字符串（例如端口也要用文本），按字面量传入，不进行 shell 变量展开；动态表达式无法可靠解析时不要直接复制。未发现额外变量则明确返回 environment: {}，表示继承主机环境，不虚构 NODE_ENV、PORT 等默认值。不读取真实 .env、凭据文件或主机环境中的密钥；必需但无法确定的变量在 description 中注明待配置，不填虚假占位值。',
    'command 只保留启动命令，不附带 cd 或外层 export、$env:、set、cross-env 等赋值，把这些外层设置拆到 workingDirectory 和 environment。保留项目脚本的正常启动流程；若脚本内部会覆盖同名环境变量，在 description 中注明覆盖关系。',
    `每项必须包含 name（简明用途）、command（可直接执行的单行命令）、workingDirectory（已确定的绝对路径）、environment（环境变量名到文本值的对象，没有额外配置时为 {}）、description（命令、目录、环境变量的来源文件/配置项、必要前置条件；已知服务地址或长驻/一次性行为）、category（develop/test/build/quality/tools/custom 之一）。提交前逐项检查 workingDirectory 和 environment 均已填写。相同目录、命令和环境变量只保留一项，优先选最有用的操作，最多 ${MAX_ACTION_SUGGESTIONS} 项，无法确定则返回空数组。`,
    `若可用，请调用 Termexo MCP 的 common_action_propose，workspaceId=${JSON.stringify(workspaceId)}，requestId=${JSON.stringify(requestId)}，actionsJson 为建议 JSON 数组的字符串。该工具仅展示建议，用户确认后才会保存。禁止调用运行/终端创建等工具。`,
    '若没有此 MCP 工具，或工具返回请求不存在/已取消等错误，请仅返回同结构的 JSON 数组，供用户复制到“常用操作”的导入区审核。',
  ].join('\n');
}
