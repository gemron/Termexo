(() => {
  const productionHosts = new Set(["www.termexo.com", "termexo.com"]);
  // Local previews must not pollute the public website's visit count.
  if (!productionHosts.has(location.hostname)) return;
  if (document.getElementById("termexo-public-counter")) return;

  const script = document.createElement("script");
  script.id = "termexo-public-counter";
  script.async = true;
  script.src = "https://busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js";
  document.head.append(script);
})();
