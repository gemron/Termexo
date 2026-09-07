(() => {
  const storageKey = "termexo.website.language";
  const language = document.documentElement.lang === "zh-CN" ? "zh" : "en";
  const links = document.querySelectorAll("a[data-lang]");
  const pages = { en: "guide.en.html", zh: "guide.html" };

  function remember(value) {
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      // Both complete translations and their PDF links work without storage or JavaScript.
    }
  }

  function keepChapter() {
    links.forEach((link) => {
      link.setAttribute("href", pages[link.dataset.lang] + location.hash);
    });
  }

  // The explicit URL wins over old preferences and never redirects a shared English link.
  remember(language);
  links.forEach((link) => {
    link.addEventListener("click", () => remember(link.dataset.lang));
  });
  keepChapter();
  window.addEventListener("hashchange", keepChapter);
})();
