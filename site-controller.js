/* ============================================================
   site-controller.js  (v2) — settings-driven controller for every
   guest-facing page. Plain <script> tag, no build step:

     <script>window.__API_BASE__ = "https://api.example.com/api";</script>
     <script src="/site-controller.js" defer></script>

   Do NOT include on admin/manager/staff dashboards.

   Reads GET /api/settings (Phase 5 F-41 shape; older shape still works)
   and applies, in order:
     1. Maintenance overlay (with secure bypass)
     2. Announcement banner
     3. Brand colours + favicon + logo slots
     4. Content slots   — [data-content="headline"] etc.
     5. Feature flags   — [data-feature="events"] hidden when off
     6. Language        — ?lang=, saved choice, browser; RTL; [data-i18n]
     7. Currency        — [data-price="120000" data-currency="NGN"]
     8. Branch picker   — [data-branch-select], window.SiteController.branch
     9. SEO             — title, description, OG, canonical, hreflang, JSON-LD
    10. Analytics       — GA4 / Meta Pixel, only after cookie consent
    11. Custom CSS/head
    12. Push opt-in     — SiteController.enablePush()
   Polls every 60s, pauses when the tab is hidden, skips re-applying
   when settings.version is unchanged. Never blocks the page if the
   API is down.
   ============================================================ */
(function (window, document) {
  "use strict";

  const API_BASE = (window.__API_BASE__ || "/api").replace(/\/$/, "");
  const POLL_MS = 60 * 1000;
  const NS = "uyeh";
  const KEY = {
    bannerDismissed: `${NS}_banner_dismissed`,
    bypass: `${NS}_maintenance_bypass`,
    lang: `${NS}_lang`,
    currency: `${NS}_currency`,
    branch: `${NS}_branch`,
    consent: `${NS}_cookie_consent`, // "all" | "essential"
    cache: `${NS}_settings_cache`,
  };

  let settings = null;
  let lastVersion = null;
  let rates = null;          // { base: "USD", rates: {...} }
  let strings = {};          // translations for current locale
  let locale = "en";
  let currency = null;
  let pollTimer = null;
  let fetching = false;
  const listeners = {};

  // ── Boot ───────────────────────────────────────────────────────
  // Apply the last known settings instantly (no flash of default
  // colours/branding), then refresh from the network.
  try {
    const cached = JSON.parse(localStorage.getItem(KEY.cache) || "null");
    if (cached) { settings = cached; }
  } catch (_) { /* ignore */ }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  async function init() {
    injectStyles();
    if (settings) applyAll(settings, { fromCache: true });
    await refresh();
    startPolling();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopPolling();
      else { refresh(); startPolling(); }
    });
  }

  function startPolling() { stopPolling(); pollTimer = setInterval(refresh, POLL_MS); }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  // ── Fetch ──────────────────────────────────────────────────────
  async function refresh() {
    if (fetching) return;
    fetching = true;
    try {
      const bypass = readBypass();
      const headers = bypass ? { "X-Bypass-Token": bypass } : {};
      const res = await fetch(`${API_BASE}/settings`, { headers, cache: bypass ? "no-store" : "default" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !data.settings) return;

      const s = data.settings;
      const version = s.version || JSON.stringify(s).length + ":" + hash(JSON.stringify(s));
      const changed = version !== lastVersion;
      settings = s;
      lastVersion = version;
      try { localStorage.setItem(KEY.cache, JSON.stringify(s)); } catch (_) { /* quota */ }
      if (changed) { applyAll(s); emit("settings", s); }
      else handleMaintenance(s); // maintenance can flip without a version bump on older backends
    } catch (err) {
      console.warn("[SiteController] settings unavailable:", err.message);
    } finally {
      fetching = false;
    }
  }

  function readBypass() {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("bypass");
    if (fromUrl) {
      sessionStorage.setItem(KEY.bypass, fromUrl);
      url.searchParams.delete("bypass");
      history.replaceState({}, "", url.toString()); // never leave the token in the address bar
    }
    return fromUrl || sessionStorage.getItem(KEY.bypass) || "";
  }

  async function applyAll(s, opts = {}) {
    safe(handleMaintenance, s);
    safe(handleBanner, s);
    safe(handleBrand, s);
    safe(handleContentSlots, s);
    safe(handleFeatureFlags, s);
    await safeAsync(handleLanguage, s, opts);
    await safeAsync(handleCurrency, s, opts);
    safe(handleBranches, s);
    safe(handleSEO, s);
    safe(handleConsentAndAnalytics, s);
    safe(handleCustomCode, s);
  }

  // ── 1. Maintenance ─────────────────────────────────────────────
  function handleMaintenance(s) {
    const el = document.getElementById(`${NS}-maintenance`);
    if (!s.maintenanceMode) {
      if (el) { el.remove(); document.documentElement.style.overflow = ""; }
      return;
    }
    if (el) return;
    const name = s.platformName || "";
    const o = document.createElement("div");
    o.id = `${NS}-maintenance`;
    o.setAttribute("role", "alertdialog");
    o.setAttribute("aria-modal", "true");
    o.setAttribute("aria-labelledby", `${NS}-maint-title`);
    o.innerHTML = `
      <div class="${NS}-maint-card">
        ${s.logoUrl ? `<img class="${NS}-maint-logo" src="${esc(s.logoUrl)}" alt="${esc(name)}" onerror="this.remove()">` : ""}
        <h1 id="${NS}-maint-title" class="${NS}-maint-title">${esc(tr("maintenance.title", s.maintenanceTitle || "Under maintenance"))}</h1>
        <p class="${NS}-maint-msg">${esc(tr("maintenance.message", s.maintenanceMessage || "We'll be back shortly."))}</p>
        ${s.maintenanceETA ? `<p class="${NS}-maint-eta">${esc(tr("maintenance.eta", "Estimated return"))}: <strong>${esc(s.maintenanceETA)}</strong></p>` : ""}
        ${s.email ? `<a class="${NS}-maint-link" href="mailto:${esc(s.email)}">${esc(tr("common.contact_us", "Contact us"))}</a>` : ""}
        <p class="${NS}-maint-footer">&copy; ${new Date().getFullYear()} ${esc(name)}</p>
      </div>`;
    document.body.appendChild(o);
    document.documentElement.style.overflow = "hidden";
  }

  // ── 2. Banner ──────────────────────────────────────────────────
  function handleBanner(s) {
    const b = s.banner || {};
    const existing = document.getElementById(`${NS}-banner`);
    if (!b.enabled || !b.text) { if (existing) existing.remove(); return; }

    const version = String(hash(b.text + (b.link || "")));
    if (localStorage.getItem(KEY.bannerDismissed) === version) { if (existing) existing.remove(); return; }

    const inner = `${esc(b.text)}${b.link ? ` <a class="${NS}-banner-link" href="${safeUrl(b.link)}">${esc(b.linkText || tr("common.learn_more", "Learn more"))}</a>` : ""}`;
    if (existing) { existing.querySelector(`.${NS}-banner-text`).innerHTML = inner; return; }

    const el = document.createElement("div");
    el.id = `${NS}-banner`;
    el.className = `${NS}-banner ${NS}-banner--${["info", "success", "warning", "urgent"].includes(b.type) ? b.type : "info"}`;
    el.setAttribute("role", b.type === "urgent" ? "alert" : "status");
    el.innerHTML = `<div class="${NS}-banner-inner"><span class="${NS}-banner-text">${inner}</span>${
      b.dismissible !== false ? `<button type="button" class="${NS}-banner-close" aria-label="${esc(tr("common.dismiss", "Dismiss"))}">&times;</button>` : ""}</div>`;
    const close = el.querySelector(`.${NS}-banner-close`);
    if (close) close.addEventListener("click", () => { localStorage.setItem(KEY.bannerDismissed, version); el.remove(); });
    document.body.insertBefore(el, document.body.firstChild);
  }

  // ── 3. Brand ───────────────────────────────────────────────────
  function handleBrand(s) {
    const brand = s.brand || {};
    const root = document.documentElement.style;
    // Generic names first; legacy names kept so existing page CSS still works.
    const map = { primaryColor: ["--brand-primary", "--ink"], secondaryColor: ["--brand-secondary", "--brass"], accentColor: ["--brand-accent", "--teal"] };
    for (const [k, vars] of Object.entries(map)) {
      if (/^#[0-9a-f]{6}$/i.test(brand[k] || "")) vars.forEach((v) => root.setProperty(v, brand[k]));
    }
    if (s.faviconUrl) {
      let link = document.querySelector('link[rel="icon"]');
      if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
      link.href = s.faviconUrl;
    }
    document.querySelectorAll("[data-logo]").forEach((img) => {
      if (s.logoUrl && img.tagName === "IMG") { img.src = s.logoUrl; img.alt = s.platformName || img.alt; }
    });
    document.querySelectorAll("[data-platform-name]").forEach((el) => { el.textContent = s.platformName || el.textContent; });
  }

  // ── 4. Content slots ───────────────────────────────────────────
  // <h1 data-content="headline">Fallback copy</h1>
  // <a data-content-href="footerEmail" data-content="footerEmail"></a>
  // <video data-content-src="heroVideoUrl"></video>
  function handleContentSlots(s) {
    document.querySelectorAll("[data-content]").forEach((el) => {
      const v = s[el.getAttribute("data-content")];
      if (typeof v === "string" && v.trim()) el.textContent = v;
    });
    document.querySelectorAll("[data-content-src]").forEach((el) => {
      const v = s[el.getAttribute("data-content-src")];
      if (v && el.getAttribute("src") !== v) { el.setAttribute("src", v); if (el.tagName === "VIDEO") el.load?.(); }
    });
    document.querySelectorAll("[data-content-href]").forEach((el) => {
      const key = el.getAttribute("data-content-href");
      const v = s[key];
      if (!v) return;
      el.href = /email/i.test(key) ? `mailto:${v}` : /phone/i.test(key) ? `tel:${String(v).replace(/[^\d+]/g, "")}` : safeUrl(v);
    });
    const social = s.socialLinks || {};
    document.querySelectorAll("[data-social]").forEach((el) => {
      const v = social[el.getAttribute("data-social")];
      if (v) { el.href = safeUrl(v); el.hidden = false; } else el.hidden = true;
    });
  }

  // ── 5. Feature flags ───────────────────────────────────────────
  // <a data-feature="events" href="/events.html">Events</a>
  function isFeatureEnabled(name) {
    if (!settings) return true;
    const f = settings.features || {};
    return f[`${name}Enabled`] !== false && f[name] !== false;
  }
  function handleFeatureFlags() {
    document.querySelectorAll("[data-feature]").forEach((el) => {
      el.hidden = !isFeatureEnabled(el.getAttribute("data-feature"));
    });
  }

  // ── 6. Language ────────────────────────────────────────────────
  // <span data-i18n="nav.book_now">Book now</span>
  // <input data-i18n-placeholder="search.where">
  // <select data-lang-select></select>
  async function handleLanguage(s, { fromCache } = {}) {
    const i18n = s.i18n || { defaultLocale: "en", supportedLocales: ["en"], rtlLocales: ["ar", "he", "fa", "ur"] };
    const supported = i18n.supportedLocales?.length ? i18n.supportedLocales : ["en"];
    const fromUrl = new URLSearchParams(location.search).get("lang");
    if (fromUrl) localStorage.setItem(KEY.lang, fromUrl);
    const wanted = [fromUrl, localStorage.getItem(KEY.lang), ...(navigator.languages || [navigator.language]), i18n.defaultLocale, "en"];
    const pick = (l) => l && (supported.find((x) => x.toLowerCase() === l.toLowerCase()) || supported.find((x) => x.split("-")[0] === l.split("-")[0].toLowerCase()));
    const next = wanted.map(pick).find(Boolean) || "en";

    const changed = next !== locale || !Object.keys(strings).length;
    locale = next;
    document.documentElement.lang = locale;
    document.documentElement.dir = (i18n.rtlLocales || []).includes(locale.split("-")[0]) ? "rtl" : "ltr";

    if (changed && !fromCache && supported.length > 1) {
      try {
        const res = await fetch(`${API_BASE}/i18n/${encodeURIComponent(locale)}`);
        if (res.ok) strings = (await res.json()).strings || {};
      } catch (_) { /* keep page copy */ }
    }
    translateDom();
    renderLangSelect(supported);
    if (changed) emit("locale", locale);
  }

  function tr(key, fallback, vars) {
    let v = strings[key] ?? fallback ?? key;
    if (vars) v = v.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
    return v;
  }

  function translateDom(root = document) {
    if (!Object.keys(strings).length) return;
    root.querySelectorAll("[data-i18n]").forEach((el) => { const v = strings[el.getAttribute("data-i18n")]; if (v) el.textContent = v; });
    ["placeholder", "title", "aria-label", "alt"].forEach((attr) => {
      root.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => { const v = strings[el.getAttribute(`data-i18n-${attr}`)]; if (v) el.setAttribute(attr, v); });
    });
  }

  function renderLangSelect(supported) {
    document.querySelectorAll("[data-lang-select]").forEach((sel) => {
      if (supported.length < 2) { sel.hidden = true; return; }
      sel.hidden = false;
      const names = new Intl.DisplayNames([locale], { type: "language" });
      sel.innerHTML = supported.map((l) => `<option value="${esc(l)}"${l === locale ? " selected" : ""}>${esc(cap(names.of(l) || l))}</option>`).join("");
      if (!sel.__bound) {
        sel.__bound = true;
        sel.addEventListener("change", () => setLocale(sel.value));
      }
    });
  }

  async function setLocale(l) {
    localStorage.setItem(KEY.lang, l);
    strings = {};
    await handleLanguage(settings || {});
    await handleCurrency(settings || {}); // number formats follow the language
  }

  // ── 7. Currency ────────────────────────────────────────────────
  // <span data-price="120000" data-currency="NGN"></span>
  // <select data-currency-select></select>
  async function handleCurrency(s, { fromCache } = {}) {
    const cfg = s.currency || { base: s.baseCurrency || "NGN", supported: [s.baseCurrency || "NGN"] };
    const supported = cfg.supported?.length ? cfg.supported : [cfg.base];
    const saved = localStorage.getItem(KEY.currency);
    currency = supported.includes(saved) ? saved : guessCurrency(supported) || cfg.base;

    if (supported.length > 1 && !rates && !fromCache) {
      try {
        const res = await fetch(`${API_BASE}/exchange-rates`);
        if (res.ok) rates = await res.json();
      } catch (_) { /* show native prices */ }
    }
    renderPrices();
    renderCurrencySelect(supported);
  }

  function guessCurrency(supported) {
    // Region from the browser locale ("en-GB" -> GB) to a sensible default.
    const region = (navigator.language || "").split("-")[1];
    const byRegion = { GB: "GBP", US: "USD", NG: "NGN", GH: "GHS", KE: "KES", ZA: "ZAR", AE: "AED", FR: "EUR", DE: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", CA: "CAD" };
    const c = byRegion[region];
    return c && supported.includes(c) ? c : null;
  }

  function convert(amount, from, to) {
    if (!rates || from === to) return { amount, currency: from, converted: false };
    const r = rates.rates || {};
    if (!r[from] || !r[to]) return { amount, currency: from, converted: false };
    return { amount: (Number(amount) / r[from]) * r[to], currency: to, converted: true };
  }

  function formatMoney(amount, cur) {
    try { return new Intl.NumberFormat(locale, { style: "currency", currency: cur, maximumFractionDigits: cur === "JPY" ? 0 : 2 }).format(amount); }
    catch (_) { return `${cur} ${Number(amount).toFixed(2)}`; }
  }

  function renderPrices(root = document) {
    root.querySelectorAll("[data-price]").forEach((el) => {
      const raw = Number(el.getAttribute("data-price"));
      const from = el.getAttribute("data-currency") || (settings && settings.baseCurrency) || "NGN";
      if (!isFinite(raw)) return;
      const c = convert(raw, from, currency || from);
      el.textContent = formatMoney(c.amount, c.currency);
      // The charge is always in the property's own currency — say so.
      if (c.converted) el.title = tr("price.indicative", "Approximate. You'll be charged {amount} at booking.", { amount: formatMoney(raw, from) });
      else el.removeAttribute("title");
    });
  }

  function renderCurrencySelect(supported) {
    document.querySelectorAll("[data-currency-select]").forEach((sel) => {
      if (supported.length < 2) { sel.hidden = true; return; }
      sel.hidden = false;
      sel.innerHTML = supported.map((c) => `<option value="${esc(c)}"${c === currency ? " selected" : ""}>${esc(c)}</option>`).join("");
      if (!sel.__bound) {
        sel.__bound = true;
        sel.addEventListener("change", () => setCurrency(sel.value));
      }
    });
  }

  function setCurrency(c) {
    currency = c;
    localStorage.setItem(KEY.currency, c);
    renderPrices();
    emit("currency", c);
  }

  // ── 8. Branches ────────────────────────────────────────────────
  // <select data-branch-select></select>  — or read SiteController.branch
  function handleBranches(s) {
    const branches = s.branches || [];
    const fromUrl = new URLSearchParams(location.search).get("branch");
    if (fromUrl) localStorage.setItem(KEY.branch, fromUrl);
    const saved = localStorage.getItem(KEY.branch);
    const current = branches.find((b) => b.id === saved || b.slug === saved) || null;

    document.querySelectorAll("[data-branch-select]").forEach((sel) => {
      if (!branches.length) { sel.hidden = true; return; }
      sel.hidden = false;
      sel.innerHTML = `<option value="">${esc(tr("branch.all", "All locations"))}</option>` +
        branches.map((b) => `<option value="${esc(b.id)}"${current && current.id === b.id ? " selected" : ""}>${esc(b.name)}${b.city ? ` — ${esc(b.city)}` : ""}</option>`).join("");
      if (!sel.__bound) {
        sel.__bound = true;
        sel.addEventListener("change", () => {
          if (sel.value) localStorage.setItem(KEY.branch, sel.value); else localStorage.removeItem(KEY.branch);
          emit("branch", getBranch());
        });
      }
    });
  }
  function getBranch() {
    const saved = localStorage.getItem(KEY.branch);
    return (settings?.branches || []).find((b) => b.id === saved || b.slug === saved) || null;
  }

  // ── 9. SEO ─────────────────────────────────────────────────────
  // Pages can set <meta name="sc-page-title" content="Rooms"> to get
  // "Rooms | Platform name" instead of the global title.
  function handleSEO(s) {
    const seo = s.seo || {};
    const pageTitle = document.querySelector('meta[name="sc-page-title"]')?.content;
    const title = pageTitle ? `${pageTitle} | ${s.platformName || seo.metaTitle || ""}` : seo.metaTitle;
    if (title) document.title = title;
    setMeta("name", "description", seo.metaDescription);
    setMeta("name", "keywords", seo.metaKeywords);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", seo.metaDescription);
    setMeta("property", "og:image", seo.ogImageUrl);
    setMeta("property", "og:type", "website");
    setMeta("property", "og:locale", locale.replace("-", "_"));
    setMeta("name", "twitter:card", seo.ogImageUrl ? "summary_large_image" : "summary");

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; document.head.appendChild(canonical); }
    const clean = new URL(location.href);
    ["bypass", "utm_source", "utm_medium", "utm_campaign", "fbclid", "gclid"].forEach((p) => clean.searchParams.delete(p));
    canonical.href = clean.toString();

    // hreflang alternates so search engines serve the right language.
    document.querySelectorAll(`link[data-${NS}-hreflang]`).forEach((l) => l.remove());
    const langs = s.i18n?.supportedLocales || [];
    if (langs.length > 1) {
      langs.concat("x-default").forEach((l) => {
        const u = new URL(clean); if (l !== "x-default") u.searchParams.set("lang", l); else u.searchParams.delete("lang");
        const link = document.createElement("link");
        link.rel = "alternate"; link.hreflang = l; link.href = u.toString(); link.setAttribute(`data-${NS}-hreflang`, "");
        document.head.appendChild(link);
      });
    }

    // Organisation + hotels as structured data (rich results in search).
    let ld = document.getElementById(`${NS}-jsonld`);
    if (!ld) { ld = document.createElement("script"); ld.type = "application/ld+json"; ld.id = `${NS}-jsonld`; document.head.appendChild(ld); }
    const sameAs = Object.values(s.socialLinks || {}).filter(Boolean);
    ld.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: s.platformName, url: location.origin, logo: s.logoUrl || undefined, email: s.email || undefined, telephone: s.phone || undefined, sameAs: sameAs.length ? sameAs : undefined },
        ...(s.branches || []).map((b) => ({
          "@type": "Hotel", name: b.name, url: `${location.origin}/location.html?branch=${encodeURIComponent(b.slug || b.id)}`,
          image: b.heroImageUrl || undefined,
          address: b.city ? { "@type": "PostalAddress", addressLocality: b.city, addressCountry: b.countryCode || undefined } : undefined,
          checkinTime: s.checkInTime || undefined, checkoutTime: s.checkOutTime || undefined,
        })),
      ],
    });
  }

  function setMeta(attr, name, content) {
    if (!content) return;
    let tag = document.querySelector(`meta[${attr}="${name}"]`);
    if (!tag) { tag = document.createElement("meta"); tag.setAttribute(attr, name); document.head.appendChild(tag); }
    tag.setAttribute("content", content);
  }

  // ── 10. Consent + analytics ────────────────────────────────────
  // Nothing tracks until the visitor agrees (GDPR / UK / NDPR / CCPA).
  function handleConsentAndAnalytics(s) {
    const a = s.analytics || { googleAnalyticsId: s.seo?.googleAnalyticsId, facebookPixelId: s.seo?.facebookPixelId, consentRequired: true };
    const hasTrackers = !!(a.googleAnalyticsId || a.facebookPixelId);
    const consent = localStorage.getItem(KEY.consent);

    if (!hasTrackers) return;
    if (a.consentRequired !== false && !consent) { showConsent(s, a); return; }
    if (a.consentRequired === false || consent === "all") loadTrackers(a);
  }

  function showConsent(s, a) {
    if (document.getElementById(`${NS}-consent`)) return;
    const legal = s.legal || {};
    const el = document.createElement("div");
    el.id = `${NS}-consent`;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", tr("consent.title", "Cookie preferences"));
    el.innerHTML = `
      <p>${esc(tr("consent.text", "We use cookies to understand how our site is used and to improve your stay."))}
        ${legal.privacyUrl ? `<a href="${safeUrl(legal.privacyUrl)}">${esc(tr("consent.privacy", "Privacy policy"))}</a>` : ""}</p>
      <div class="${NS}-consent-actions">
        <button type="button" data-choice="essential">${esc(tr("consent.essential", "Essential only"))}</button>
        <button type="button" data-choice="all" class="${NS}-primary">${esc(tr("consent.accept", "Accept all"))}</button>
      </div>`;
    el.addEventListener("click", (e) => {
      const choice = e.target.getAttribute && e.target.getAttribute("data-choice");
      if (!choice) return;
      localStorage.setItem(KEY.consent, choice);
      el.remove();
      if (choice === "all") loadTrackers(a);
      emit("consent", choice);
    });
    document.body.appendChild(el);
  }

  function loadTrackers(a) {
    if (a.googleAnalyticsId && !window.__uyeh_ga) {
      window.__uyeh_ga = true;
      loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(a.googleAnalyticsId)}`);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", a.googleAnalyticsId, { anonymize_ip: true });
    }
    if (a.facebookPixelId && !window.fbq) {
      /* eslint-disable */
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");
      /* eslint-enable */
      window.fbq("init", a.facebookPixelId);
      window.fbq("track", "PageView");
    }
  }

  /** Pages call this on meaningful actions; it no-ops without consent. */
  function track(event, params = {}) {
    if (localStorage.getItem(KEY.consent) !== "all" && settings?.analytics?.consentRequired !== false) return;
    if (window.gtag) window.gtag("event", event, params);
    if (window.fbq) window.fbq("trackCustom", event, params);
  }

  // ── 11. Custom CSS / head ──────────────────────────────────────
  function handleCustomCode(s) {
    replaceBlock(`${NS}-custom-css`, s.customCSS, (c) => { const st = document.createElement("style"); st.id = `${NS}-custom-css`; st.textContent = c; document.head.appendChild(st); });
    // Director-authored. Only <meta>, <link> and <style> are allowed through —
    // never <script>, so a compromised admin account cannot inject JS here.
    replaceBlock(`${NS}-custom-head`, s.customHead, (c) => {
      const tpl = document.createElement("template");
      tpl.innerHTML = c;
      const frag = document.createDocumentFragment();
      tpl.content.querySelectorAll("meta, link, style").forEach((n) => { n.setAttribute(`data-${NS}-custom-head`, ""); frag.appendChild(n.cloneNode(true)); });
      document.head.appendChild(frag);
      const marker = document.createElement("meta"); marker.id = `${NS}-custom-head`; document.head.appendChild(marker);
    });
  }
  function replaceBlock(id, content, inject) {
    document.getElementById(id)?.remove();
    if (id.endsWith("custom-head")) document.querySelectorAll(`[data-${NS}-custom-head]`).forEach((n) => n.remove());
    if (content) inject(content);
  }

  // ── 12. Push (opt-in, logged-in guests) ────────────────────────
  // await SiteController.enablePush({ token: guestAccessToken, swUrl: "/sw.js" })
  async function enablePush({ token, swUrl = "/sw.js" } = {}) {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Push is not supported on this browser");
    const key = settings?.push?.vapidPublicKey;
    if (!key) throw new Error("Push is not configured");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Permission denied");
    const reg = await navigator.serviceWorker.register(swUrl);
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) });
    const res = await fetch(`${API_BASE}/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(sub.toJSON()),
    });
    if (!res.ok) throw new Error(`Subscribe failed (${res.status})`);
    return true;
  }
  function urlB64(base64) {
    const pad = "=".repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  // ── Events ─────────────────────────────────────────────────────
  // SiteController.on("currency", (c) => ...)  events: settings, locale,
  // currency, branch, consent
  function on(evt, fn) { (listeners[evt] ||= []).push(fn); return () => off(evt, fn); }
  function off(evt, fn) { listeners[evt] = (listeners[evt] || []).filter((f) => f !== fn); }
  function emit(evt, payload) {
    (listeners[evt] || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
    document.dispatchEvent(new CustomEvent(`sitecontroller:${evt}`, { detail: payload }));
  }

  // ── Styles (overlay, banner, consent only) ─────────────────────
  function injectStyles() {
    if (document.getElementById(`${NS}-sc-styles`)) return;
    const st = document.createElement("style");
    st.id = `${NS}-sc-styles`;
    st.textContent = `
      #${NS}-maintenance{position:fixed;inset:0;z-index:2147483000;background:var(--brand-primary,var(--ink,#14181f));display:flex;align-items:center;justify-content:center;padding:24px}
      .${NS}-maint-card{max-width:460px;width:100%;text-align:center;padding:48px 32px;border:1px solid rgba(255,255,255,.12);border-radius:10px;color:#ede6d6;font-family:inherit}
      .${NS}-maint-logo{width:56px;height:56px;object-fit:contain;margin:0 auto 20px;display:block}
      .${NS}-maint-title{font-size:1.6rem;margin:0 0 12px;color:var(--brand-secondary,var(--brass,#b98d45))}
      .${NS}-maint-msg{opacity:.8;line-height:1.6;margin:0 0 16px}
      .${NS}-maint-eta{opacity:.7;font-size:.9rem}
      .${NS}-maint-link{color:var(--brand-secondary,var(--brass,#b98d45))}
      .${NS}-maint-footer{opacity:.4;font-size:.75rem;margin-top:24px}
      .${NS}-banner{position:relative;z-index:9998;padding:10px 16px;font-size:.88rem}
      .${NS}-banner--info{background:var(--brand-primary,#14181f);color:#ede6d6}
      .${NS}-banner--success{background:var(--brand-accent,#2f5d5a);color:#ede6d6}
      .${NS}-banner--warning{background:var(--brand-secondary,#b98d45);color:#14181f}
      .${NS}-banner--urgent{background:#a3392a;color:#fff}
      .${NS}-banner-inner{display:flex;gap:12px;align-items:center;justify-content:center;max-width:1180px;margin:0 auto}
      .${NS}-banner-text{flex:1;text-align:center}
      .${NS}-banner-link{color:inherit;font-weight:600;text-decoration:underline}
      .${NS}-banner-close{background:none;border:0;color:inherit;font-size:1.2rem;cursor:pointer;opacity:.75;min-width:32px;min-height:32px}
      #${NS}-consent{position:fixed;inset-inline:16px;bottom:16px;z-index:9999;max-width:560px;margin-inline:auto;background:#fff;color:#14181f;border-radius:10px;padding:16px 18px;box-shadow:0 10px 30px rgba(0,0,0,.18);font-size:.9rem}
      #${NS}-consent p{margin:0 0 12px;line-height:1.5}
      #${NS}-consent a{color:inherit;text-decoration:underline}
      .${NS}-consent-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
      .${NS}-consent-actions button{border:1px solid #14181f;background:transparent;color:#14181f;border-radius:6px;padding:8px 14px;cursor:pointer;font:inherit}
      .${NS}-consent-actions .${NS}-primary{background:var(--brand-primary,#14181f);color:#fff;border-color:transparent}
      [dir="rtl"] .${NS}-consent-actions{justify-content:flex-start}
      @media (prefers-reduced-motion:no-preference){.${NS}-banner,#${NS}-consent{animation:${NS}-in .25s ease-out}}
      @keyframes ${NS}-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
    `;
    document.head.appendChild(st);
  }

  // ── Utils ──────────────────────────────────────────────────────
  function esc(v) { return v == null ? "" : String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function safeUrl(u) { try { const x = new URL(u, location.href); return ["http:", "https:", "mailto:", "tel:"].includes(x.protocol) ? esc(x.href) : "#"; } catch (_) { return "#"; } }
  function hash(str) { let h = 0; for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; } return h; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function loadScript(src) { const sc = document.createElement("script"); sc.async = true; sc.src = src; document.head.appendChild(sc); }
  function safe(fn, s) { try { fn(s); } catch (e) { console.error(`[SiteController] ${fn.name} failed:`, e); } }
  async function safeAsync(fn, s, o) { try { await fn(s, o); } catch (e) { console.error(`[SiteController] ${fn.name} failed:`, e); } }

  // ── Public API ─────────────────────────────────────────────────
  window.SiteController = {
    refresh,
    getSettings: () => settings,
    isFeatureEnabled,
    // language
    getLocale: () => locale, setLocale, t: tr, translate: translateDom,
    // money
    getCurrency: () => currency, setCurrency, formatMoney, convert,
    renderPrices, // call after injecting new [data-price] elements
    // branches
    get branch() { return getBranch(); }, getBranch,
    // analytics / push
    track, enablePush,
    // events
    on, off,
  };
})(window, document);