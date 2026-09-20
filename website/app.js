const translations = {
  en: {
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
    enterpriseRemoteBody: "Run the workbench on your organization's Windows PC. Use your own relay or trusted LAN / VPN to reconnect to long-running tasks.",
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
    github: "GitHub",
    eyebrow:
      "WINDOWS WORKBENCH / SELF-HOSTED RELAY",
    heroLine1:
      "Start at your desk.",
    heroLine2:
      "Across networks.",
    heroLead:
      "A local-first AI coding workbench that brings agents, models, and projects together, so development can continue securely between your computer and phone.",
    heroRemoteNote:
      "Keep your PC running. Use a reachable HTTPS relay and desktop access token, or connect directly over a trusted LAN or VPN.",
    heroRemoteGuide:
      "Set up remote relay access ↗",
    heroRelease: "New in v0.10.5: Todo board snapshots, real-time sync, and faster Antigravity quota ↗",
    sceneHeading: "One workspace. Two ways in.",
    sceneDesktop: "RUN ON YOUR PC",
    sceneMobile: "CONTINUE ON YOUR PHONE",
    sceneTask: "› Review the latest changes",
    sceneResult: "Review complete. Ready for tests.",
    sceneWaiting: "Waiting for your next instruction",
    sceneHost: "Session runs on this PC",
    sceneDesktopNote:
      "Your agents and project stay on the host. No session to move or restart.",
    sceneConnection:
      "Relay · HTTPS",
    sceneSync: "Two-way connection",
    sceneSameSession: "The same live terminal",
    sceneInstruction: "› Run the tests and summarize any failures.",
    sceneContinue: "↳ Continuing on your PC…",
    sceneInput: "Send the next instruction",
    sceneCaption:
      "Actual Termexo screenshots. Illustrative devices and connection, not a live session.",
    runFromNpm: "Run it now",
    download: "Download installer",
    copyCommand: "Copy",
    copied: "Copied",
    viewSource: "View source",
    metaLocal: "Local-first · MIT open source",
    metaNpm: "One command to start",

    workbenchTitle: "Five agents. One screen.",
    workbenchLead:
      "Open as many terminals as you like, then choose which ones stay visible and arrange them in a grid that fits how you work. Switch to another project and back, and everything is exactly where you left it.",
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
      "An agent sitting on an approval prompt helps nobody if you are looking at a different window. Termexo flashes the taskbar, sends a system notification, and keeps a banner on screen until you deal with it — for every project you have open, not just the one in front of you.",
    attentionPoint1:
      "Waiting for approval, waiting for input, and finished all look different at a glance",
    attentionPoint2: "Works even when the Termexo window is already focused",
    attentionPoint3: "Click the banner to jump straight to that terminal",
    attentionCaption: "One agent needs a decision. The other is still working.",

    sessionTitle: "Pick up yesterday's conversation.",
    sessionLead:
      "Search saved Claude Code, Codex, OpenCode, Grok Build, and Antigravity sessions across projects. Termexo uses each CLI's own resume command to reopen the native context, without changing session files.",
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
      "API keys go into Windows Credential Manager, never a plain text file",
    modelPoint3: "Switch every Claude terminal in a project at once",
    modelCaption:
      "Keys are stored by Windows — the app only ever sees whether one exists",

    taskTitle: "Hand the work to an agent.",
    taskLead:
      "Write down what needs doing and what counts as done, pick the agent and the project, and the task opens as a real terminal. It reports its own progress back to the board, so you can see what is running without reading every terminal at once.",
    taskPoint1:
      "Todo, executing, completed, verified — the terminal moves the card",
    taskPoint2: "Send a task to Claude Code, Codex, OpenCode, or Grok Build",
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
      "Find past Claude Code, Codex, OpenCode, Grok Build, or Antigravity sessions across your projects and reopen their native history.",
    featureTasksTitle: "Hand a task to an agent",
    featureTasksBody:
      "Write down the task and what counts as done, pick an agent, and it opens as a real terminal that reports its own progress back to the board.",
    featureModelTitle: "Try a cheaper model on the same task",
    featureModelBody:
      "Point the same CLI at a different provider, switch back if the result is worse, and keep every key in secure storage.",
    featureStatusTitle: "Know the moment it needs you",
    featureStatusBody:
      "Waiting, thinking, needs approval, done, failed — shown in the tab, the panel, and the taskbar, across every project at once.",
    featureLanguageTitle: "Works in your language",
    featureLanguageBody:
      "Follow Windows automatically or switch between Chinese, English, Spanish, French, German, Japanese, and Korean at any time.",
    featureQuotaTitle: "See your quota before you burn it",
    featureQuotaBody:
      "Check supported providers' reported quota and reset time. Grok Build shows an exhausted free allowance; unavailable percentages stay unavailable.",
    featureRemoteTitle:
      "Reach your workbench across networks",
    featureRemoteBody:
      "A self-hosted relay connects your phone to the same desktop terminals. No public IP or router port forwarding on the desktop.",

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

    roadmapTitle: "What comes next.",
    roadmapLead:
      "Everything above already works. Here is what has shipped, and what is being built next — anything still marked planned is not being sold as finished.",
    current: "YOU ARE HERE",
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
    roadmap10Title: "Five agents, clearer progress",
    roadmap10Body:
      "Grok Build joins the workbench. Session change counts and the Git view keep refreshing; terminals start quietly, and workspace rows can be dragged into order.",

    principlesTitle: "Your work.\nOn your computer.",
    principlesLead:
      "Termexo runs locally by default. Enable remote access when you need it: use your own relay or a trusted LAN / VPN, control the desktop access token, and disconnect from Settings. Your agent CLIs still connect to the model services you configure.",
    principle1Title: "Local by default",
    principle1Body:
      "Your project paths, sessions, terminal state, and settings sit in a file on your disk. There is no cloud service to sign into.",
    principle2Title: "Your API keys are not in a config file",
    principle2Body:
      "Keys go into Windows Credential Manager. The app stores only a reference, and the interface can tell you a key exists but never show it back.",
    principle3Title: "Your agent files are read-only",
    principle3Body:
      "Termexo reads what Claude Code and Codex write, and uses their own resume commands. It never rewrites, renames, or deletes your session history.",

    ctaTitle: "One command. No account.",
    ctaLead:
      "The npm package includes the Windows app. Start locally without a Termexo account, then connect a self-hosted relay when you need access across networks.",
    getRelease: "Download installer",
    starGithub: "Star on GitHub",
    supportProject:
      "Built in the open, under the MIT license. If Termexo helps your workflow, a GitHub Star helps others discover it. Bug reports and contributions are welcome too.",
    indexWorkbench: "01 / WORKBENCH",
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
    navRelay: "Remote relay",
    sceneProtocol: "RELAY / LAN / VPN",
    relayDeploy: "Deploy your relay ↗",
    relaySetup: "Read the connection guide ↗",
    relayCompatibility: "Relay: Linux / macOS / Windows, x64 / arm64 and containers. Desktop app: Windows 10 / 11.",
  },
  zh: {
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
    enterpriseRemoteBody: "工作台运行在企业控制的 Windows 电脑上，通过自建中继或可信局域网 / VPN，接回仍在运行的长任务。",
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
    github: "GitHub",
    eyebrow:
      "WINDOWS 多 AGENT 工作台 / 自建中继访问",
    heroLine1: "电脑上开工，",
    heroLine2:
      "跨网络接着用。",
    heroLead:
      "本地优先的 AI 编程工作台，统一管理多个 Agent、模型与项目，让开发工作在电脑与手机之间安全接续。",
    heroRemoteNote:
      "电脑需保持运行。使用双方可达的 HTTPS 中继和桌面访问令牌，也可在可信局域网或 VPN 内直连。",
    heroRemoteGuide:
      "了解如何配置中继访问 ↗",
    heroRelease: "v0.10.5 新增任务看板持久化与快照迁移、多端实时同步与 Antigravity 余量极速查询 ↗",
    sceneHeading: "同一个工作台，电脑与手机接续操作。",
    sceneDesktop: "电脑运行 AGENT",
    sceneMobile: "手机远程接着操作",
    sceneTask: "› 检查最新的代码变更",
    sceneResult: "检查完成，可以开始测试。",
    sceneWaiting: "等待你的下一步指令",
    sceneHost: "会话在这台电脑上运行",
    sceneDesktopNote: "Agent 和项目留在电脑上，无需搬运会话，也无需重新启动。",
    sceneConnection:
      "中继访问 · HTTPS",
    sceneSync: "双向连接",
    sceneSameSession: "同一个正在运行的终端",
    sceneInstruction: "› 运行测试，并汇总失败项。",
    sceneContinue: "↳ 正在电脑上继续执行…",
    sceneInput: "发送下一步指令",
    sceneCaption: "真实 Termexo 界面截图，设备与连接为场景示意，非实时会话。",
    runFromNpm: "立即运行",
    download: "下载安装包",
    copyCommand: "复制",
    copied: "已复制",
    viewSource: "查看源码",
    metaLocal: "本地优先 · MIT 开源",
    metaNpm: "一条命令启动",

    workbenchTitle: "五个 Agent，一块屏幕。",
    workbenchLead:
      "想开多少终端就开多少，再挑出此刻要盯着的那几个，按你顺手的方式排成网格。切到别的项目再切回来，还是你离开时的样子。",
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
      "Agent 停在授权提示上等你确认，而你正看着别的窗口——这段时间全是白等。Termexo 会闪任务栏、弹系统通知，并且一直挂着提示条直到你处理完。所有打开的项目都算，不只是你眼前这个。",
    attentionPoint1: "等待授权、等待输入、已完成，一眼就能分清",
    attentionPoint2: "就算 Termexo 窗口已经在最前面也照样提醒",
    attentionPoint3: "点提示条直接跳到那个终端",
    attentionCaption: "一个 Agent 在等你拍板，另一个还在干活。",

    sessionTitle: "接着昨天的会话聊。",
    sessionLead:
      "跨项目搜索 Claude Code、Codex、OpenCode、Grok Build 和 Antigravity 的本地会话。Termexo 调用各 CLI 的原生恢复命令接回上下文，不改写会话文件。",
    sessionPoint1: "按名称、路径、分支或模型跨项目搜索",
    sessionPoint2: "通过各 Agent 自己的命令恢复原生会话",
    sessionPoint3: "原生会话文件只读，Termexo 不改也不删",
    sessionCaption: "本地所有会话，可搜索，一键恢复",

    modelTitle: "同一个 CLI，换个模型跑。",
    modelLead:
      "还是用 Claude Code，但把它指向 DeepSeek、MiniMax、GLM 或你自己的兼容网关。每个存成一个 Profile，两下就能切——不用重装，也不用手动改配置文件。",
    modelPoint1: "Anthropic、DeepSeek、MiniMax、GLM，或任意兼容 Endpoint",
    modelPoint2: "API Key 存进 Windows 凭据管理器，不落在明文文件里",
    modelPoint3: "一个项目里的 Claude 终端可以一次性全部切换",
    modelCaption: "密钥交给 Windows 保管，界面只知道「有没有」，看不到内容",

    taskTitle: "把活儿交给 Agent。",
    taskLead:
      "写清楚要做什么、做到什么算完成，选好 Agent 和项目，这条任务就会变成一个真实终端。它会把自己的进展回报到看板上，你不用逐个盯着终端也知道谁在跑。",
    taskPoint1: "待办、执行中、已完成、已验收——卡片由终端自己推动",
    taskPoint2: "任务可以交给 Claude Code、Codex、OpenCode 或 Grok Build",
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
      "翻出各项目里的 Claude Code、Codex、OpenCode、Grok Build 或 Antigravity 历史会话，恢复原生上下文。",
    featureTasksTitle: "把一条任务交给 Agent",
    featureTasksBody:
      "写清楚任务和验收标准，选一个 Agent，它就变成一个真实终端，并把自己的进展回报到看板上。",
    featureModelTitle: "同一个活，换个便宜模型试试",
    featureModelBody:
      "把同一个 CLI 指向别的供应商，效果不好随时切回来，所有密钥都在系统安全存储里。",
    featureStatusTitle: "需要你的那一刻就知道",
    featureStatusBody:
      "运行中、思考中、等授权、已完成、失败——标签、面板和任务栏同时告诉你，跨项目一起看。",
    featureLanguageTitle: "用你熟悉的语言工作",
    featureLanguageBody:
      "自动跟随 Windows，也可随时切换简体中文、英语、西班牙语、法语、德语、日语和韩语。",
    featureQuotaTitle: "额度烧完之前就知道",
    featureQuotaBody:
      "查看支持的供应商报告的额度和重置时间。Grok Build 免费额度用尽会明确显示；查不到的百分比不会写成 0%。",
    featureRemoteTitle:
      "跨网络接回工作台",
    featureRemoteBody:
      "通过自建中继，用手机连接桌面正在运行的同一批终端。桌面无需公网 IP，也无需路由器端口映射。",

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

    roadmapTitle: "接下来做什么。",
    roadmapLead:
      "上面写的都已经能用了。这里是已经发布的部分和接下来要做的顺序——标着「计划中」的都还没做完，不会当成已完成来讲。",
    current: "现在在这",
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
    roadmap10Title: "五个 Agent，进度更清楚",
    roadmap10Body:
      "Grok Build 加入工作台；会话变更数量与 Git 视图持续刷新。终端安静启动，工作区条目可拖拽排序。",

    principlesTitle: "你的工作，\n留在你的电脑。",
    principlesLead:
      "Termexo 默认在本地运行。需要时开启远程访问，通过自建中继或可信局域网 / VPN 连接，自己管理桌面访问令牌，并可在设置中断开。Agent CLI 仍会连接你配置的模型服务。",
    principle1Title: "默认就在本地",
    principle1Body:
      "项目路径、会话、终端状态和设置都存在你硬盘上的文件里，没有需要登录的云服务。",
    principle2Title: "API Key 不在配置文件里",
    principle2Body:
      "密钥交给 Windows 凭据管理器保管，程序只存一个引用；界面能告诉你「已配置」，但拿不回明文。",
    principle3Title: "你的会话文件只读",
    principle3Body:
      "Termexo 读 Claude Code 和 Codex 写下的文件，并调用它们自己的恢复命令，绝不改写、重命名或删除你的历史记录。",

    ctaTitle: "一条命令，不用注册。",
    ctaLead:
      "npm 包包含完整 Windows 应用，无需注册 Termexo 账号即可在本地开始使用。需要跨网络访问时，再连接自己部署的中继。",
    getRelease: "下载安装包",
    starGithub: "在 GitHub 上 Star",
    supportProject:
      "MIT 开源。如果 Termexo 帮到了你的工作，欢迎在 GitHub 点个 Star，让更多开发者发现它；也欢迎反馈问题和参与贡献。",
    indexWorkbench: "01 / 工作台",
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
    navRelay: "中继访问",
    sceneProtocol: "中继 / 局域网 / VPN",
    relayDeploy: "部署自己的中继 ↗",
    relaySetup: "查看连接步骤 ↗",
    relayCompatibility: "中继支持 Linux / macOS / Windows、x64 / arm64 和容器部署。桌面版支持 Windows 10 / 11。",
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
      ? "Termexo — 电脑上开工，跨网络接着用"
      : "Termexo — Your workbench, across networks";

  translatedElements.forEach((element) => {
    const value = dictionary[element.dataset.i18n];
    if (value) element.textContent = value;
    if (element.dataset.i18n === "navGuide") {
      element.setAttribute(
        "href",
        language === "zh" ? "guide.html" : "guide.en.html",
      );
    }
    if (["heroRemoteGuide", "relaySetup"].includes(element.dataset.i18n)) {
      element.setAttribute(
        "href",
        language === "zh" ? "guide.html#remote" : "guide.en.html#remote",
      );
    }
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
        { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
      )
    : null;

document.querySelectorAll(".reveal").forEach((element) => {
  if (revealObserver) revealObserver.observe(element);
  else element.classList.add("visible");
});
document.documentElement.classList.add("motion-ready");

window.addEventListener(
  "scroll",
  () => header.classList.toggle("scrolled", window.scrollY > 16),
  { passive: true },
);

document.querySelector("[data-year]").textContent = new Date().getFullYear();

let storedLanguage;
try {
  storedLanguage = localStorage.getItem("termexo.website.language");
} catch {
  /* Use the default language. */
}
setLanguage(storedLanguage || "en");

// Native scrolling drives the scene; there is no scroll interception or perpetual render loop.
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const precisePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
const motionToggle = document.querySelector("[data-motion-toggle]");
const motionLabel = document.querySelector("[data-motion-label]");
const hero = document.querySelector(".hero");
const scene = document.querySelector(".hero-scene");
const workbench = document.querySelector("#workbench .product-frame");
let motionPaused = motionPreference.matches;
let motionFrame = 0;
let pointerX = 0;
let pointerY = 0;

function renderMotion() {
  motionFrame = 0;
  if (motionPaused || document.hidden) return;
  const heroBounds = hero.getBoundingClientRect();
  if (heroBounds.bottom > 0 && heroBounds.top < window.innerHeight) {
    const progress = Math.min(
      1,
      Math.max(0, -heroBounds.top / heroBounds.height),
    );
    scene.style.setProperty("--scene-scroll", progress.toFixed(3));
    scene.style.setProperty("--pointer-x", `${pointerX.toFixed(2)}deg`);
    scene.style.setProperty("--pointer-y", `${pointerY.toFixed(2)}deg`);
  }
  const frameBounds = workbench.getBoundingClientRect();
  if (frameBounds.bottom > 0 && frameBounds.top < window.innerHeight) {
    const progress = Math.min(
      1,
      Math.max(
        0,
        (window.innerHeight - frameBounds.top) / (window.innerHeight * 0.8),
      ),
    );
    workbench.style.setProperty(
      "--frame-scale",
      (0.9 + progress * 0.1).toFixed(4),
    );
    workbench.style.setProperty(
      "--frame-tilt",
      `${((1 - progress) * 7).toFixed(2)}deg`,
    );
  }
}

function scheduleMotion() {
  if (!motionPaused && !document.hidden && !motionFrame)
    motionFrame = requestAnimationFrame(renderMotion);
}

function updateMotionControl() {
  document.documentElement.classList.toggle("motion-paused", motionPaused);
  motionToggle.setAttribute("aria-pressed", String(motionPaused));
  motionToggle.disabled = motionPreference.matches;
  motionLabel.textContent =
    translations[activeLanguage][
      motionPreference.matches
        ? "reducedMotion"
        : motionPaused
          ? "resumeMotion"
          : "pauseMotion"
    ];
  motionToggle.querySelector(".motion-icon").textContent = motionPaused
    ? "▷"
    : "Ⅱ";
  if (motionPaused) {
    cancelAnimationFrame(motionFrame);
    motionFrame = 0;
    scene.style.removeProperty("--scene-scroll");
    scene.style.removeProperty("--pointer-x");
    scene.style.removeProperty("--pointer-y");
    workbench.style.removeProperty("--frame-scale");
    workbench.style.removeProperty("--frame-tilt");
  } else scheduleMotion();
}

motionToggle.addEventListener("click", () => {
  motionPaused = !motionPaused;
  updateMotionControl();
});
motionPreference.addEventListener("change", () => {
  motionPaused = motionPreference.matches;
  updateMotionControl();
});
document.addEventListener("languagechange", updateMotionControl);
hero.addEventListener(
  "pointermove",
  (event) => {
    if (motionPaused || !precisePointer.matches) return;
    const bounds = hero.getBoundingClientRect();
    pointerX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 6;
    pointerY = ((event.clientY - bounds.top) / bounds.height - 0.5) * -5;
    scheduleMotion();
  },
  { passive: true },
);
hero.addEventListener("pointerleave", () => {
  pointerX = 0;
  pointerY = 0;
  scheduleMotion();
});
window.addEventListener("scroll", scheduleMotion, { passive: true });
window.addEventListener("resize", scheduleMotion, { passive: true });
document.addEventListener("visibilitychange", () => {
  document.documentElement.classList.toggle("page-hidden", document.hidden);
  scheduleMotion();
});

// A second, non-semantic copy makes the ticker loop without a visible jump.
const signalTrack = document.querySelector(".signal-track");
const signalCopy = signalTrack.cloneNode(true);
signalCopy.setAttribute("aria-hidden", "true");
signalTrack.parentElement.append(signalCopy);

// Suspend CSS loops after their surface leaves the viewport.
if ("IntersectionObserver" in window) {
  const activityObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) =>
      entry.target.classList.toggle("motion-offscreen", !entry.isIntersecting),
    );
  });
  activityObserver.observe(scene);
  activityObserver.observe(signalTrack.parentElement);

  const sectionLinks = [...nav.querySelectorAll('a[href^="#"]')];
  const navigationObserver = new IntersectionObserver(
    (entries) => {
      const entering = entries.find((entry) => entry.isIntersecting);
      if (!entering) return;
      sectionLinks.forEach((link) => {
        if (link.hash === `#${entering.target.id}`)
          link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
    },
    { rootMargin: "-15% 0px -65% 0px" },
  );
  sectionLinks.forEach((link) => {
    const section = document.querySelector(link.hash);
    if (section) navigationObserver.observe(section);
  });
  navigationObserver.observe(hero);
}
updateMotionControl();
