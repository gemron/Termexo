const translations = {
  en: {
    skip: "Skip to content",
    navWorkbench: "Workbench",
    navCapabilities: "Capabilities",
    navRoadmap: "Roadmap",
    navPrinciples: "Principles",
    github: "GitHub",
    eyebrow: "Local-first AI workspace control plane",
    heroLine1: "One workspace.",
    heroLine2: "Every agent.",
    heroLead:
      "Coordinate coding terminals, native agent sessions, model providers, and recoverable project state from one focused desktop environment.",
    download: "Download for Windows",
    viewSource: "View source",
    metaLocal: "Local-first",
    workbenchTitle: "See the whole development field.",
    workbenchLead:
      "Keep unlimited terminal tabs, choose exactly which panes are visible, and move between projects without losing the state that explains what each agent is doing.",
    metricTabsTitle: "Terminal tabs",
    metricTabsBody: "Keep every session available; choose panes on demand.",
    metricGridTitle: "Custom grid",
    metricGridBody: "Persist row and column layouts per workspace.",
    metricModelTitle: "Model routing",
    metricModelBody: "Keep the CLI and switch compatible providers.",
    metricLocalTitle: "Required services",
    metricLocalBody: "Workspaces and credentials stay local by default.",
    capabilitiesTitle: "More than terminal chrome.",
    capabilitiesLead:
      "Termexo adds the state, recovery, model configuration, and runtime visibility needed to operate several coding agents as one development system.",
    now: "AVAILABLE NOW",
    roadmapTag: "ROADMAP",
    featureWorkspaceTitle: "Workspace identity",
    featureWorkspaceBody:
      "Name, color, order, project path, layout, terminals, branch, and model state stay attached to one durable workspace.",
    featureSessionTitle: "Native session recovery",
    featureSessionBody:
      "Discover and resume native Claude Code and Codex CLI sessions from one read-only session center.",
    featureModelTitle: "Provider profiles",
    featureModelBody:
      "Keep Claude Code while routing to Anthropic, DeepSeek, MiniMax, GLM, or a compatible gateway.",
    featureStatusTitle: "Agent state you can act on",
    featureStatusBody:
      "Normalize thinking, tool use, input, approval, completion, and failure into a workspace-wide operational view.",
    featureQuotaTitle: "Provider Plan visibility",
    featureQuotaBody:
      "Track quota, reset windows, thresholds, and provider availability before model routing decisions.",
    featureRemoteTitle: "Connected workspaces",
    featureRemoteBody:
      "Securely share workspace state and reach authorized terminals from trusted computers and phones.",
    modelTitle: "Change the model, not the workflow.",
    modelLead:
      "Keep the CLI your team already understands. Termexo turns endpoint, model, API key, and MCP settings into explicit profiles that can be switched and recovered.",
    modelPoint1: "Compatible provider profiles",
    modelPoint2: "Credentials in Windows Credential Manager",
    modelPoint3: "Batch switch with session-aware restart",
    roadmapTitle: "From local control to trusted access.",
    roadmapLead:
      "The roadmap expands the same local-first workspace model without presenting planned capabilities as already shipped.",
    current: "CURRENT",
    planned: "PLANNED",
    roadmap02Title: "Multi-Agent session workbench",
    roadmap02Body:
      "Claude and Codex detection, native session discovery and resume, configurable grids, profiles, and local persistence.",
    roadmap04Title: "Multi-agent and provider control",
    roadmap04Body:
      "Gemini and generic CLI adapters, one-click CLI lifecycle, internal-network and npm proxy profiles, multiple Claude, Codex, and provider accounts with scoped switching, rollback, and live Plan quota monitoring.",
    roadmap06Title: "Context and orchestration",
    roadmap06Body:
      "Session summaries, cross-agent migration, task routing, collaboration, and notifications.",
    roadmap07Title: "Workspace sharing and remote access",
    roadmap07Body:
      "Trusted devices, encrypted remote terminals, mobile approvals, granular roles, and audit logs.",
    principlesTitle: "Your machine remains the authority.",
    principlesLead:
      "Remote capability should extend local ownership, never erase it. Termexo is designed around explicit trust boundaries from the start.",
    principle1Title: "Local by default",
    principle1Body:
      "Project paths, session indexes, terminal state, and configuration remain on the machine unless you explicitly share them.",
    principle2Title: "Native agent semantics",
    principle2Body:
      "Use each CLI's real resume and configuration mechanisms instead of inventing a fake universal session.",
    principle3Title: "Revocable remote trust",
    principle3Body:
      "Planned remote access uses paired devices, short-lived tokens, encryption, clear roles, and immediate revocation.",
    ctaTitle: "Bring every coding agent into focus.",
    ctaLead:
      "Termexo is early, local-first, and being built in public. Try the Windows release or follow the roadmap on GitHub.",
    getRelease: "Get the latest release",
    starGithub: "Explore on GitHub",
    footerTagline: "AI Workspace Control Plane",
  },
  zh: {
    skip: "跳到主要内容",
    navWorkbench: "工作台",
    navCapabilities: "核心能力",
    navRoadmap: "开发路线",
    navPrinciples: "设计原则",
    github: "GitHub",
    eyebrow: "本地优先的 AI 工作空间控制平面",
    heroLine1: "一个工作空间。",
    heroLine2: "管理所有 Agent。",
    heroLead:
      "在一个专注的桌面环境中统一管理编程终端、Agent 原生会话、模型供应商和可恢复的项目状态。",
    download: "下载 Windows 版本",
    viewSource: "查看源码",
    metaLocal: "本地优先",
    workbenchTitle: "看清整个开发现场。",
    workbenchLead:
      "保留不限数量的终端标签，明确选择当前显示的窗口；切换项目时，不再丢失解释每个 Agent 正在做什么的关键状态。",
    metricTabsTitle: "终端标签",
    metricTabsBody: "保留所有会话，需要时指定显示窗口。",
    metricGridTitle: "自定义网格",
    metricGridBody: "为每个工作空间持久化行列布局。",
    metricModelTitle: "模型路由",
    metricModelBody: "CLI 保持不变，切换兼容供应商。",
    metricLocalTitle: "必需云服务",
    metricLocalBody: "工作空间和凭据默认保留在本机。",
    capabilitiesTitle: "不只是终端外壳。",
    capabilitiesLead:
      "Termexo 补齐状态、恢复、模型配置和运行可见性，让多个编程 Agent 可以作为一个开发系统运行。",
    now: "当前可用",
    roadmapTag: "开发计划",
    featureWorkspaceTitle: "工作空间身份",
    featureWorkspaceBody:
      "名称、颜色、顺序、项目路径、布局、终端、分支和模型状态都归属于一个持久工作空间。",
    featureSessionTitle: "原生会话恢复",
    featureSessionBody:
      "在统一的只读会话中心发现并恢复 Claude Code 与 Codex CLI 原生会话。",
    featureModelTitle: "供应商 Profile",
    featureModelBody:
      "保留 Claude Code，通过 Profile 路由到 Anthropic、DeepSeek、MiniMax、GLM 或兼容网关。",
    featureStatusTitle: "可操作的 Agent 状态",
    featureStatusBody:
      "把思考、工具调用、输入、审批、完成和失败统一成整个工作空间的运行视图。",
    featureQuotaTitle: "供应商 Plan 余量",
    featureQuotaBody:
      "在模型路由前查看额度、重置周期、告警阈值和供应商可用性。",
    featureRemoteTitle: "连接式工作空间",
    featureRemoteBody:
      "安全共享工作空间状态，并从可信电脑和手机访问经过授权的终端。",
    modelTitle: "切换模型，不改变工作方式。",
    modelLead:
      "保留团队已经熟悉的 CLI。Termexo 把 Endpoint、模型、API Key 和 MCP 设置变成可切换、可恢复的明确 Profile。",
    modelPoint1: "兼容供应商 Profile",
    modelPoint2: "凭据保存到 Windows 凭据管理器",
    modelPoint3: "结合会话恢复的批量切换",
    roadmapTitle: "从本地控制走向可信访问。",
    roadmapLead:
      "路线图沿用同一个本地优先工作空间模型，并明确区分当前能力和后续规划。",
    current: "当前版本",
    planned: "规划中",
    roadmap02Title: "多 Agent 会话工作台",
    roadmap02Body:
      "Claude 与 Codex 检测、原生会话发现和恢复、自定义网格、Profile 与本地持久化。",
    roadmap04Title: "多 Agent 与供应商控制",
    roadmap04Body:
      "Gemini 与通用 CLI Adapter、CLI 一键安装升级、内网和 npm 代理 Profile、多个 Claude、Codex 和第三方供应商账号的分范围管理切换、失败回滚与 Plan 余量实时监控。",
    roadmap06Title: "上下文与任务编排",
    roadmap06Body: "会话摘要、跨 Agent 迁移、任务路由、协作和通知。",
    roadmap07Title: "Workspace 共享与远程访问",
    roadmap07Body: "可信设备、加密远程终端、手机审批、细粒度角色和审计日志。",
    principlesTitle: "你的电脑始终拥有最终控制权。",
    principlesLead:
      "远程能力应当延伸本地所有权，而不是取代它。Termexo 从一开始就围绕清晰的信任边界设计。",
    principle1Title: "默认留在本地",
    principle1Body:
      "项目路径、会话索引、终端状态和配置保留在电脑上，除非你明确选择共享。",
    principle2Title: "尊重 Agent 原生语义",
    principle2Body:
      "使用每个 CLI 真正的恢复和配置机制，而不是伪造一个通用会话。",
    principle3Title: "可随时撤销的远程信任",
    principle3Body:
      "规划中的远程访问采用设备配对、短期令牌、加密、明确角色和即时撤销。",
    ctaTitle: "让所有编程 Agent 聚焦在一个工作现场。",
    ctaLead:
      "Termexo 仍处于早期阶段，坚持本地优先并公开开发。下载 Windows 版本，或在 GitHub 跟踪开发路线。",
    getRelease: "获取最新版本",
    starGithub: "前往 GitHub",
    footerTagline: "AI 工作空间控制平面",
  },
};

const languageButtons = document.querySelectorAll("[data-lang]");
const translatedElements = document.querySelectorAll("[data-i18n]");
const nav = document.querySelector("[data-nav]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const header = document.querySelector("[data-header]");

function setLanguage(language) {
  const dictionary = translations[language] || translations.en;
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.title =
    language === "zh"
      ? "Termexo — AI 工作空间控制平面"
      : "Termexo — AI Workspace Control Plane";

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
