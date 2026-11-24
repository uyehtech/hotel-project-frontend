/* =====================================================================
   web-core.js — helpers shared by every public page.

   Load order (in <head>):
     <script src="config.js"></script>
     <script src="web-core.js"></script>
     <script src="site-controller.js" defer></script>

   Exposes window.Uyeh:
     API_BASE                 from config.js
     api(path, options)       fetch + JSON, sends Accept-Language, retries a
                              GET once on a cold-start 502/503/504, throws
                              ApiError { status, code, data }
     fmtMoney(amount, cur)    Intl money in the visitor's language; whole
                              amounts without ".00", real amounts exact
     priceHtml(amount, cur)   <span data-price> that site-controller converts
                              to the visitor's chosen currency (browse pages
                              only — never use it for what a guest will pay)
     fmtDate(value, opts)     date-only values (2026-11-20) are formatted in
                              UTC so they never slip a day in the Americas
     fmtDateTime(value)       real timestamps, in the visitor's time zone
     t(english, vars)         translate a UI sentence ("{name}" placeholders)
     esc / safeUrl            HTML + URL escaping
     ready                    Promise: language has been resolved (<=1.2 s)
   ===================================================================== */
(function (w, d) {
  "use strict";
  if (w.Uyeh) return;

  const API_BASE = String(w.__API_BASE__ || "https://uyeh-hotel-backend.onrender.com/api").replace(/\/$/, "");
  const LANG_KEY = "uyeh_lang";
  const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

  const safeGet = (k) => { try { return w.localStorage.getItem(k); } catch (_) { return null; } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => {
    try { const x = new URL(u, w.location.href); return ["http:", "https:", "mailto:", "tel:"].includes(x.protocol) ? x.href : ""; }
    catch (_) { return ""; }
  };

  /* ---------- language ---------- */
  let resolvedLocale = null;
  d.addEventListener("sitecontroller:locale", (e) => { resolvedLocale = e.detail || resolvedLocale; });

  function chosenLanguage() {
    const fromUrl = new URLSearchParams(w.location.search).get("lang");
    if (fromUrl && LANG_RE.test(fromUrl)) return fromUrl;
    const saved = safeGet(LANG_KEY);
    return saved && LANG_RE.test(saved) ? saved : null;
  }

  /** Locale used for number/date formatting: the page language once it is known. */
  function intlLocale() {
    const list = [resolvedLocale, chosenLanguage(), ...(navigator.languages || [navigator.language])].filter(Boolean);
    for (const l of list) {
      try { if (Intl.NumberFormat.supportedLocalesOf(l).length) return l; } catch (_) { /* next */ }
    }
    return undefined;
  }

  /** "fr-CA, fr;q=0.9, en;q=0.8" — the guest's pick first, then the browser's list. */
  function acceptLanguage() {
    const list = [chosenLanguage(), ...(navigator.languages || [navigator.language])].filter((l) => l && LANG_RE.test(l));
    return [...new Set(list)].slice(0, 5).map((l, i) => (i === 0 ? l : `${l};q=${Math.max(0.1, 1 - i * 0.1).toFixed(1)}`)).join(", ") || "en";
  }

  /* ---------- translation ---------- */
  function fill(text, vars) {
    return vars ? String(text).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`)) : String(text);
  }
  function t(english, vars) {
    const sc = w.SiteController;
    return sc && sc.tt ? sc.tt(english, vars) : fill(english, vars);
  }

  const ready = new Promise((resolve) => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    d.addEventListener("sitecontroller:locale", fin, { once: true });
    setTimeout(fin, 1200); // never hold a page hostage to the language call
  });

  /* ---------- money + dates ---------- */
  function fmtMoney(amount, currency) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return "—";
    const whole = Number.isInteger(n);
    try {
      return new Intl.NumberFormat(intlLocale(), {
        style: "currency", currency: currency || "", currencyDisplay: currency === "NGN" ? "narrowSymbol" : "symbol", // throws when missing -> plain number below
        ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
      }).format(n);
    } catch (_) {
      return `${currency || ""} ${n.toLocaleString(intlLocale())}`.trim();
    }
  }

  function priceHtml(amount, currency) {
    const n = Number(amount);
    if (!Number.isFinite(n) || !currency) return esc(fmtMoney(amount, currency));
    return `<span data-price="${esc(n)}" data-currency="${esc(currency)}">${esc(fmtMoney(n, currency))}</span>`;
  }

  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.0+)?Z)?$/;
  function fmtDate(value, opts) {
    if (!value) return "";
    const dt = new Date(value);
    if (isNaN(dt)) return "";
    const o = { month: "short", day: "numeric", year: "numeric", ...(opts || {}) };
    if (typeof value === "string" && DATE_ONLY.test(value)) o.timeZone = "UTC"; // a calendar date, not an instant
    try { return new Intl.DateTimeFormat(intlLocale(), o).format(dt); } catch (_) { return dt.toDateString(); }
  }
  function fmtDateTime(value) {
    if (!value) return "";
    const dt = new Date(value);
    if (isNaN(dt)) return "";
    try { return new Intl.DateTimeFormat(intlLocale(), { dateStyle: "medium", timeStyle: "short" }).format(dt); }
    catch (_) { return dt.toLocaleString(); }
  }

  /* ---------- API ---------- */
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = "ApiError";
      this.status = status || 0;
      this.data = data || {};
      this.code = (data && data.code) || null;
    }
  }

  async function api(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = { "Accept-Language": acceptLanguage(), ...(options.headers || {}) };
    const hasType = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
    if (options.body != null && !hasType && !(typeof FormData !== "undefined" && options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    const attempts = method === "GET" ? 2 : 1;
    for (let i = 0; i < attempts; i++) {
      let res;
      try {
        res = await fetch(`${API_BASE}${path}`, { ...options, headers });
      } catch (_) {
        if (i < attempts - 1) { await sleep(1500); continue; } // network blip / cold start
        throw new ApiError(t("We couldn't reach the server. Check your connection and try again."), 0, {});
      }
      if (method === "GET" && [502, 503, 504].includes(res.status) && i < attempts - 1) { await sleep(1500); continue; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof data.error === "string" && data.error ? data.error
          : res.status === 429 ? t("Too many requests — please wait a moment and try again.")
          : t("Request failed ({status})", { status: res.status });
        throw new ApiError(msg, res.status, data);
      }
      return data;
    }
  }

  w.Uyeh = { version: "F1", API_BASE, api, ApiError, fmtMoney, priceHtml, fmtDate, fmtDateTime, t, esc, safeUrl, acceptLanguage, intlLocale, ready };
})(window, document);