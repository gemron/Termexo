const translations = {
  en: {
    skip: "Skip to content",
    navWorkbench: "Workbench",
    navCapabilities: "Features",
    navRoadmap: "Roadmap",
    navPrinciples: "Privacy",
    github: "GitHub",
    eyebrow: "Runs on your machine · Windows · No account needed",
    heroLine1: "One window.",
    heroLine2: "Every agent.",
    heroLead:
      "Claude Code in one terminal, Codex in another, and three more you have stopped keeping track of. Termexo puts them all on one screen — you can see which one is waiting on you, pick up yesterday's conversation, and switch models without restarting anything.",
    runFromNpm: "Run it now",
    download: "Download installer",
    copyCommand: "Copy",
    copied: "Copied",
    viewSource: "View source",
    metaLocal: "Nothing leaves your PC",
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
      "Find any past Claude Code or Codex session across your projects and reopen it with its full history intact.",
    featureModelTitle: "Try a cheaper model on the same task",
    featureModelBody:
      "Point the same CLI at a different provider, switch back if the result is worse, and keep every key in secure storage.",
    featureStatusTitle: "Know the moment it needs you",
    featureStatusBody:
      "Waiting, thinking, needs approval, done, failed — shown in the tab, the panel, and the taskbar, across every project at once.",
    featureQuotaTitle: "See your quota before you burn it",
    featureQuotaBody:
      "Check how much of your plan is left and when it resets, before you decide which model to send the next task to.",
    featureRemoteTitle: "Approve it from your phone",
    featureRemoteBody:
      "Step away from the desk and still let an agent through the approval it is waiting on, over an encrypted link to your own machine.",

    roadmapTitle: "What comes next.",
    roadmapLead:
      "Everything above already works. Here is what is being built, and in what order — nothing on this list is being sold as finished.",
    current: "YOU ARE HERE",
    planned: "PLANNED",
    roadmap02Title: "Run several agents side by side",
    roadmap02Body:
      "Claude and Codex detection, separate logins, resume, custom grids, model profiles, and everything saved locally.",
    roadmap04Title: "Accounts, installs, and networks",
    roadmap04Body:
      "Install or upgrade the CLIs in one click, keep several logins apart, set up proxies for a company network, and watch how much plan quota is left.",
    roadmap06Title: "Handing work between agents",
    roadmap06Body:
      "Session summaries, moving a task from one agent to another, routing work, and notifications.",
    roadmap07Title: "Reaching your desk from anywhere",
    roadmap07Body:
      "Paired devices, encrypted remote terminals, approving from a phone, clear roles, and an audit trail.",

    principlesTitle: "It all stays on your computer.",
    principlesLead:
      "Termexo has no account, no server, and nothing to sync. Later versions add remote access — but only the kind you switch on yourself and can switch off just as fast.",
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
    starGithub: "Explore on GitHub",
    footerTagline: "One window for every coding agent",
  },
  zh: {
    skip: "跳到主要内容",
    navWorkbench: "工作台",
    navCapabilities: "功能",
    navRoadmap: "开发计划",
    navPrinciples: "隐私",
    github: "GitHub",
    eyebrow: "跑在你自己电脑上 · Windows · 不用注册",
    heroLine1: "一个窗口，",
    heroLine2: "装下所有 Agent。",
    heroLead:
      "一个终端跑 Claude Code，另一个跑 Codex，还有三个开着但已经忘了在干嘛。Termexo 把它们收进同一块屏幕——谁在等你回话一眼就能看到，昨天聊到一半的会话点一下接着聊，换模型不用重开终端。",
    runFromNpm: "立即运行",
    download: "下载安装包",
    copyCommand: "复制",
    copied: "已复制",
    viewSource: "查看源码",
    metaLocal: "东西不出本机",
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
      "翻出任意项目里的历史 Claude Code / Codex 会话，带着完整上下文重新打开。",
    featureModelTitle: "同一个活，换个便宜模型试试",
    featureModelBody:
      "把同一个 CLI 指向别的供应商，效果不好随时切回来，所有密钥都在系统安全存储里。",
    featureStatusTitle: "需要你的那一刻就知道",
    featureStatusBody:
      "运行中、思考中、等授权、已完成、失败——标签、面板和任务栏同时告诉你，跨项目一起看。",
    featureQuotaTitle: "额度烧完之前就知道",
    featureQuotaBody:
      "在决定把下一个任务交给哪个模型之前，先看清套餐还剩多少、什么时候重置。",
    featureRemoteTitle: "在手机上点同意",
    featureRemoteBody:
      "人离开工位，也能通过到自己电脑的加密连接，放行 Agent 正在等的那次授权。",

    roadmapTitle: "接下来做什么。",
    roadmapLead:
      "上面写的都已经能用了。这里是正在做的部分和先后顺序——没有把还没做完的当成已完成来讲。",
    current: "现在在这",
    planned: "计划中",
    roadmap02Title: "几个 Agent 并排干活",
    roadmap02Body:
      "识别 Claude 与 Codex、多个登录账号互不干扰、恢复会话、自定义网格、模型 Profile，全部存在本地。",
    roadmap04Title: "账号、安装和网络",
    roadmap04Body:
      "一键装好或升级 CLI，多个登录账号分开管理，为公司内网配代理，并盯住套餐还剩多少额度。",
    roadmap06Title: "在 Agent 之间交接工作",
    roadmap06Body: "会话摘要、把任务从一个 Agent 转给另一个、任务分派和通知。",
    roadmap07Title: "在任何地方连回工位",
    roadmap07Body:
      "设备配对、加密远程终端、手机审批、清晰的权限角色和操作日志。",

    principlesTitle: "一切都留在你自己的电脑上。",
    principlesLead:
      "Termexo 没有账号、没有服务器，也没有要同步的东西。以后会加远程访问——但只会是你自己打开、也能随时关掉的那种。",
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
    starGithub: "前往 GitHub",
    footerTagline: "一个窗口，装下所有编程 Agent",
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
      ? "Termexo — 一个窗口装下所有编程 Agent"
      : "Termexo — One window for every coding agent";

  translatedElements.forEach((element) => {
    const value = dictionary[element.dataset.i18n];
    if (value) element.textContent = value;
  });

  languageButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.lang === language);
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.lang === language),
    );
  });

  localStorage.setItem("termexo.website.language", language);
}

languageButtons.forEach((button) => {
  button.addEventListener("click", () => setLanguage(button.dataset.lang));
});

copyCommandButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText("npx termexo@latest");
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

const revealObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
);

document
  .querySelectorAll(".reveal")
  .forEach((element) => revealObserver.observe(element));

window.addEventListener(
  "scroll",
  () => header.classList.toggle("scrolled", window.scrollY > 16),
  { passive: true },
);

document.querySelector("[data-year]").textContent = new Date().getFullYear();

const storedLanguage = localStorage.getItem("termexo.website.language");
setLanguage(storedLanguage || "en");
