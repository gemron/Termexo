(() => {
  const productionHosts = new Set(["www.termexo.com", "termexo.com"]);
  const token = document.querySelector('meta[name="termexo-analytics-token"]')?.content.trim();

  // The public site token comes from the owner's Cloudflare Web Analytics dashboard.
  // Local previews and unconfigured builds must not pollute production traffic.
  if (!productionHosts.has(location.hostname) || !/^[a-f0-9]{32}$/i.test(token ?? "")) return;
  if (document.querySelector('script[data-cf-beacon]')) return;

  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.dataset.cfBeacon = JSON.stringify({ token });
  document.head.append(script);
})();
