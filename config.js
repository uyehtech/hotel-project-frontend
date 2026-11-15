/* =====================================================================
   config.js — the ONE place the API address lives.
   Load it first on every page:  <script src="config.js"></script>
   Staging / production: change this single line (or serve a different
   config.js per environment). Nothing else in the site hard-codes it.
   ===================================================================== */
window.__API_BASE__ = "https://uyeh-hotel-backend.onrender.com/api";

/* Where a signed-in guest manages their account. Used by "log in to comment" links.
   Point this at whichever guest page you actually publish. */
window.__GUEST_PORTAL__ = "guest-panel.html";