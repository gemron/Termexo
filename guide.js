(() => {
  const storageKey = "termexo.website.language";
  const translations = {
    en: {
      title: "Termexo User Guide (Simplified Chinese)",
      skip: "Skip to content",
      homeLabel: "Return to the Termexo website",
      home: "Home",
      navigation: "Guide navigation",
      language: "Menu language",
      contents: "On this page",
      chapters: "Chapters",
      contentsTitle: "USER GUIDE / CONTENTS",
      quickStart: "01  Install & get started",
      workbench: "02  Workspaces & terminals",
      sessions: "03  Resume sessions",
      profiles: "04  Accounts, models & network",
      tasks: "05  Tasks, Git & handoffs",
      remote: "06  Mobile & remote access",
      faq: "07  FAQ",
      privacy: "08  Data & security",
      edition: "Windows desktop edition\nV0.8.1 · Simplified Chinese",
      download: "Download PDF",
      downloadGuide: "Download guide · PDF (Chinese)",
      startReading: "Start reading ↓",
      contentNotice: "The guide content and PDF are in Simplified Chinese. The PDF matches this page and can be read offline. Examples use the Chinese app interface; button locations may differ in other versions.",
      footerTitle: "Termexo User Guide · V0.8.1",
      backToTop: "Back to top ↑",
      siteVisits: "Website visits (PV):",
      counterNotice: "Third-party website statistics only; “—” means unavailable.",
    },
    zh: {
      title: "Termexo 使用说明 | 安装、Agent 会话与远程访问",
      skip: "跳转到正文",
      homeLabel: "返回 Termexo 官网",
      home: "返回官网",
      navigation: "文档导航",
      language: "菜单语言",
      contents: "本页目录",
      chapters: "章节目录",
      contentsTitle: "使用说明 / CONTENTS",
      quickStart: "01　安装与第一次运行",
      workbench: "02　工作空间与终端",
      sessions: "03　恢复会话",
      profiles: "04　账号、模型与网络",
      tasks: "05　任务、Git 与交接",
      remote: "06　手机与远程访问",
      faq: "07　常见问题",
      privacy: "08　数据与安全",
      edition: "适用于 Windows 桌面版\nV0.8.1 · 简体中文",
      download: "下载 PDF",
      downloadGuide: "下载使用说明 · PDF",
      startReading: "开始阅读 ↓",
      contentNotice: "PDF 与本页内容同步，可离线阅读。本文以中文界面为例；其他版本的按钮位置可能略有不同。",
      footerTitle: "Termexo 使用说明 · V0.8.1",
      backToTop: "回到顶部 ↑",
      siteVisits: "官网累计访问量（PV）：",
      counterNotice: "第三方统计仅记录官网访问；“—”表示暂不可用。",
    },
  };
  const buttons = document.querySelectorAll("[data-lang]");
  const textElements = document.querySelectorAll("[data-guide-i18n]");
  const labelledElements = document.querySelectorAll("[data-guide-aria]");

  function setLanguage(value) {
    const language = value === "zh" ? "zh" : "en";
    const dictionary = translations[language];
    const htmlLanguage = language === "zh" ? "zh-CN" : "en";
    document.documentElement.lang = htmlLanguage;
    document.title = dictionary.title;
    textElements.forEach((element) => {
      element.textContent = dictionary[element.dataset.guideI18n];
      // The article itself remains Chinese; translated actions override that language.
      element.lang = htmlLanguage;
    });
    labelledElements.forEach((element) => {
      element.setAttribute("aria-label", dictionary[element.dataset.guideAria]);
    });
    buttons.forEach((button) => {
      const selected = button.dataset.lang === language;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    try {
      localStorage.setItem(storageKey, language);
    } catch {
      // Storage can be disabled; menu switching should still work in this page.
    }
  }

  let storedLanguage;
  try {
    storedLanguage = localStorage.getItem(storageKey);
  } catch {
    // Match the homepage's default when a saved preference is unavailable.
  }
  setLanguage(storedLanguage);
  buttons.forEach((button) => {
    button.addEventListener("click", () => setLanguage(button.dataset.lang));
  });
  document.querySelector("[data-guide-language-switch]").hidden = false;
})();
