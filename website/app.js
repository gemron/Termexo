const translations = {
  en: {
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
    eyebrow: "WINDOWS WORKBENCH / MOBILE REMOTE ACCESS",
    heroLine1: "At your desk.",
    heroLine2: "Or on your phone.",
    heroLead:
      "Claude Code, Codex, and OpenCode. One Windows workbench. Check output and send the next instruction from your phone. Your agents keep running on your PC.",
    heroRemoteNote:
      "Keep your PC running. Enable remote access, then connect with a token over a trusted LAN or VPN.",
    heroRemoteGuide: "How to connect your phone ↗",
    sceneHeading: "One workspace. Two ways in.",
    sceneDesktop: "RUN ON YOUR PC",
    sceneMobile: "CONTINUE ON YOUR PHONE",
    sceneTask: "› Review the latest changes",
    sceneResult: "Review complete. Ready for tests.",
    sceneWaiting: "Waiting for your next instruction",
    sceneHost: "Session runs on this PC",
    sceneDesktopNote:
      "Your agents and project stay on the host. No session to move or restart.",
    sceneConnection: "Remote · HTTPS",
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

    workbenchTitle: "Four agents. One screen.",
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
    metricLocalTitle: "No sign-up, no server",
    metricLocalBody:
      "Your projects and API keys stay on your computer. Termexo has no cloud to log into.",

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
      "Claude Code and Codex already save your sessions on disk. Termexo simply lists them so you can search and reopen one — it calls the CLI's own resume, so the full context comes back. Nothing you close is really lost.",
    sessionPoint1:
      "Search across every project by name, path, branch, or model",
    sessionPoint2:
      "Resumes through the real `claude --resume` and `codex resume`",
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
      "Write down what needs doing and what counts as done, pick the agent and the project, and the task opens as a real terminal. It reports its own progress back to the board, so you can see what is running without reading four terminals at once.",
    taskPoint1:
      "Todo, executing, completed, verified — the terminal moves the card",
    taskPoint2: "Send a task to Claude Code, Codex, or OpenCode",
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
      "Project folder, grid layout, which terminals were open, what model each was running, even the colour you picked — it all comes back with the workspace.",
    featureSessionTitle: "Nothing you close is lost",
    featureSessionBody:
      "Find any past Claude Code, Codex, or OpenCode session across your projects and reopen it with its full history intact.",
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
      "Check how much of your plan is left and when it resets, before you decide which model to send the next task to.",
    featureRemoteTitle: "Approve it from your phone",
    featureRemoteBody:
      "Open the workbench in your phone's browser, over an encrypted link to your own machine, and let the agent through the approval it has been waiting on.",

    remoteTitle: "The same workbench, in your hand.",
    remoteLead:
      "Turn on remote access and a phone, a tablet, or the laptop in the other room opens the whole workbench in a browser. Not a read-only mirror: the same workspaces and the same live terminals, so the agent stopped on an approval gets its answer while you are away from the desk.",
    remotePoint1:
      "Encrypted to your own machine, entered with a token you can scan as a QR code and rotate whenever you like",
    remotePoint2:
      "Terminals scroll by finger and take the size of whichever screen is being used",
    remotePoint3:
      "Nothing passes through a Termexo server — the link runs between your own devices",
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
    roadmap07Title: "Reaching your desk from anywhere",
    roadmap07Body:
      "The workbench opens on a phone or a second computer over an encrypted link to your own machine, driving the same live terminals. Paired devices, roles, and an audit trail come next.",

    principlesTitle: "Your work.\nOn your computer.",
    principlesLead:
      "Termexo has no account, no server, and nothing to sync. Remote access is the one link out, and it is the kind you switch on yourself, hand a token to, and switch off just as fast.",
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
      "The npm package ships the whole Windows app. Run it, and if you do not like it, delete it — nothing was created anywhere else.",
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
  },
  zh: {
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
    eyebrow: "WINDOWS 多 AGENT 工作台 / 手机远程访问",
    heroLine1: "电脑上开工，",
    heroLine2: "手机上接着用。",
    heroLead:
      "Claude Code、Codex、OpenCode，一个 Windows 工作台。离开书桌，用手机查看输出、发送下一步指令。Agent 继续在电脑上运行。",
    heroRemoteNote:
      "电脑需保持运行。开启远程访问后，在可信局域网或 VPN 内使用令牌连接。",
    heroRemoteGuide: "了解手机如何连接 ↗",
    sceneHeading: "同一个工作台，电脑与手机接续操作。",
    sceneDesktop: "电脑运行 AGENT",
    sceneMobile: "手机远程接着操作",
    sceneTask: "› 检查最新的代码变更",
    sceneResult: "检查完成，可以开始测试。",
    sceneWaiting: "等待你的下一步指令",
    sceneHost: "会话在这台电脑上运行",
    sceneDesktopNote: "Agent 和项目留在电脑上，无需搬运会话，也无需重新启动。",
    sceneConnection: "远程访问 · HTTPS",
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

    workbenchTitle: "四个 Agent，一块屏幕。",
    workbenchLead:
      "想开多少终端就开多少，再挑出此刻要盯着的那几个，按你顺手的方式排成网格。切到别的项目再切回来，还是你离开时的样子。",
    metricTabsTitle: "想开多少开多少",
    metricTabsBody: "每个会话都留在标签里，只把你正在看的摆出来。",
    metricGridTitle: "网格自己排",
    metricGridBody: "1 到 6 行列随便组合，每个项目记住自己的布局。",
    metricModelTitle: "换模型不换 CLI",
    metricModelBody: "还是你熟悉的 Claude Code，只是指向了别的供应商。",
    metricLocalTitle: "不注册、不联网",
    metricLocalBody:
      "项目和 API Key 都在你电脑上，Termexo 没有需要登录的云端。",

    attentionTitle: "Agent 卡住了，它会喊你。",
    attentionLead:
      "Agent 停在授权提示上等你确认，而你正看着别的窗口——这段时间全是白等。Termexo 会闪任务栏、弹系统通知，并且一直挂着提示条直到你处理完。所有打开的项目都算，不只是你眼前这个。",
    attentionPoint1: "等待授权、等待输入、已完成，一眼就能分清",
    attentionPoint2: "就算 Termexo 窗口已经在最前面也照样提醒",
    attentionPoint3: "点提示条直接跳到那个终端",
    attentionCaption: "一个 Agent 在等你拍板，另一个还在干活。",

    sessionTitle: "接着昨天的会话聊。",
    sessionLead:
      "Claude Code 和 Codex 本来就把会话存在本地，Termexo 只是把它们列出来让你搜。点「恢复」调用的是 CLI 自己的恢复命令，完整上下文原样回来。你关掉的东西，其实没丢。",
    sessionPoint1: "按名称、路径、分支或模型跨项目搜索",
    sessionPoint2: "走的是真正的 `claude --resume` 和 `codex resume`",
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
      "写清楚要做什么、做到什么算完成，选好 Agent 和项目，这条任务就会变成一个真实终端。它会把自己的进展回报到看板上，你不用同时盯着四个终端也知道谁在跑。",
    taskPoint1: "待办、执行中、已完成、已验收——卡片由终端自己推动",
    taskPoint2: "任务可以交给 Claude Code、Codex 或 OpenCode",
    taskPoint3: "验收不通过时写一句反馈，任务带着反馈回到执行中",
    taskCaption: "一条任务带着验收标准从待办走到已验收",
    capabilitiesTitle: "那些你一直在手动做的事。",
    capabilitiesLead:
      "用 AI 写代码真正麻烦的往往不是模型，而是记住哪个终端在干什么，以及明天再把这一切重新搭一遍。",
    now: "现在就能用",
    roadmapTag: "以后会有",
    featureWorkspaceTitle: "关掉再打开，东西都还在",
    featureWorkspaceBody:
      "项目目录、网格布局、开过哪些终端、每个终端跑的什么模型，连你选的主题色，都跟着工作区一起回来。",
    featureSessionTitle: "关掉的东西没丢",
    featureSessionBody:
      "翻出任意项目里的历史 Claude Code / Codex / OpenCode 会话，带着完整上下文重新打开。",
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
      "在决定把下一个任务交给哪个模型之前，先看清套餐还剩多少、什么时候重置。",
    featureRemoteTitle: "在手机上点同意",
    featureRemoteBody:
      "用手机浏览器打开工作台，走一条到自己电脑的加密连接，把 Agent 一直在等的那次授权放行。",

    remoteTitle: "同一个工作台，装进手里。",
    remoteLead:
      "打开远程访问，手机、平板或另一个房间的笔记本用浏览器就能打开完整工作台。不是只读的镜像，而是同一批工作空间、同一批正在运行的终端——人不在工位上，卡在授权那一步的 Agent 也能等到回答。",
    remotePoint1:
      "连接加密到你自己的电脑，凭令牌进入，令牌可扫码，也可以随时更换",
    remotePoint2: "终端支持手指拖拽滚动，尺寸跟随正在使用的那块屏幕",
    remotePoint3: "不经过 Termexo 的任何服务器，连接只在你自己的设备之间",
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
    roadmap07Title: "在任何地方连回工位",
    roadmap07Body:
      "工作台已经能在手机或另一台电脑上打开，走一条到自己电脑的加密连接，驱动同一批终端。设备配对、权限角色和操作日志是接下来的部分。",

    principlesTitle: "你的工作，\n留在你的电脑。",
    principlesLead:
      "Termexo 没有账号、没有服务器，也没有要同步的东西。远程访问是唯一一条对外的连接，也是你自己打开、自己发令牌、随时能关掉的那种。",
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
      "npm 包里带着完整的 Windows 应用。跑起来看看，不喜欢直接删掉——它不会在别处留下任何东西。",
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
  document.title =
    language === "zh"
      ? "Termexo — 电脑上开工，手机上接着用"
      : "Termexo — Your agents, from desk to phone";

  translatedElements.forEach((element) => {
    const value = dictionary[element.dataset.i18n];
    if (value) element.textContent = value;
    if (element.dataset.i18n === "navGuide") {
      element.setAttribute(
        "href",
        language === "zh" ? "guide.html" : "guide.en.html",
      );
    }
    if (element.dataset.i18n === "heroRemoteGuide") {
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
