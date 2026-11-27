const translations = {
  en: {
    navMcp: "MCP control",
    navFleet: "Fleet",
    fleetIndex: "ECOSYSTEM / TERMEXO FLEET · PREVIEW V0.1",
    fleetTitle: "Run agents across machines.",
    fleetLead:
      "Termexo Fleet is the companion desktop commander built on Termexo MCP. Grade tasks across L1–L4 difficulty tiers, route accounts & models automatically, let parent agents spawn worktree-isolated sub-agents, and track savings across multiple Termexo machines — with zero black-box execution.",
    fleetPromoTitle: "Termexo Fleet product tour",
    fleetPromoDuration: "45 seconds",
    fleetPromoMp4: "Open MP4",
    fleetTabDeck: "Mission Deck & DAG",
    fleetTabSwarm: "Sub-Agent Swarm Tree",
    fleetTabRouting: "L1–L4 Routing Ladder",
    fleetTabTopology: "Multi-Machine Topology",
    fleetTabAnalytics: "Ledger & Alerts",
    fleetFrameBadge: "Zero Black-Box · Real Termexo PTYs",
    fleetCapDeck:
      "Mission Composer with one-click templates, live L1–L4 route forecast, and multi-stage DAG pipelines executing inside real Termexo terminals.",
    fleetCapSwarm:
      "Inspect parent-child sub-agent spawning trees, isolated Git Worktree branches, and real-time depth, concurrency, and budget guardrails.",
    fleetCapRouting:
      "Test any natural-language prompt against the live L1–L4 ladder, view slot health and concurrency pips, and toggle tier assignments in one click.",
    fleetCapTopology:
      "Hub-and-spoke view of connected Windows, macOS, and Linux Termexo nodes with live load meters, OS tags, and RTT connectivity probes.",
    fleetCapAnalytics:
      "Local SQLite execution ledger quantifying L1–L4 routing savings, model/node rankings, and Feishu / WeCom / Slack / WeChat alert channels.",
    fleetPillar1Title: "Difficulty-aware routing & failover",
    fleetPillar1Body:
      "Send quick edits to low-cost L1 slots, reserve L3 for hard architecture work, and enforce L4 cross-family reviews. Auto-cool failing slots on 429/402/422 and escalate on retry.",
    fleetPillar2Title: "Autonomous sub-agents with guardrails",
    fleetPillar2Body:
      "Built-in reverse MCP lets parent agents submit DAG plans and spawn child agents in isolated Git Worktrees — bounded by depth, concurrency, and budget caps.",
    fleetPillar3Title: "Multi-machine fleet topology",
    fleetPillar3Body:
      "Connect Windows, macOS, and Linux Termexo nodes over local, private LAN, or Tailscale VPN with live RTT/capability probes and tag-affinity routing.",
    fleetPillar4Title: "Execution ledger & notifications",
    fleetPillar4Body:
      "Track success rates, escalations, and estimated savings vs. an all-L3 baseline. Push completion and approval alerts to Feishu, WeCom, Slack, or Termexo WeChat.",
    fleetDownloadBtn: "Download Fleet Preview (Windows)",
    fleetRepoBtn: "Explore Termexo Fleet on GitHub →",
    mcpIndex: "MCP / AGENTS IN CONTROL",
    mcpTitle: "From prompt to output.",
    mcpLead: "Pick a step to see how a connected AI finds a terminal through Termexo MCP, sends an instruction and reads what the agent returns.",
    mcpDemoLabel: "Interactive example",
    mcpPlay: "Play example",
    mcpStop: "Stop example",
    mcpDemoSteps: "MCP example steps",
    mcpConnect: "Connect",
    mcpConnectBody: "Find a running terminal.",
    mcpSend: "Send an instruction",
    mcpSendBody: "Submit input to the selected agent.",
    mcpRead: "Read the output",
    mcpReadBody: "See what the terminal returned.",
    mcpSetup: "Set up MCP on your computer",
    mcpFlowCaption: "Illustrative output. Your results come from a running terminal connected to Termexo.",
    mcpStep1Title: "Prepare your workspace",
    mcpStep1Body: "Open Termexo and a project. Make sure your agent CLI is installed and signed in, and keep Termexo running.",
    mcpStep2Title: "Enable the connection",
    mcpStep2Body: "In Settings → AI Control (MCP), enable the local service and automatic connection, choose permissions and Apply. Once the service shows Running, start or restart your agent in Termexo.",
    mcpStep3Title: "Check it with one sentence",
    mcpStep3Body: "Paste the read-only check below into your connected agent. A real tool call returning your workspaces and terminals confirms the connection.",
    mcpCheckLabel: "FIRST, CHECK THE CONNECTION",
    mcpCheckPrompt: "Use Termexo MCP to list my workspaces and terminals, and tell me which are running. Do not change anything yet.",
    mcpTryLabel: "THEN, TRY AN EXISTING OPENCODE TERMINAL",
    mcpTryPrompt: "Use Termexo MCP to find the running OpenCode terminal in my current workspace, send hi, submit Enter and read its reply. If several terminals match, list their names and let me choose.",
    mcpBoundary: "All six support interaction with existing terminals. Task-board execution supports Claude Code, Codex, OpenCode, Pi Agent and Grok Build. Sending input or starting a task does not mean it has finished.",
    mcpFullGuide: "Open the step-by-step MCP guide →",
    navSolutions: "Use cases",
    solutionsIndex: "DIRECTION / USE CASES",
    solutionsTitle: "Keep your AI development work connected.",
    solutionsProblem: "Multiple projects and coding agents can mean scattered windows, missed approvals, and context to explain all over again. Termexo brings the work into view and helps you pick up where you left off.",
    workflowAlt: "Projects and tasks enter the local Termexo workbench, with optional remote access to continue from another device.",
    workflowCaption: "Workflow illustration. People assign tasks and approve actions; agents keep running on the host PC.",
    individualLabel: "FOR INDIVIDUALS",
    individualTitle: "More projects. Less switching.",
    individualProjectsTitle: "Work, side projects, open source",
    individualProjectsBody: "Keep each project's terminals, models, and layout together. Assign agents to implementation, tests, and review, then see who needs you.",
    individualResumeTitle: "Continue tomorrow, or with another agent",
    individualResumeBody: "Find a saved native session or prepare a handoff with the goal, progress, and next step. Spend less time repeating the background.",
    individualRemoteTitle: "Step away without losing touch",
    individualRemoteBody: "Leave your PC running and reconnect from your phone to check output, answer an approval, or send the next instruction.",
    enterpriseLabel: "FOR ENTERPRISE DEVELOPERS",
    enterpriseTitle: "Organize the work. Keep control.",
    enterpriseTasksTitle: "Project work engineers can follow",
    enterpriseTasksBody: "Group business projects into workspaces. Engineers use the task board and agent status to assign work, review results, and prepare handoffs.",
    enterpriseProfilesTitle: "Providers and environments in one place",
    enterpriseProfilesBody: "Manage model, account, and network profiles for different providers and compatible gateways, with quota visibility where supported.",
    enterpriseRemoteTitle: "Access to the development PC you manage",
    enterpriseRemoteBody: "Run the workbench on your organization's Windows, Mac or Linux computer. Use your own relay or trusted LAN / VPN to reconnect to long-running tasks.",
    solutionsBoundaryTitle: "Available today / longer-term direction",
    solutionsBoundaryBody: "Today, individuals and team members operate their own workbenches. Shared workspaces, granular permissions, centralized audit, and broader automatic orchestration remain planned capabilities.",
    solutionsDataNote: "Local-first describes where the workbench runs. Your agent and model configuration still determines where model requests and code are sent.",
    skip: "Skip to content",
    exploreWorkbench: "Explore the workbench",
    pauseMotion: "Pause motion",
    resumeMotion: "Enable motion",
    reducedMotion: "Motion reduced",
    copyFailed: "Select command to copy",
    navWorkbench: "Workbench",
    navCapabilities: "Features",
    navRoadmap: "Roadmap",
    navPrinciples: "Privacy",
    navGuide: "User guide",
    navDownload: "Download",
    github: "GitHub",
    eyebrow: "Local-first AI workspace",
    heroLine1: "Your AI agents.",
    heroLine2: "One workbench.",
    heroLead: "Run coding agents side by side. With Termexo MCP, a connected AI can send instructions to your terminals and read their real output.",
    heroDownload: "Download Termexo",
    heroMcp: "Explore MCP control",
    heroDemo: "Watch demo",
    launchRemote: "Optional phone access",
    sceneCaption: "Termexo desktop and mobile screenshots. Connection shown for illustration.",
    runFromNpm: "Run it now",
    download: "Download installer",
    copyCommand: "Copy",
    copied: "Copied",
    viewSource: "View source",
    metaLocal: "Local-first · MIT open source",
    metaNpm: "One command to start",

    workbenchTitle: "See which agent needs you.",
    workbenchLead:
      "Run supported coding agents in real terminals. Their states stay visible across projects, so you can find the one waiting for your input and return to a native session later.",
    demoAgents: "Antigravity · Two real sessions",
    demoLabel: "30-second real recording · v0.10.6",
    demoCaption:
      "Two real Antigravity sessions in v0.10.6: completion notifications, returning to a session, replying, and split view. Waiting intervals are cut; bilingual captions are included.",
    metricTabsTitle: "Open as many as you want",
    metricTabsBody:
      "Every session stays alive in a tab. Show the ones you are watching right now.",
    metricGridTitle: "Arrange your own grid",
    metricGridBody:
      "Anything from 1 to 6 rows and columns. Each project remembers its own layout.",
    metricModelTitle: "Swap the model, keep the CLI",
    metricModelBody:
      "Same Claude Code you already know, pointed at a different provider.",
    metricLocalTitle:
      "Local by default",
    metricLocalBody:
      "Your workbench runs on your PC. Remote access is optional, through a relay you manage or a trusted LAN / VPN.",

    attentionTitle: "It tells you when an agent is stuck.",
    attentionLead:
      "Keep approval, input and completion notices visible across projects with persistent banners and native system notifications. On Windows, the taskbar also flashes until the notice is handled.",
    attentionPoint1:
      "Waiting for approval, waiting for input, and finished all look different at a glance",
    attentionPoint2: "Keep pending notices in view while you work in other terminals",
    attentionPoint3: "Click the banner to jump straight to that terminal",
    attentionCaption: "One agent needs a decision. The other is still working.",

    sessionTitle: "Pick up yesterday's conversation.",
    sessionLead:
      "Search saved Claude Code, Codex, OpenCode, Pi Agent, Grok Build, and Antigravity sessions across projects. Termexo uses each CLI's own resume command to reopen the native context, without changing session files.",
    sessionPoint1:
      "Search across every project by name, path, branch, or model",
    sessionPoint2:
      "Resumes through each supported CLI's native command",
    sessionPoint3:
      "Your session files are read-only — Termexo never edits or deletes them",
    sessionCaption:
      "Every local session, searchable and one click from resuming",

    modelTitle: "Same CLI. Different model.",
    modelLead:
      "Keep using Claude Code, but point it at DeepSeek, MiniMax, GLM, or your own compatible gateway. Save each one as a profile and switch between them in two clicks — no reinstalling, no editing config files by hand.",
    modelPoint1:
      "Anthropic, DeepSeek, MiniMax, GLM, or any compatible endpoint",
    modelPoint2:
      "API keys go into Windows Credential Manager, macOS Keychain or Linux Secret Service",
    modelPoint3: "Switch every Claude terminal in a project at once",
    modelCaption:
      "Your operating system stores API keys; the interface shows whether a key is configured",

    taskTitle: "Hand the work to an agent.",
    taskLead:
      "Write down what needs doing and what counts as done, pick the agent and the project, and the task opens as a real terminal. It reports its own progress back to the board, so you can see what is running without reading every terminal at once.",
    taskPoint1:
      "Todo, executing, completed, verified — the terminal moves the card",
    taskPoint2: "Send a task to Claude Code, Codex, OpenCode, Pi Agent, or Grok Build",
    taskPoint3:
      "Reject a result with a note and it goes back for another round",
    taskCaption:
      "A task carries its acceptance criteria from todo through to verified",
    capabilitiesTitle: "The things you keep doing by hand.",
    capabilitiesLead:
      "Most of the friction with coding agents is not the model. It is remembering which terminal was doing what, and setting it all up again tomorrow.",
    now: "WORKS TODAY",
    roadmapTag: "COMING LATER",
    featureWorkspaceTitle: "Close it. Reopen it. Still there.",
    featureWorkspaceBody:
      "Project folder, grid layout, terminals, and colours come back with the workspace. Drag workspace rows to put projects in your preferred order.",
    featureSessionTitle: "Nothing you close is lost",
    featureSessionBody:
      "Find past Claude Code, Codex, OpenCode, Pi Agent, Grok Build, or Antigravity sessions across your projects and reopen their native history.",
    featureTasksTitle: "Hand a task to an agent",
    featureTasksBody:
      "Write down the task and what counts as done, pick an agent, and it opens as a real terminal that reports its own progress back to the board.",
    featureModelTitle: "Try a cheaper model on the same task",
    featureModelBody:
      "Point the same CLI at a different provider, switch back if the result is worse, and keep every key in secure storage.",
    featureStatusTitle: "Know the moment it needs you",
    featureStatusBody:
      "Waiting, thinking, needs approval, done, failed: visible across projects, with system notifications and Windows taskbar attention.",
    featureLanguageTitle: "Works in your language",
    featureLanguageBody:
      "Follow your system language or switch between Chinese, English, Spanish, French, German, Japanese and Korean at any time.",
    featureQuotaTitle: "See your quota before you burn it",
    featureQuotaBody:
      "Check supported providers' reported quota and reset time. Grok Build shows an exhausted free allowance; unavailable percentages stay unavailable.",
    featureRemoteTitle:
      "Reach your workbench across networks",
    featureRemoteBody:
      "A self-hosted relay connects your phone to the same desktop terminals. No public IP or router port forwarding on the desktop.",
    featureMcpTitle: "Let one agent operate another",
    featureMcpBody: "Connect through local MCP to send instructions to existing terminals for all six supported agents and read their output. Manage tasks or permitted settings too; choose access scopes yourself.",
    mcpGuide: "Set up MCP →",

    remoteTitle:
      "Your workbench. Across networks.",
    remoteLead:
      "Your desktop opens an outbound tunnel to your relay. Open the relay link on a phone, tablet, or another computer to check output and continue the same terminal session. The desktop needs no public IP or router port forwarding.",
    remotePoint1:
      "Self-host termexo-relay; enroll your desktop with a code or relay account",
    remotePoint2:
      "Use an HTTPS browser entry point; v2 session frames are encrypted with AES-256-GCM",
    remotePoint3:
      "Keep your desktop on and Termexo connected; relay login and the desktop access token are separate checks",
    remoteCaption:
      "The same terminal the desktop is running, one screen at a time.",

    roadmapTitle: "Release milestones.",
    roadmapLead:
      "See how the workbench developed, or open GitHub for the latest release notes.",
    roadmapArchive: "Browse earlier milestones",
    shipped: "SHIPPED",
    planned: "PLANNED",
    roadmap02Title: "Run several agents side by side",
    roadmap02Body:
      "Claude and Codex detection, separate logins, resume, custom grids, model profiles, seven interface languages, and everything saved locally.",
    roadmap04Title: "Accounts, installs, and networks",
    roadmap04Body:
      "Install or upgrade the CLIs in one click, keep several logins apart, set up proxies for a company network, and watch how much plan quota is left.",
    roadmap06Title: "Handing work between agents",
    roadmap06Body:
      "Session summaries, moving a task from one agent to another, routing work, and notifications.",
    roadmap07Title:
      "Remote relay access",
    roadmap07Body:
      "Shipped in v0.10.0: self-hosted relay access, code or account enrollment, cascaded addresses, and v2 encrypted sessions. Your browser operates the terminals already running on your desktop.",
    roadmap10Title: "See every agent's status",
    roadmap10Body:
      "Compact workspace icons show each agent's state and current window name. Confirm completed work in its terminal, with the selected terminal's branch checked against Git.",
    roadmapPatchTitle: "Reliable status and easier setup",
    roadmapPatchBody: "Codex resume and completion fixes, Grok and Antigravity launch repairs, agent-specific mobile shortcuts, and clearer remote-access and MCP setup.",
    roadmapResponsiveTitle: "Responsive terminals and Codex mobile shortcuts",
    roadmapResponsiveBody: "Keep desktop input and scrolling responsive while reconnecting from a phone, paste clipboard text reliably on Windows, and edit queued Codex input with ⇧←.",
    roadmapLatestTitle: "Organized projects and clearer account setup",
    roadmapLatestBody: "Workspace folders, tags and icons, account login choices, model discovery and upgrade suggestions, and confirmation before closing active Agent terminals.",
    roadmapSetupTitle: "Easier Agent setup and Pi support",
    roadmapSetupBody: "Install and update six Agents with clear guidance, use the official Antigravity updater, and keep pending reminders flashing until acknowledged.",
    roadmapProxyTitle: "Cleaner proxy, titles and tab states",
    roadmapProxyBody: "Single-casing proxy on Windows for every terminal, session scans on older OpenCode CLIs, instruction-free Codex titles, and completed tabs set apart from the selected one.",
    roadmapMcpTitle: "Local MCP control, connected automatically",
    roadmapMcpBody: "19 tools for terminals, tasks and settings. Enable the server, select permissions, then launch Claude Code, Codex, OpenCode, Grok Build or Antigravity. Restart existing Agents to connect.",

    principlesTitle: "Your work.\nOn your computer.",
    principlesLead:
      "Termexo runs locally by default. Enable remote access when you need it: use your own relay or a trusted LAN / VPN, control the desktop access token, and disconnect from Settings. Your agent CLIs still connect to the model services you configure.",
    principle1Title: "Local by default",
    principle1Body:
      "Your project paths, sessions, terminal state, and settings sit in a file on your disk. There is no cloud service to sign into.",
    principle2Title: "Your API keys are not in a config file",
    principle2Body:
      "API keys go into Windows Credential Manager, macOS Keychain or Linux Secret Service. The app stores a reference; the interface can tell you a key exists without returning its plaintext.",
    principle3Title: "Your agent files are read-only",
    principle3Body:
      "Termexo reads what Claude Code and Codex write, and uses their own resume commands. It never rewrites, renames, or deletes your session history.",

    ctaTitle: "One command. No account.",
    ctaLead:
      "The npm package includes Windows x64, complete macOS apps for Apple Silicon and Intel, and Linux x64. With Node.js 18.18+, the same command starts the matching app locally, without a Termexo account.",
    getRelease: "Download installer",
    starGithub: "Star on GitHub",
    supportProject:
      "Built in the open, under the MIT license. If Termexo helps your workflow, a GitHub Star helps others discover it. Bug reports and contributions are welcome too.",
    indexWorkbench: "WORKBENCH",
    indexAttention: "02 / NEVER MISS ONE",
    indexSession: "03 / NOTHING IS LOST",
    indexModel: "04 / MODEL ROUTING",
    indexTask: "05 / TASK BOARD",
    indexRemote: "06 / ANY DEVICE",
    indexCapabilities: "07 / FEATURES",
    indexRoadmap: "08 / ROADMAP",
    indexPrivacy: "09 / PRIVACY",
    indexCta: "BUILD WITH US",
    footerReleases: "Releases",
    footerIssues: "Issues",
    footerTagline: "One window for every coding agent",
    siteVisits: "Website visits (PV)",
    counterNotice:
      "Third-party website statistics only; “—” means unavailable.",
    platformSupport: "Windows x64 · macOS 12+ (Apple Silicon / Intel) · Linux x64 · npm on all three",
    platformLimits: "Windows packages are unsigned. Mac builds use ad-hoc signing and are not notarized. Linux needs a graphical desktop and GTK / WebKitGTK libraries; see the user guide for setup.",
    featurePreviewTitle: "Preview content beside your terminals",
    featurePreviewBody: "Open several file, image or website previews in their own tabs. Resize the panel and highlight code while preserving every line and space. Agents can open previews through MCP.",
    featureActionsTitle: "Save and review project actions",
    featureActionsBody: "Discover actions without switching away to start an Agent. Select all, edit entries and remove duplicates before confirming from the same window.",
    featureNotificationsTitle: "Pause third-party notifications",
    featureNotificationsBody: "A toolbar switch controls configured channels. Messages include time and session context; desktop WeChat notifications are available on Windows.",
    featurePlatformsTitle: "One command, three platforms",
    featurePlatformsBody: "Choose Windows EXE/MSI, a Mac DMG for Apple Silicon or Intel, or the Linux x64 .deb. The npm package contains all four builds and starts the matching application locally.",
    roadmap11Title: "macOS, content previews and smoother saved actions",
    roadmap11Body: "v0.11.0 adds Apple Silicon and Intel packages, multiple preview tabs with code highlighting, a continuous saved-action review and third-party notification controls. GitHub Actions builds desktop installers and publishes the Windows/macOS npm package.",
    roadmap12Title: "Linux, read-only access and a smaller desktop app",
    roadmap12Body: "v0.12.1 includes Linux desktop and npm support, read-only remote links, command environments and mobile input improvements. The built-in One Ring engine and its runtime have been removed; public MCP tools and ordinary Agent terminals remain.",
    navRelay: "Remote relay",
    sceneProtocol: "RELAY / LAN / VPN",
    relayDeploy: "Deploy your relay ↗",
    relaySetup: "Read the connection guide ↗",
    relayCompatibility: "Desktop app: Windows x64, macOS Apple Silicon / Intel and Linux x64. Relay: Linux / macOS / Windows, x64 / arm64 and containers. Read-only links let others view without sending terminal input.",
  },
  zh: {
    navMcp: "MCP 操控",
    mcpIndex: "MCP / 让 AI 操控 AGENT",
    mcpTitle: "从指令到结果。",
    mcpLead: "点选任一步，看看接入的 AI 如何通过 Termexo MCP 找到终端、发出指令，再读回 Agent 的实际输出。",
    mcpDemoLabel: "交互示例",
    mcpPlay: "播放示例",
    mcpStop: "停止播放",
    mcpDemoSteps: "MCP 示例步骤",
    mcpConnect: "找到终端",
    mcpConnectBody: "在项目中找到正在运行的 Agent。",
    mcpSend: "发送指令",
    mcpSendBody: "把指令提交给选中的 Agent。",
    mcpRead: "读回结果",
    mcpReadBody: "查看终端实际返回的内容。",
    mcpSetup: "在电脑上配置 MCP",
    mcpFlowCaption: "输出为示意。使用时，回复来自 Termexo 中运行的真实终端。",
    mcpStep1Title: "准备好工作台",
    mcpStep1Body: "打开 Termexo 和项目，确认 Agent CLI 已安装、已登录，并保持 Termexo 运行。",
    mcpStep2Title: "打开 MCP 连接",
    mcpStep2Body: "进入「设置 → AI 操控（MCP）」，开启本地服务和自动接入，选择权限并应用。服务显示「运行中」后，启动或重启 Termexo 里的 Agent。",
    mcpStep3Title: "用一句话检查连接",
    mcpStep3Body: "把下面的只读检查发给已接入的 Agent。看到真实工具调用返回你的工作区和终端，就说明接好了。",
    mcpCheckLabel: "第一次：先确认连接成功",
    mcpCheckPrompt: "请通过 Termexo MCP 列出我的工作区和终端，告诉我哪些正在运行。先不要修改任何内容。",
    mcpTryLabel: "然后：操作已有的 OPENCODE 终端",
    mcpTryPrompt: "请通过 Termexo MCP 找到当前工作区中正在运行的 OpenCode 终端，发送 hi 并提交回车，然后读取它的回复。如果有多个匹配的终端，先列出名称让我选择。",
    mcpBoundary: "六种 Agent 都支持已有终端交互。任务看板执行支持 Claude Code、Codex、OpenCode、Pi Agent 和 Grok Build；发送成功或任务启动成功，不代表已经完成。",
    mcpFullGuide: "打开 MCP 逐步使用说明 →",
    navSolutions: "使用场景",
    solutionsIndex: "项目方向 / 解决方案场景",
    solutionsTitle: "让 AI 开发工作连起来。",
    solutionsProblem: "多个项目、多个编程 Agent，往往意味着分散的窗口、错过的确认，以及需要反复交代的背景。Termexo 把任务和状态集中呈现，让中断的工作能继续、离开电脑也能接着处理。",
    workflowAlt: "项目与任务进入本地 Termexo 工作台，统一管理 Agent、模型配置和会话，并通过可选远程连接跨设备接续。",
    workflowCaption: "工作流程示意：由人分配任务和处理确认，Agent 始终在宿主电脑上运行。",
    individualLabel: "个人开发者",
    individualTitle: "项目再多，也少些来回切换。",
    individualProjectsTitle: "主业、个人产品与开源项目并行",
    individualProjectsBody: "按项目保存终端、模型和布局；让不同 Agent 写功能、补测试、做审查，集中看清谁在执行、谁在等你。",
    individualResumeTitle: "隔天继续，或换个 Agent 接着做",
    individualResumeBody: "找回已保存的原生会话，或整理包含目标、进度和下一步的交接包，减少重复交代背景。",
    individualRemoteTitle: "离开电脑，也能接着处理",
    individualRemoteBody: "电脑保持运行，用手机接回原来的终端，查看输出、回复确认，或发送下一步指令。",
    enterpriseLabel: "企业研发团队成员",
    enterpriseTitle: "组织开发流程，掌控运行环境。",
    enterpriseTasksTitle: "让工程师看清项目与任务进度",
    enterpriseTasksBody: "按业务项目组织工作区，由工程师通过任务看板和 Agent 状态分配工作、检查结果，并整理任务交接。",
    enterpriseProfilesTitle: "统一管理供应商与环境配置",
    enterpriseProfilesBody: "集中管理不同供应商、兼容网关的模型、账号和网络 Profile，查看支持的供应商余量。",
    enterpriseRemoteTitle: "远程接入自己管理的研发电脑",
    enterpriseRemoteBody: "工作台运行在企业控制的 Windows、Mac 或 Linux 电脑上，通过自建中继或可信局域网 / VPN，接回仍在运行的长任务。",
    solutionsBoundaryTitle: "当前能力与长期方向",
    solutionsBoundaryBody: "当前适合个人和团队成员使用各自的工作台；多人共享、细粒度权限、统一审计及更完整的自动编排仍属规划能力。",
    solutionsDataNote: "本地优先指工作台的运行与管理方式；代码和模型请求是否发往外部，仍由所选 Agent 与模型服务配置决定。",
    skip: "跳到主要内容",
    exploreWorkbench: "探索工作台",
    pauseMotion: "暂停动效",
    resumeMotion: "开启动效",
    reducedMotion: "已跟随系统减少动效",
    copyFailed: "请选择命令复制",
    navWorkbench: "工作台",
    navCapabilities: "功能",
    navRoadmap: "开发计划",
    navPrinciples: "隐私",
    navGuide: "使用说明",
    navDownload: "下载",
    github: "GitHub",
    eyebrow: "本地优先的 AI 开发工作台",
    heroLine1: "多个 AI Agent。",
    heroLine2: "一个工作台。",
    heroLead: "把编程 Agent 集中在同一个工作台。通过 Termexo MCP，让接入的 AI 向终端发指令、读回实际输出。",
    heroDownload: "下载 Termexo",
    heroMcp: "探索 MCP 操控",
    heroDemo: "观看 30 秒实录",
    launchRemote: "按需开启手机访问",
    sceneCaption: "Termexo 桌面与手机实拍截图，连接效果为示意。",
    runFromNpm: "立即运行",
    download: "下载安装包",
    copyCommand: "复制",
    copied: "已复制",
    viewSource: "查看源码",
    metaLocal: "本地优先 · MIT 开源",
    metaNpm: "一条命令启动",

    workbenchTitle: "谁需要你，一眼看见。",
    workbenchLead:
      "支持的编程 Agent 在真实终端里运行。跨项目查看状态，找到正在等你输入或确认的终端，之后还能恢复各 CLI 的原生会话。",
    demoAgents: "Antigravity · 两个真实会话",
    demoLabel: "30 秒真实桌面录屏 · v0.10.6",
    demoCaption:
      "v0.10.6 的两个真实 Antigravity 会话：查看完成提醒、返回对应会话、回复后继续执行，再分屏查看结果。已剪去等待片段，附中英字幕。",
    metricTabsTitle: "想开多少开多少",
    metricTabsBody: "每个会话都留在标签里，只把你正在看的摆出来。",
    metricGridTitle: "网格自己排",
    metricGridBody: "1 到 6 行列随便组合，每个项目记住自己的布局。",
    metricModelTitle: "换模型不换 CLI",
    metricModelBody: "还是你熟悉的 Claude Code，只是指向了别的供应商。",
    metricLocalTitle:
      "默认在本地运行",
    metricLocalBody:
      "工作台运行在你的电脑上。需要远程操作时，再连接自建中继，或通过可信局域网 / VPN 访问。",

    attentionTitle: "Agent 卡住了，它会喊你。",
    attentionLead:
      "多个项目的等待授权、等待输入和完成消息，通过常驻提示条与系统通知集中呈现。Windows 上还会持续闪动任务栏图标，直到提醒被处理。",
    attentionPoint1: "等待授权、等待输入、已完成，一眼就能分清",
    attentionPoint2: "在其他终端工作时，也能看见仍待处理的提醒",
    attentionPoint3: "点提示条直接跳到那个终端",
    attentionCaption: "一个 Agent 在等你拍板，另一个还在干活。",

    sessionTitle: "接着昨天的会话聊。",
    sessionLead:
      "跨项目搜索 Claude Code、Codex、OpenCode、Pi Agent、Grok Build 和 Antigravity 的本地会话。Termexo 调用各 CLI 的原生恢复命令接回上下文，不改写会话文件。",
    sessionPoint1: "按名称、路径、分支或模型跨项目搜索",
    sessionPoint2: "通过各 Agent 自己的命令恢复原生会话",
    sessionPoint3: "原生会话文件只读，Termexo 不改也不删",
    sessionCaption: "本地所有会话，可搜索，一键恢复",

    modelTitle: "同一个 CLI，换个模型跑。",
    modelLead:
      "还是用 Claude Code，但把它指向 DeepSeek、MiniMax、GLM 或你自己的兼容网关。每个存成一个 Profile，两下就能切——不用重装，也不用手动改配置文件。",
    modelPoint1: "Anthropic、DeepSeek、MiniMax、GLM，或任意兼容 Endpoint",
    modelPoint2: "API Key 由 Windows 凭据管理器、macOS 钥匙串或 Linux Secret Service 保存",
    modelPoint3: "一个项目里的 Claude 终端可以一次性全部切换",
    modelCaption: "密钥由操作系统保管，界面只显示是否已配置",

    taskTitle: "把活儿交给 Agent。",
    taskLead:
      "写清楚要做什么、做到什么算完成，选好 Agent 和项目，这条任务就会变成一个真实终端。它会把自己的进展回报到看板上，你不用逐个盯着终端也知道谁在跑。",
    taskPoint1: "待办、执行中、已完成、已验收——卡片由终端自己推动",
    taskPoint2: "任务可以交给 Claude Code、Codex、OpenCode、Pi Agent 或 Grok Build",
    taskPoint3: "验收不通过时写一句反馈，任务带着反馈回到执行中",
    taskCaption: "一条任务带着验收标准从待办走到已验收",
    capabilitiesTitle: "那些你一直在手动做的事。",
    capabilitiesLead:
      "用 AI 写代码真正麻烦的往往不是模型，而是记住哪个终端在干什么，以及明天再把这一切重新搭一遍。",
    now: "现在就能用",
    roadmapTag: "以后会有",
    featureWorkspaceTitle: "关掉再打开，东西都还在",
    featureWorkspaceBody:
      "项目目录、网格布局、终端和主题色跟着工作区一起回来。拖拽工作区条目，就能调整项目顺序。",
    featureSessionTitle: "关掉的东西没丢",
    featureSessionBody:
      "翻出各项目里的 Claude Code、Codex、OpenCode、Pi Agent、Grok Build 或 Antigravity 历史会话，恢复原生上下文。",
    featureTasksTitle: "把一条任务交给 Agent",
    featureTasksBody:
      "写清楚任务和验收标准，选一个 Agent，它就变成一个真实终端，并把自己的进展回报到看板上。",
    featureModelTitle: "同一个活，换个便宜模型试试",
    featureModelBody:
      "把同一个 CLI 指向别的供应商，效果不好随时切回来，所有密钥都在系统安全存储里。",
    featureStatusTitle: "需要你的那一刻就知道",
    featureStatusBody:
      "等待、思考、需要授权、完成、失败，跨项目集中呈现，并提供系统通知与 Windows 任务栏提醒。",
    featureLanguageTitle: "用你熟悉的语言工作",
    featureLanguageBody:
      "自动跟随系统语言，也可随时切换简体中文、英语、西班牙语、法语、德语、日语和韩语。",
    featureQuotaTitle: "额度烧完之前就知道",
    featureQuotaBody:
      "查看支持的供应商报告的额度和重置时间。Grok Build 免费额度用尽会明确显示；查不到的百分比不会写成 0%。",
    featureRemoteTitle:
      "跨网络接回工作台",
    featureRemoteBody:
      "通过自建中继，用手机连接桌面正在运行的同一批终端。桌面无需公网 IP，也无需路由器端口映射。",
    featureMcpTitle: "让一个 Agent 操控另一个",
    featureMcpBody: "通过本地 MCP，向六种 Agent 的已有终端发送指令并读取输出，也能管理任务和修改获准的设置。访问范围由你选择。",
    mcpGuide: "开始使用 MCP →",

    remoteTitle:
      "换个网络，接着用。",
    remoteLead:
      "桌面主动建立到中继的出站隧道。手机、平板或另一台电脑打开中继链接，就能查看输出、继续操作同一个终端。桌面无需公网 IP，也无需路由器端口映射。",
    remotePoint1:
      "自建 termexo-relay，通过注册码或中继账号登记桌面设备",
    remotePoint2:
      "浏览器使用 HTTPS 入口，v2 会话帧采用 AES-256-GCM 加密",
    remotePoint3:
      "电脑保持开机、Termexo 连接中继；中继登录与桌面访问令牌独立校验",
    remoteCaption: "屏幕上是同一个终端，桌面端正在跑的那个。",

    roadmapTitle: "版本里程碑。",
    roadmapLead:
      "回顾工作台的演进，也可以前往 GitHub 查看最新版本说明。",
    roadmapArchive: "展开早期里程碑",
    shipped: "已发布",
    planned: "计划中",
    roadmap02Title: "几个 Agent 并排干活",
    roadmap02Body:
      "识别 Claude 与 Codex、多个登录账号互不干扰、恢复会话、自定义网格、模型 Profile、七种界面语言，全部存在本地。",
    roadmap04Title: "账号、安装和网络",
    roadmap04Body:
      "一键装好或升级 CLI，多个登录账号分开管理，为公司内网配代理，并盯住套餐还剩多少额度。",
    roadmap06Title: "在 Agent 之间交接工作",
    roadmap06Body: "会话摘要、把任务从一个 Agent 转给另一个、任务分派和通知。",
    roadmap07Title:
      "远程中继访问",
    roadmap07Body:
      "v0.10.0 已发布：自建中继、注册码或账号登记、级联访问地址与 v2 加密会话。浏览器操作的是桌面正在运行的同一批终端。",
    roadmap10Title: "查看每个 Agent 的状态",
    roadmap10Body:
      "工作区图标简洁显示 Agent 状态和当前窗口名称。可在终端中确认完成，当前终端的分支以 Git 信息为准。",
    roadmapPatchTitle: "状态更可靠，设置更清楚",
    roadmapPatchBody: "修复 Codex 恢复与完成状态、Grok 和 Antigravity 启动问题，增加按 Agent 区分的移动快捷键及更清楚的远程访问和 MCP 引导。",
    roadmapResponsiveTitle: "终端响应更稳定，Codex 手机快捷键更完整",
    roadmapResponsiveBody: "手机重连时桌面端输入和滚动保持响应，Windows 终端可可靠粘贴剪贴板文本，Codex 面板新增 ⇧← 编辑排队输入。",
    roadmapLatestTitle: "项目整理与更清晰的账号设置",
    roadmapLatestBody: "工作区文件夹、标签与图标，账号登录方式选择，模型目录与升级建议，以及关闭活动 Agent 终端前确认。",
    roadmapSetupTitle: "Agent 安装更简单，新增 Pi 支持",
    roadmapSetupBody: "六种 Agent 安装与更新有清楚引导，Antigravity 使用官方升级，待处理提醒持续闪动到确认。",
    roadmapProxyTitle: "代理更干净，标题与标签状态更清晰",
    roadmapProxyBody: "Windows 代理单大小写并覆盖所有终端，旧版 OpenCode 也能扫描会话，Codex 标题去掉指令杂质，完成态与选中态不再混淆。",
    roadmapMcpTitle: "本地 MCP 操控，Agent 自动接入",
    roadmapMcpBody: "19 个工具支持终端、任务和设置。开启服务并选择权限，再启动 Claude Code、Codex、OpenCode、Grok Build 或 Antigravity。已经运行的 Agent 需重启后接入。",

    principlesTitle: "你的工作，\n留在你的电脑。",
    principlesLead:
      "Termexo 默认在本地运行。需要时开启远程访问，通过自建中继或可信局域网 / VPN 连接，自己管理桌面访问令牌，并可在设置中断开。Agent CLI 仍会连接你配置的模型服务。",
    principle1Title: "默认就在本地",
    principle1Body:
      "项目路径、会话、终端状态和设置都存在你硬盘上的文件里，没有需要登录的云服务。",
    principle2Title: "API Key 不在配置文件里",
    principle2Body:
      "API Key 由 Windows 凭据管理器、macOS 钥匙串或 Linux Secret Service 保存；程序记录凭据引用，界面可显示是否已配置，但不返回明文。",
    principle3Title: "你的会话文件只读",
    principle3Body:
      "Termexo 读 Claude Code 和 Codex 写下的文件，并调用它们自己的恢复命令，绝不改写、重命名或删除你的历史记录。",

    ctaTitle: "一条命令，不用注册。",
    ctaLead:
      "同一个 npm 包包含 Windows x64、Apple Silicon 和 Intel 的完整 Mac 应用，以及 Linux x64。安装 Node.js 18.18+ 后，一条命令自动选择对应版本，无需注册 Termexo 账号。",
    getRelease: "下载安装包",
    starGithub: "在 GitHub 上 Star",
    supportProject:
      "MIT 开源。如果 Termexo 帮到了你的工作，欢迎在 GitHub 点个 Star，让更多开发者发现它；也欢迎反馈问题和参与贡献。",
    indexWorkbench: "工作台",
    indexAttention: "02 / 一个都不漏",
    indexSession: "03 / 什么都没丢",
    indexModel: "04 / 模型路由",
    indexTask: "05 / 任务看板",
    indexRemote: "06 / 任意设备",
    indexCapabilities: "07 / 功能",
    indexRoadmap: "08 / 开发计划",
    indexPrivacy: "09 / 隐私",
    indexCta: "一起来建设",
    footerReleases: "发布版本",
    footerIssues: "问题反馈",
    footerTagline: "一个窗口，装下所有编程 Agent",
    siteVisits: "官网累计访问量（PV）",
    counterNotice: "第三方统计仅记录官网访问；“—”表示暂不可用。",
    platformSupport: "Windows x64 · macOS 12+（Apple Silicon / Intel）· Linux x64 · 三大平台均支持 npm",
    platformLimits: "Windows 安装包尚未正式签名，Mac 使用 ad-hoc 临时签名且尚未公证。Linux 需要图形桌面及 GTK / WebKitGTK 系统库，安装步骤见使用说明。",
    featurePreviewTitle: "内容预览，与终端并列打开",
    featurePreviewBody: "文件、图片和网站可打开为多个独立标签，窗口宽度可调。代码只加语法高亮，保留原始换行和空格；Agent 也能通过 MCP 打开预览。",
    featureActionsTitle: "识别、编辑并保存项目操作",
    featureActionsBody: "在同一窗口启动或选择 Agent 并识别常用操作；支持全选、逐项编辑、自动去重，再从固定在底部的按钮确认。",
    featureNotificationsTitle: "随时暂停第三方通知",
    featureNotificationsBody: "顶部开关统一控制已配置的通知渠道，消息包含时间和会话信息；桌面微信通知在 Windows 上提供。",
    featurePlatformsTitle: "三大平台，一条命令启动",
    featurePlatformsBody: "提供 Windows EXE/MSI、Apple Silicon 和 Intel 的 Mac DMG，以及 Linux x64 的 .deb。同一个 npm 包包含四种构建，启动时自动选择对应应用。",
    roadmap11Title: "macOS、内容预览与更连贯的常用操作",
    roadmap11Body: "v0.11.0 加入 Apple Silicon 与 Intel 安装包、多个内容预览标签与代码高亮、同一窗口的常用操作识别审核，以及第三方通知开关。GitHub Actions 自动编译桌面安装包并发布 Windows/macOS 通用 npm 包。",
    roadmap12Title: "Linux、远程只读与更轻量的桌面版",
    roadmap12Body: "v0.12.1 支持 Linux 桌面与 npm、远程只读链接、命令目录及环境变量，并改进手机输入。已移除内置 One Ring 及其运行时；保留公开 MCP 和普通 Agent 终端。",
    navRelay: "中继访问",
    sceneProtocol: "中继 / 局域网 / VPN",
    relayDeploy: "部署自己的中继 ↗",
    relaySetup: "查看连接步骤 ↗",
    relayCompatibility: "桌面版支持 Windows x64、macOS Apple Silicon / Intel 和 Linux x64。中继支持 Linux / macOS / Windows、x64 / arm64 和容器部署。可使用只读链接分享查看，不开放终端输入。",
    navFleet: "Fleet 舰队",
    fleetIndex: "生态扩展 / TERMEXO FLEET · 预览版 V0.1",
    fleetTitle: "把多台电脑的 Agent 连起来。",
    fleetLead:
      "Termexo Fleet 是基于 Termexo MCP 打造的独立桌面指挥中枢：按 L1–L4 难度自动路由账号与模型、允许父 Agent 在独立 Git Worktree 中自主派生子 Agent、统一调度多台本机/局域网 Termexo 并量化节省成本——全程零黑盒，所有任务真实运行在 Termexo 终端中。",
    fleetPromoTitle: "Termexo Fleet 产品宣传片",
    fleetPromoDuration: "45 秒",
    fleetPromoMp4: "打开 MP4",
    fleetTabDeck: "任务甲板与 DAG",
    fleetTabSwarm: "子 Agent 蜂群树",
    fleetTabRouting: "L1–L4 难度天梯",
    fleetTabTopology: "多机舰队拓扑",
    fleetTabAnalytics: "效能账本与告警",
    fleetFrameBadge: "零黑盒 · 真实 Termexo 终端执行",
    fleetCapDeck:
      "内置一键场景模板与实时路由预判条，直观编排三段式流水线与多阶段 DAG，点击卡片即可拉出侧滑实时终端抽屉直接对话。",
    fleetCapSwarm:
      "清晰呈现父子 Agent 派生树、独立 Git Worktree 分支与递归深度 / 并发 / 总派生预算三大安全护栏仪表盘。",
    fleetCapRouting:
      "输入任意需求实时测试 L1–L4 命中哪台机器与账号；点击槽位上的档位胶囊即可即时调整分工并查看健康状态。",
    fleetCapTopology:
      "星型拓扑统一管理 Windows、macOS、Linux 多台 Termexo，支持局域网 / Tailscale VPN 连通性探测与标签亲和派发。",
    fleetCapAnalytics:
      "本地 SQLite 账本量化难度路由节省比例、模型与节点效能排行，支持飞书 / 企微 / Slack Webhook 与 Termexo 微信联动告警。",
    fleetPillar1Title: "L1–L4 难度路由与自动容灾",
    fleetPillar1Body:
      "轻量任务走低成本 L1 槽位，复杂重构用 L3，关键审查强制 L4 跨模型家族异构复核；429/402/422 自动冷却切号与升档重试。",
    fleetPillar2Title: "自主派生子 Agent + 硬性护栏",
    fleetPillar2Body:
      "内置反向 MCP（:7425/mcp），父 Agent 可自主提交并行 DAG 或在独立 Git Worktree 中雇佣子 Agent，受深度、并发与预算护栏保护。",
    fleetPillar3Title: "多机局域网 / VPN 算力协同",
    fleetPillar3Body:
      "通过本机、受控私网 LAN 或 Tailscale VPN 连接多台 Termexo，内置延迟与能力探测，按 #windows / #macos 标签智能分派。",
    fleetPillar4Title: "效能账本与多通道通知",
    fleetPillar4Body:
      "本地统计成功率、平均耗时、升档次数与相对全量 L3 的节省比例，完工或等待审批自动推送飞书 / 企微 / Slack / 微信。",
    fleetDownloadBtn: "下载 Fleet 预览版（Windows）",
    fleetRepoBtn: "前往 Termexo Fleet GitHub →",
  },
};

const languageButtons = document.querySelectorAll("[data-lang]");
const translatedElements = document.querySelectorAll("[data-i18n]");
const nav = document.querySelector("[data-nav]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const header = document.querySelector("[data-header]");
const copyCommandButton = document.querySelector("[data-copy-command]");
const copyCommandLabel = document.querySelector("[data-copy-label]");
let activeLanguage = "en";

function setLanguage(language) {
  const dictionary = translations[language] || translations.en;
  activeLanguage = language in translations ? language : "en";
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  const workflow = document.querySelector("[data-workflow]");
  if (workflow) {
    const asset = `assets/termexo-workflow-${activeLanguage}`;
    workflow.querySelector("source").srcset = `${asset}-mobile.svg`;
    workflow.querySelector("img").src = `${asset}.svg`;
    workflow.querySelector("img").alt = dictionary.workflowAlt;
  }
  document.title =
    language === "zh"
      ? "Termexo — 通过 MCP，让 AI 操控六种 Agent"
      : "Termexo — Let AI operate your coding agents through MCP";

  translatedElements.forEach((element) => {
    const value = dictionary[element.dataset.i18n];
    if (value) element.textContent = value;
    if (element.dataset.i18n === "navGuide") {
      element.setAttribute(
        "href",
        language === "zh" ? "guide.html" : "guide.en.html",
      );
    }
    if (["mcpGuide", "mcpFullGuide"].includes(element.dataset.i18n)) {
      element.setAttribute("href", language === "zh" ? "guide.html#ai-control" : "guide.en.html#ai-control");
    }
    if (element.dataset.i18n === "relaySetup") {
      element.setAttribute(
        "href",
        language === "zh" ? "guide.html#remote" : "guide.en.html#remote",
      );
    }
  });

  document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
    const value = dictionary[element.dataset.i18nAria];
    if (value) element.setAttribute("aria-label", value);
  });

  languageButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.lang === language);
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.lang === language),
    );
  });

  try {
    localStorage.setItem("termexo.website.language", activeLanguage);
  } catch {
    /* Preferences are optional. */
  }
  document.dispatchEvent?.(new Event("languagechange"));
}

languageButtons.forEach((button) => {
  button.addEventListener("click", () => setLanguage(button.dataset.lang));
});

copyCommandButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText("npx termexo@latest");
  } catch {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(".install-command code"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    copyCommandLabel.textContent = translations[activeLanguage].copyFailed;
    return;
  }
  copyCommandLabel.textContent = translations[activeLanguage].copied;
  copyCommandButton.classList.add("copied");
  window.setTimeout(() => {
    copyCommandLabel.textContent = translations[activeLanguage].copyCommand;
    copyCommandButton.classList.remove("copied");
  }, 1600);
});

menuToggle.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(open));
});

nav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    nav.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && nav.classList.contains("open")) {
    nav.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.focus();
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!nav.contains(event.target) && !menuToggle.contains(event.target)) {
    nav.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
  }
});

const revealObserver =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries, observer) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("visible");
              observer.unobserve(entry.target);
            }
          });
        },
        { rootMargin: "0px 0px -2% 0px", threshold: 0.02 },
      )
    : null;

document.querySelectorAll(".reveal").forEach((element) => {
  if (revealObserver) revealObserver.observe(element);
  else element.classList.add("visible");
});
document.querySelector("[data-year]").textContent = new Date().getFullYear();

let storedLanguage;
try {
  storedLanguage = localStorage.getItem("termexo.website.language");
} catch {
  /* Use the default language. */
}
setLanguage(storedLanguage || (navigator.language.startsWith("zh") ? "zh" : "en"));

const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const precisePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
const motionToggle = document.querySelector("[data-motion-toggle]");
const motionLabel = document.querySelector("[data-motion-label]");
const hero = document.querySelector(".launch-hero");
const scene = hero.querySelector(".launch-scene");
const workbench = document.querySelector("#workbench .product-frame");
const ctaSection = document.querySelector("#download");
let motionPausedByUser = false;
let motionFrame = 0;
let pointerX = 0;
let pointerY = 0;

function isMotionPaused() {
  return motionPausedByUser || motionPreference.matches;
}

/* ── 1. Zero-Gravity Orbital Particle Field (Hero Canvas) ────────────────── */
const heroCanvas = document.querySelector("[data-hero-canvas]");
const heroParticlesState = {
  active: true,
  raf: 0,
  width: 0,
  height: 0,
  dpr: 1,
  mouseX: -9999,
  mouseY: -9999,
  mouseActive: false,
  ripples: [],
  particles: [],
  time: 0,
};

function initHeroParticles() {
  if (!heroCanvas || typeof heroCanvas.getContext !== "function") return;
  const ctx = heroCanvas.getContext("2d");
  if (!ctx) return;

  const palette = [
    "rgba(16, 185, 129, ",   // Termexo emerald
    "rgba(14, 165, 233, ",   // Spatial cyan
    "rgba(99, 102, 241, ",   // Antigravity iris
    "rgba(17, 19, 24, ",     // Crisp obsidian
  ];

  const resize = () => {
    const rect = hero.getBoundingClientRect();
    heroParticlesState.width = Math.max(1, rect.width);
    heroParticlesState.height = Math.max(1, rect.height);
    heroParticlesState.dpr = Math.min(window.devicePixelRatio || 1, 2);
    heroCanvas.width = Math.round(heroParticlesState.width * heroParticlesState.dpr);
    heroCanvas.height = Math.round(heroParticlesState.height * heroParticlesState.dpr);
    ctx.setTransform(heroParticlesState.dpr, 0, 0, heroParticlesState.dpr, 0, 0);

    const count = heroParticlesState.width < 650 ? 64 : 148;
    const cx = heroParticlesState.width * 0.5;
    const cy = Math.min(heroParticlesState.height * 0.29, 320);
    const rxBase = Math.min(heroParticlesState.width * 0.48, 660);
    const ryBase = Math.min(heroParticlesState.height * 0.33, 300);

    heroParticlesState.particles = Array.from({ length: count }, (_, i) => {
      const ring = i % 3;
      const angle = (i / count) * Math.PI * 2 + ring * 0.42;
      // Frame the centered headline cleanly in a luminous outer halo
      const spread = 0.68 + ring * 0.19 + (Math.sin(i * 12.9898) * 0.5 + 0.5) * 0.22;
      const homeX = cx + Math.cos(angle) * rxBase * spread;
      const homeY = cy + Math.sin(angle) * ryBase * spread;
      return {
        angle,
        speed: (0.00042 + (i % 7) * 0.00011) * (ring === 1 ? -1 : 1),
        spread,
        x: homeX,
        y: homeY,
        vx: 0,
        vy: 0,
        size: 1.6 + (i % 4) * 0.65,
        capsule: i % 3 !== 0,
        length: 5 + (i % 4) * 3.2,
        alpha: 0.22 + (i % 5) * 0.11,
        color: palette[i % palette.length],
        phase: i * 0.71,
      };
    });
    drawHeroFrame(ctx, true);
  };

  function drawHeroFrame(context, staticOnly = false) {
    const { width, height, particles, ripples } = heroParticlesState;
    context.clearRect(0, 0, width, height);
    const cx = width * 0.5;
    const cy = Math.min(height * 0.29, 320);
    const rxBase = Math.min(width * 0.48, 660);
    const ryBase = Math.min(height * 0.33, 300);

    if (!staticOnly) heroParticlesState.time += 0.016;
    const t = heroParticlesState.time;

    // Subtle expanding zero-gravity shockwaves on click
    for (let r = ripples.length - 1; r >= 0; r--) {
      const ripple = ripples[r];
      if (!staticOnly) {
        ripple.radius += 7.5;
        ripple.alpha *= 0.945;
      }
      if (ripple.alpha < 0.015) {
        ripples.splice(r, 1);
        continue;
      }
      context.beginPath();
      context.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
      context.strokeStyle = `rgba(16, 185, 129, ${ripple.alpha.toFixed(3)})`;
      context.lineWidth = 1.25;
      context.stroke();
    }

    const nearCursor = [];
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (!staticOnly) {
        p.angle += p.speed;
      }
      const targetX = cx + Math.cos(p.angle) * rxBase * p.spread + Math.sin(t + p.phase) * 8;
      const targetY = cy + Math.sin(p.angle) * ryBase * p.spread + Math.cos(t * 0.8 + p.phase) * 6;

      if (!staticOnly) {
        p.vx += (targetX - p.x) * 0.032;
        p.vy += (targetY - p.y) * 0.032;

        if (heroParticlesState.mouseActive) {
          const dx = p.x - heroParticlesState.mouseX;
          const dy = p.y - heroParticlesState.mouseY;
          const distSq = dx * dx + dy * dy;
          const radius = 185;
          if (distSq < radius * radius && distSq > 1) {
            const dist = Math.sqrt(distSq);
            const force = (1 - dist / radius) * 1.5;
            const nx = dx / dist;
            const ny = dy / dist;
            p.vx += nx * force * 1.9 - ny * force * 0.7;
            p.vy += ny * force * 1.9 + nx * force * 0.7;
            if (dist < 148) nearCursor.push(p);
          }
        }

        for (let r = 0; r < ripples.length; r++) {
          const ripple = ripples[r];
          const dx = p.x - ripple.x;
          const dy = p.y - ripple.y;
          const dist = Math.hypot(dx, dy) || 1;
          if (Math.abs(dist - ripple.radius) < 38) {
            p.vx += (dx / dist) * 1.7 * ripple.alpha * 3;
            p.vy += (dy / dist) * 1.7 * ripple.alpha * 3;
          }
        }

        p.vx *= 0.86;
        p.vy *= 0.86;
        p.x += p.vx;
        p.y += p.vy;
      } else {
        p.x = targetX;
        p.y = targetY;
      }

      // Softly attenuate particles that drift close to the center headline zone
      const normCenter = Math.hypot((p.x - cx) / Math.max(240, rxBase * 0.56), (p.y - cy) / Math.max(135, ryBase * 0.58));
      const haloMask = Math.min(1, Math.max(0.08, (normCenter - 0.55) / 0.55));
      const breathe = 0.82 + Math.sin(t * 1.4 + p.phase) * 0.18;
      const alpha = p.alpha * breathe * haloMask;
      if (alpha < 0.025) continue;

      context.fillStyle = `${p.color}${alpha.toFixed(3)})`;
      if (p.capsule) {
        const heading = Math.atan2(p.y - cy, p.x - cx) + Math.PI * 0.5;
        context.save();
        context.translate(p.x, p.y);
        context.rotate(heading);
        const w = p.length * breathe;
        const h = Math.max(1.8, p.size * 0.82);
        context.beginPath();
        context.roundRect(-w * 0.5, -h * 0.5, w, h, h * 0.5);
        context.fill();
        context.restore();
      } else {
        context.beginPath();
        context.arc(p.x, p.y, p.size * breathe, 0, Math.PI * 2);
        context.fill();
      }
    }

    // Fleeting agent-mesh constellation threads near cursor
    if (!staticOnly && nearCursor.length > 1) {
      context.lineWidth = 0.85;
      for (let i = 0; i < nearCursor.length; i++) {
        for (let j = i + 1; j < nearCursor.length; j++) {
          const a = nearCursor[i];
          const b = nearCursor[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 92) {
            const opacity = (1 - d / 92) * 0.22;
            context.beginPath();
            context.moveTo(a.x, a.y);
            context.lineTo(b.x, b.y);
            context.strokeStyle = `rgba(16, 185, 129, ${opacity.toFixed(3)})`;
            context.stroke();
          }
        }
      }
    }
  }

  const loop = () => {
    heroParticlesState.raf = 0;
    if (!heroParticlesState.active || isMotionPaused() || document.hidden) return;
    drawHeroFrame(ctx, false);
    heroParticlesState.raf = requestAnimationFrame(loop);
  };

  heroParticlesState.start = () => {
    if (!heroParticlesState.raf && heroParticlesState.active && !isMotionPaused() && !document.hidden) {
      heroParticlesState.raf = requestAnimationFrame(loop);
    }
  };
  heroParticlesState.stop = () => {
    if (heroParticlesState.raf) {
      cancelAnimationFrame(heroParticlesState.raf);
      heroParticlesState.raf = 0;
    }
    drawHeroFrame(ctx, true);
  };

  hero.addEventListener("pointermove", (event) => {
    if (isMotionPaused() || !precisePointer.matches) return;
    const rect = hero.getBoundingClientRect();
    heroParticlesState.mouseX = event.clientX - rect.left;
    heroParticlesState.mouseY = event.clientY - rect.top;
    heroParticlesState.mouseActive = true;
  }, { passive: true });

  hero.addEventListener("pointerleave", () => {
    heroParticlesState.mouseActive = false;
  });

  hero.addEventListener("pointerdown", (event) => {
    if (isMotionPaused() || event.target.closest("a, button")) return;
    const rect = hero.getBoundingClientRect();
    heroParticlesState.ripples.push({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      radius: 12,
      alpha: 0.38,
    });
  }, { passive: true });

  window.addEventListener("resize", resize, { passive: true });
  resize();
}

/* ── 2. Morphing Obsidian Particle Constellation (CTA Canvas) ────────────── */
const ctaCanvas = document.querySelector("[data-cta-canvas]");
const ctaParticlesState = {
  active: false,
  raf: 0,
  width: 0,
  height: 0,
  dpr: 1,
  time: 0,
  particles: [],
};

function initCtaParticles() {
  if (!ctaCanvas || !ctaSection || typeof ctaCanvas.getContext !== "function") return;
  const ctx = ctaCanvas.getContext("2d");
  if (!ctx) return;

  const count = 132;
  const colors = [
    "rgba(52, 211, 153, ",
    "rgba(56, 189, 248, ",
    "rgba(129, 140, 248, ",
    "rgba(241, 245, 249, ",
  ];

  const resize = () => {
    const rect = ctaSection.getBoundingClientRect();
    ctaParticlesState.width = Math.max(1, rect.width);
    ctaParticlesState.height = Math.max(1, rect.height);
    ctaParticlesState.dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctaCanvas.width = Math.round(ctaParticlesState.width * ctaParticlesState.dpr);
    ctaCanvas.height = Math.round(ctaParticlesState.height * ctaParticlesState.dpr);
    ctx.setTransform(ctaParticlesState.dpr, 0, 0, ctaParticlesState.dpr, 0, 0);

    if (ctaParticlesState.particles.length === 0) {
      ctaParticlesState.particles = Array.from({ length: count }, (_, i) => ({
        x: ctaParticlesState.width * 0.72,
        y: ctaParticlesState.height * 0.5,
        size: 1.2 + (i % 4) * 0.55,
        alpha: 0.25 + (i % 5) * 0.12,
        color: colors[i % colors.length],
      }));
    }
    drawCta(ctx, true);
  };

  function formationTarget(index, mode, w, h, t) {
    const cx = w > 760 ? w * 0.76 : w * 0.5;
    const cy = h * 0.52;
    const u = index / count;
    if (mode === 0) {
      // Orbital Halo
      const a = u * Math.PI * 2 + t * 0.25;
      const ring = 95 + (index % 3) * 38;
      return [cx + Math.cos(a) * ring * 1.35, cy + Math.sin(a) * ring * 0.78];
    }
    if (mode === 1) {
      // Multi-Terminal Matrix Grid
      const cols = 12;
      const rows = Math.ceil(count / cols);
      const col = index % cols;
      const row = Math.floor(index / cols);
      const gx = (col - (cols - 1) / 2) * 26;
      const gy = (row - (rows - 1) / 2) * 22;
      return [cx + gx + Math.sin(t + row * 0.4) * 6, cy + gy + Math.cos(t + col * 0.4) * 6];
    }
    // Harmonic Signal Wave
    const wx = (u - 0.5) * Math.min(w * 0.52, 420);
    const wy = Math.sin(u * Math.PI * 5 + t * 1.4) * 64 + Math.cos(u * Math.PI * 9 - t) * 22;
    return [cx + wx, cy + wy];
  }

  function drawCta(context, staticOnly = false) {
    const { width, height, particles } = ctaParticlesState;
    context.clearRect(0, 0, width, height);
    if (!staticOnly) ctaParticlesState.time += 0.016;
    const t = ctaParticlesState.time;
    const mode = Math.floor(t / 5.5) % 3;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const [tx, ty] = formationTarget(i, mode, width, height, t);
      if (staticOnly) {
        p.x = tx;
        p.y = ty;
      } else {
        p.x += (tx - p.x) * 0.045;
        p.y += (ty - p.y) * 0.045;
      }
      if (i > 0 && i % 2 === 0) {
        const prev = particles[i - 1];
        const d = Math.hypot(p.x - prev.x, p.y - prev.y);
        if (d < 54) {
          context.beginPath();
          context.moveTo(prev.x, prev.y);
          context.lineTo(p.x, p.y);
          context.strokeStyle = `rgba(52, 211, 153, ${((1 - d / 54) * 0.22).toFixed(3)})`;
          context.lineWidth = 0.85;
          context.stroke();
        }
      }
      context.beginPath();
      context.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      context.fillStyle = `${p.color}${p.alpha.toFixed(2)})`;
      context.fill();
    }
  }

  const loop = () => {
    ctaParticlesState.raf = 0;
    if (!ctaParticlesState.active || isMotionPaused() || document.hidden) return;
    drawCta(ctx, false);
    ctaParticlesState.raf = requestAnimationFrame(loop);
  };

  ctaParticlesState.start = () => {
    if (!ctaParticlesState.raf && ctaParticlesState.active && !isMotionPaused() && !document.hidden) {
      ctaParticlesState.raf = requestAnimationFrame(loop);
    }
  };
  ctaParticlesState.stop = () => {
    if (ctaParticlesState.raf) {
      cancelAnimationFrame(ctaParticlesState.raf);
      ctaParticlesState.raf = 0;
    }
    drawCta(ctx, true);
  };

  window.addEventListener("resize", resize, { passive: true });
  resize();
}

/* ── 3. Magnetic Pill Buttons, Cursor Spotlights & 3D Gallery Frames ─────── */
function bindInteractiveSurfaces() {
  if (!precisePointer.matches) return;

  document.querySelectorAll("[data-magnetic]").forEach((el) => {
    el.addEventListener("pointermove", (event) => {
      if (isMotionPaused()) return;
      const rect = el.getBoundingClientRect();
      const dx = (event.clientX - (rect.left + rect.width / 2)) * 0.16;
      const dy = (event.clientY - (rect.top + rect.height / 2)) * 0.22;
      el.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
    }, { passive: true });
    el.addEventListener("pointerleave", () => {
      el.style.transform = "";
    });
  });

  document.querySelectorAll("[data-spotlight]").forEach((el) => {
    el.addEventListener("pointermove", (event) => {
      if (isMotionPaused()) return;
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${(event.clientX - rect.left).toFixed(0)}px`);
      el.style.setProperty("--my", `${(event.clientY - rect.top).toFixed(0)}px`);
    }, { passive: true });
  });

  document.querySelectorAll("[data-tilt-card]").forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      if (isMotionPaused()) return;
      const rect = card.getBoundingClientRect();
      const rx = ((event.clientY - rect.top) / rect.height - 0.5) * -4.2;
      const ry = ((event.clientX - rect.left) / rect.width - 0.5) * 4.8;
      card.style.setProperty("--card-rx", `${rx.toFixed(2)}deg`);
      card.style.setProperty("--card-ry", `${ry.toFixed(2)}deg`);
    }, { passive: true });
    card.addEventListener("pointerleave", () => {
      card.style.removeProperty("--card-rx");
      card.style.removeProperty("--card-ry");
    });
  });
}

function renderMotion() {
  motionFrame = 0;
  const scrollRange = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollRange > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollRange)) : 0;
  header.style.setProperty("--page-progress", progress.toFixed(4));
  header.classList.toggle("scrolled", window.scrollY > 16);

  if (isMotionPaused() || document.hidden) return;
  const bounds = hero.getBoundingClientRect();
  if (bounds.bottom > 0 && bounds.top < window.innerHeight) {
    const travel = Math.min(1, Math.max(0, -bounds.top / bounds.height));
    hero.style.setProperty("--art-shift", `${(travel * 54).toFixed(1)}px`);
    scene.style.setProperty("--device-shift", `${(travel * -28).toFixed(1)}px`);
    scene.style.setProperty("--pointer-x", `${pointerX.toFixed(2)}deg`);
    scene.style.setProperty("--pointer-y", `${pointerY.toFixed(2)}deg`);
    scene.style.setProperty("--glint-x", `${(50 + pointerX * 14).toFixed(1)}%`);
    scene.style.setProperty("--glint-y", `${(50 - pointerY * 18).toFixed(1)}%`);
  }
  const frame = workbench.getBoundingClientRect();
  if (frame.bottom > 0 && frame.top < window.innerHeight) {
    const entry = Math.min(1, Math.max(0, (window.innerHeight - frame.top) / (window.innerHeight * 0.72)));
    workbench.style.setProperty("--frame-scale", (0.93 + entry * 0.07).toFixed(4));
    workbench.style.setProperty("--frame-tilt", `${((1 - entry) * 5.5).toFixed(2)}deg`);
  }
}

function scheduleMotion() {
  if (!document.hidden && !motionFrame) motionFrame = requestAnimationFrame(renderMotion);
}

function updateMotionControl() {
  const paused = isMotionPaused();
  document.documentElement.classList.toggle("motion-paused", paused);
  motionToggle.setAttribute("aria-pressed", String(paused));
  motionToggle.disabled = motionPreference.matches;
  motionLabel.textContent = translations[activeLanguage][
    motionPreference.matches ? "reducedMotion" : paused ? "resumeMotion" : "pauseMotion"
  ];
  motionToggle.querySelector(".motion-icon").textContent = paused ? "▷" : "Ⅱ";

  if (paused) {
    hero.classList.remove("launch-intro");
    pointerX = 0;
    pointerY = 0;
    hero.style.removeProperty("--art-shift");
    for (const property of ["--device-shift", "--pointer-x", "--pointer-y", "--glint-x", "--glint-y"]) {
      scene.style.removeProperty(property);
    }
    for (const property of ["--frame-scale", "--frame-tilt"]) {
      workbench.style.removeProperty(property);
    }
    document.querySelectorAll("[data-magnetic]").forEach((el) => { el.style.transform = ""; });
    heroParticlesState.stop?.();
    ctaParticlesState.stop?.();
  } else {
    heroParticlesState.start?.();
    ctaParticlesState.start?.();
  }
  scheduleMotion();
}

motionToggle.addEventListener("click", () => {
  motionPausedByUser = !motionPausedByUser;
  updateMotionControl();
});
motionPreference.addEventListener("change", updateMotionControl);
document.addEventListener("languagechange", updateMotionControl);
scene.addEventListener("pointermove", (event) => {
  if (isMotionPaused() || !precisePointer.matches) return;
  const bounds = scene.getBoundingClientRect();
  pointerX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 6;
  pointerY = ((event.clientY - bounds.top) / bounds.height - 0.5) * -4.2;
  scheduleMotion();
}, { passive: true });
scene.addEventListener("pointerleave", () => {
  pointerX = 0;
  pointerY = 0;
  scheduleMotion();
});
window.addEventListener("scroll", scheduleMotion, { passive: true });
window.addEventListener("resize", scheduleMotion, { passive: true });
document.addEventListener("visibilitychange", () => {
  document.documentElement.classList.toggle("page-hidden", document.hidden);
  if (document.hidden) {
    heroParticlesState.stop?.();
    ctaParticlesState.stop?.();
  } else if (!isMotionPaused()) {
    heroParticlesState.start?.();
    ctaParticlesState.start?.();
  }
  scheduleMotion();
});
document.documentElement.classList.toggle("page-hidden", document.hidden);
document.querySelectorAll("details").forEach((details) => details.addEventListener("toggle", scheduleMotion));

if ("IntersectionObserver" in window) {
  const activityObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.target === hero) {
        heroParticlesState.active = entry.isIntersecting;
        if (entry.isIntersecting && !isMotionPaused()) heroParticlesState.start?.();
        else heroParticlesState.stop?.();
      } else if (entry.target === scene) {
        scene.classList.toggle("motion-offscreen", !entry.isIntersecting);
      } else if (entry.target === ctaSection) {
        ctaParticlesState.active = entry.isIntersecting;
        if (entry.isIntersecting && !isMotionPaused()) ctaParticlesState.start?.();
        else ctaParticlesState.stop?.();
      }
    });
  });
  activityObserver.observe(hero);
  activityObserver.observe(scene);
  if (ctaSection) activityObserver.observe(ctaSection);

  const sectionLinks = [...nav.querySelectorAll('a[href^="#"]')];
  const navigationObserver = new IntersectionObserver((entries) => {
    const entering = entries.find((entry) => entry.isIntersecting);
    if (!entering) return;
    sectionLinks.forEach((link) => {
      if (link.hash === `#${entering.target.id}`) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }, { rootMargin: "-15% 0px -65% 0px" });
  sectionLinks.forEach((link) => {
    const section = document.querySelector(link.hash);
    if (section) navigationObserver.observe(section);
  });
  navigationObserver.observe(hero);
}
initHeroParticles();
initCtaParticles();
bindInteractiveSurfaces();
updateMotionControl();
if (!isMotionPaused()) {
  hero.classList.add("launch-intro");
  scene.addEventListener("animationend", () => hero.classList.remove("launch-intro"), { once: true });
}
document.documentElement.classList.add("motion-ready");

const mcpExamples = {
  connect: {
    command: "terminal_list",
    en: ["Find the OpenCode terminal in this workspace.", "✓ demo-web / OpenCode found\n  running · terminal: opencode-1"],
    zh: ["在当前工作区查找 OpenCode 终端。", "✓ 已找到 demo-web / OpenCode\n  运行中 · 终端 opencode-1"],
  },
  send: {
    command: "terminal_write",
    en: ["Ask OpenCode to run the project tests and summarize the result.", "→ Run the tests and summarize the result.\n✓ Submitted to opencode-1"],
    zh: ["请 OpenCode 运行项目测试并总结结果。", "→ 运行测试并总结结果。\n✓ 已将指令提交给 opencode-1"],
  },
  read: {
    command: "terminal_read",
    en: ["Read the latest output from the same terminal.", "✓ 12 tests passed\n  No failing tests. Ready for code review."],
    zh: ["读回同一个终端的最新输出。", "✓ 12 项测试通过\n  所有测试均已通过，可开始代码审查。"],
  },
};
const demo = document.querySelector("[data-mcp-demo]");
const demoSteps = [...demo.querySelectorAll("[data-mcp-step]")];
const demoTerminal = demo.querySelector(".mcp-demo-terminal");
const demoCommand = demo.querySelector("[data-mcp-command]");
const demoInstruction = demo.querySelector("[data-mcp-instruction]");
const demoOutput = demo.querySelector("[data-mcp-output]");
const demoPlayButton = demo.querySelector("[data-mcp-play]");
const demoPlayLabel = demo.querySelector("[data-mcp-play-label]");
const demoInterval = 2_600;
let demoStepIndex = 0;
let demoTransition;
let demoPlaybackTimer;

function showMcpStep() {
  const example = mcpExamples[demoSteps[demoStepIndex].dataset.mcpStep];
  const [instruction, output] = example[activeLanguage];
  demoCommand.textContent = example.command;
  demoInstruction.textContent = instruction;
  demoOutput.textContent = output;
}

function selectMcpStep(index) {
  if (demoStepIndex === index) return;
  demoStepIndex = index;
  demoSteps.forEach((step, index) => step.setAttribute("aria-pressed", String(index === demoStepIndex)));
  showMcpStep();
  demoTransition?.cancel();
  if (!isMotionPaused() && typeof demoTerminal.animate === "function") {
    demoTransition = demoTerminal.animate(
      [{ opacity: 0.56, clipPath: "inset(1% 0 0 0)" }, { opacity: 1, clipPath: "inset(0 0 0 0)" }],
      { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  }
}

function updateDemoPlayLabel() {
  demoPlayLabel.textContent = translations[activeLanguage][demoPlaybackTimer ? "mcpStop" : "mcpPlay"];
}

function stopMcpPlayback() {
  clearTimeout(demoPlaybackTimer);
  demoPlaybackTimer = undefined;
  demo.removeAttribute("data-playing");
  updateDemoPlayLabel();
}

function advanceMcpPlayback() {
  if (demoStepIndex === demoSteps.length - 1) {
    stopMcpPlayback();
    return;
  }
  selectMcpStep(demoStepIndex + 1);
  demoPlaybackTimer = setTimeout(advanceMcpPlayback, demoInterval);
}

demoPlayButton.addEventListener("click", () => {
  if (demoPlaybackTimer) {
    stopMcpPlayback();
    return;
  }
  selectMcpStep(0);
  demo.style.setProperty("--mcp-step-duration", `${demoInterval}ms`);
  demo.setAttribute("data-playing", "");
  demoPlaybackTimer = setTimeout(advanceMcpPlayback, demoInterval);
  updateDemoPlayLabel();
});

demoSteps.forEach((button, index) => {
  button.addEventListener("click", () => {
    stopMcpPlayback();
    selectMcpStep(index);
  });
});
motionToggle.addEventListener("click", () => { if (isMotionPaused()) demoTransition?.cancel(); });
motionPreference.addEventListener("change", () => { if (isMotionPaused()) demoTransition?.cancel(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) stopMcpPlayback(); });
if ("IntersectionObserver" in window) {
  new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) stopMcpPlayback();
  }).observe(demo);
}
document.addEventListener("languagechange", () => {
  showMcpStep();
  updateDemoPlayLabel();
});
showMcpStep();
updateDemoPlayLabel();

// The Fleet gallery keeps one focusable tab and announces the active screenshot.
const fleetShowcase = document.querySelector("[data-fleet-showcase]");
if (fleetShowcase) {
  const fleetTabsBar = fleetShowcase.querySelector("[data-fleet-tabs]");
  const fleetIndicator = fleetShowcase.querySelector("[data-fleet-indicator]");
  const fleetTabs = [...fleetShowcase.querySelectorAll("[data-fleet-tab]")];
  const fleetScreen = fleetShowcase.querySelector("[data-fleet-screen]");
  const fleetCaption = fleetShowcase.querySelector("[data-fleet-caption]");
  const captionKeyByTab = {
    deck: "fleetCapDeck",
    swarm: "fleetCapSwarm",
    routing: "fleetCapRouting",
    topology: "fleetCapTopology",
    analytics: "fleetCapAnalytics",
  };
  let activeFleetTab = "deck";
  let fleetTransition;

  const positionFleetIndicator = () => {
    if (!fleetTabsBar || !fleetIndicator) return;
    const current = fleetTabs.find((tab) => tab.classList.contains("active"));
    if (!current) return;
    // Disable sliding pill when wrapped onto multiple lines on narrow viewports
    const wraps = fleetTabs.some((tab) => Math.abs(tab.offsetTop - current.offsetTop) > 4);
    if (wraps) {
      fleetTabsBar.classList.remove("has-indicator");
      return;
    }
    fleetTabsBar.classList.add("has-indicator");
    fleetIndicator.style.width = `${current.offsetWidth}px`;
    fleetIndicator.style.transform = `translate3d(${current.offsetLeft}px, 0, 0)`;
  };

  fleetScreen.addEventListener("load", () => {
    fleetTransition?.cancel();
    if (!isMotionPaused() && typeof fleetScreen.animate === "function") {
      fleetTransition = fleetScreen.animate(
        [{ opacity: 0.72, transform: "scale(1.008)" }, { opacity: 1, transform: "scale(1)" }],
        { duration: 550, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
    }
  });

  const syncFleetCaption = () => {
    const key = captionKeyByTab[activeFleetTab] || "fleetCapDeck";
    fleetCaption.dataset.i18n = key;
    const dict = translations[activeLanguage] || translations.en;
    fleetCaption.textContent = dict[key];
    fleetScreen.alt = dict[key];
    requestAnimationFrame(positionFleetIndicator);
  };

  fleetTabs.forEach((btn, index) => {
    btn.tabIndex = btn.getAttribute("aria-selected") === "true" ? 0 : -1;
    btn.addEventListener("click", () => {
      if (activeFleetTab === btn.dataset.fleetTab) return;
      activeFleetTab = btn.dataset.fleetTab || "deck";
      fleetTabs.forEach((other) => {
        const isCurrent = other === btn;
        other.classList.toggle("active", isCurrent);
        other.setAttribute("aria-selected", String(isCurrent));
        other.tabIndex = isCurrent ? 0 : -1;
      });
      positionFleetIndicator();
      if (btn.dataset.fleetImg && fleetScreen) {
        fleetScreen.src = btn.dataset.fleetImg;
      }
      fleetScreen.closest("[role=tabpanel]").setAttribute("aria-labelledby", btn.id);
      syncFleetCaption();
    });
    btn.addEventListener("keydown", (event) => {
      const nextIndex = {
        ArrowRight: (index + 1) % fleetTabs.length,
        ArrowLeft: (index + fleetTabs.length - 1) % fleetTabs.length,
        Home: 0,
        End: fleetTabs.length - 1,
      }[event.key];
      if (nextIndex === undefined) return;
      event.preventDefault();
      fleetTabs[nextIndex].focus();
      fleetTabs[nextIndex].click();
    });
  });

  window.addEventListener("resize", positionFleetIndicator, { passive: true });
  document.addEventListener("languagechange", syncFleetCaption);
  requestAnimationFrame(positionFleetIndicator);
}
