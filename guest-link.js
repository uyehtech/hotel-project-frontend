/* guest-link.js — puts a visible "Sign in" / "My account" link on every public page.
   Add before </body>:  <script src="guest-link.js" defer></script>
   Needs window.__GUEST_PORTAL__ (config.js). Safe to load twice. */
(function () {
  "use strict";
  if (window.__guestLinkLoaded) return; window.__guestLinkLoaded = true;
  var portal = window.__GUEST_PORTAL__ || "guest-panel.html";
  var signedIn = false, first = "";
  try {
    signedIn = !!localStorage.getItem("guest_token");
    var u = JSON.parse(localStorage.getItem("guest_user") || "null"); first = u && u.name ? String(u.name).split(" ")[0] : "";
  } catch (e) { /* storage blocked: treat as signed out */ }
  function make(cls) {
    var a = document.createElement("a");
    a.href = portal; a.className = cls + " guest-link";
    a.textContent = signedIn ? (first ? "My account (" + first + ")" : "My account") : "Sign in";
    a.setAttribute("data-guest-link", "1");
    return a;
  }
  function mount() {
    if (document.querySelector("[data-guest-link]")) return;
    var links = document.getElementById("navLinks") || document.querySelector(".nav-links");
    if (links) {
      var a = make(""), cta = links.querySelector(".nav-cta");
      if (cta) links.insertBefore(a, cta); else links.appendChild(a);
      return;
    }
    // pages without a nav menu: small floating pill, top right
    var f = make("guest-link-float");
    f.style.cssText = "position:fixed;top:14px;right:14px;z-index:900;padding:8px 16px;border-radius:999px;background:#1c1a17;color:#f4efe4;font:600 .85rem/1 system-ui,sans-serif;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.25)";
    document.body.appendChild(f);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
