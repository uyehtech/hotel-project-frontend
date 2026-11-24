/* room-media.js — plays room videos reliably and builds the room gallery.
   Load before the page script:  <script src="room-media.js"></script>   (window.UyehMedia)

   Why videos often "don't play": phones record .mov / HEVC, which Chrome, Android and many laptops
   can't decode. For videos stored on Cloudinary this converts on delivery to H.264 .mp4 (plays
   everywhere) and makes a poster frame. Other video links play as they are; YouTube and Vimeo
   links are embedded. If playback still fails, the viewer sees a clear message with an
   "open video" link instead of a black box. */
(function () {
  "use strict";
  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var CLD = /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\/)(.+)$/i;

  function cldSwapExt(path, ext) { return path.replace(/\.[a-z0-9]{2,4}(\?.*)?$/i, "." + ext + "$1"); }
  function mp4(url) { var m = CLD.exec(url || ""); return m ? m[1] + "f_mp4,vc_h264,ac_aac,q_auto/" + cldSwapExt(m[2], "mp4") : url; }
  function poster(url) { var m = CLD.exec(url || ""); return m ? m[1] + "so_0,f_jpg,q_auto,w_1280/" + cldSwapExt(m[2], "jpg") : ""; }
  function embed(url) {
    var y = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/i.exec(url || "");
    if (y) return "https://www.youtube-nocookie.com/embed/" + y[1] + "?rel=0&playsinline=1";
    var v = /vimeo\.com\/(?:video\/)?(\d+)/i.exec(url || "");
    if (v) return "https://player.vimeo.com/video/" + v[1];
    return "";
  }

  /** Markup for one player. opts.autoplay -> muted looping preview (no controls clutter). */
  function player(url, opts) {
    opts = opts || {};
    var e = embed(url);
    if (e) return '<iframe class="um-embed" src="' + esc(e) + '" title="' + esc(opts.title || "Room video") + '" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy" style="width:100%;height:100%;border:0"></iframe>';
    var p = poster(url);
    return '<video class="um-video" playsinline preload="metadata" controls controlsList="nodownload"' + (p ? ' poster="' + esc(p) + '"' : "") +
      (opts.autoplay ? " muted loop autoplay" : "") + ' data-orig="' + esc(url) + '" style="width:100%;height:100%;object-fit:contain;background:#000">' +
      '<source src="' + esc(mp4(url)) + '"' + (/\.mp4(\?|$)/i.test(mp4(url)) ? ' type="video/mp4"' : "") + '></video>';
  }

  /** Call after inserting player markup: adds the fallback for videos that can't be played. */
  function guard(root) {
    [].forEach.call((root || document).querySelectorAll("video.um-video:not([data-guarded])"), function (v) {
      v.setAttribute("data-guarded", "1");
      var tried = false;
      function fail() {
        if (!tried && v.getAttribute("data-orig") && v.getAttribute("data-orig") !== (v.querySelector("source") || {}).src) {
          tried = true; v.removeAttribute("poster");
          v.innerHTML = '<source src="' + esc(v.getAttribute("data-orig")) + '">'; v.load(); return;
        }
        var box = document.createElement("div");
        box.className = "um-fail";
        box.style.cssText = "display:grid;place-items:center;text-align:center;height:100%;padding:24px;background:#14181f;color:#ede6d6;font:500 .95rem system-ui,sans-serif";
        box.innerHTML = '<div>This video can\'t be played in your browser.<br><a href="' + esc(v.getAttribute("data-orig")) + '" target="_blank" rel="noopener" style="color:#d9b876">Open the video in a new tab</a></div>';
        v.replaceWith(box);
      }
      v.addEventListener("error", fail, true);
      var s = v.querySelector("source"); if (s) s.addEventListener("error", fail);
    });
  }

  /** Gallery: video first (if any), then photos. Renders into mainEl + thumbsEl. */
  function gallery(opts) {
    var images = (opts.images || []).filter(Boolean), items = [];
    if (opts.videoUrl) items.push({ kind: "video", url: opts.videoUrl });
    images.forEach(function (u) { items.push({ kind: "image", url: u }); });
    if (!items.length) items.push({ kind: "none" });
    var main = opts.main, thumbs = opts.thumbs, cur = 0;
    function show(i) {
      cur = (i + items.length) % items.length; var it = items[cur];
      var old = main.querySelector("video"); if (old) old.pause();
      main.style.backgroundImage = "";
      if (it.kind === "video") { main.innerHTML = player(it.url, { title: opts.name }); guard(main); }
      else if (it.kind === "image") { main.innerHTML = ""; main.style.backgroundImage = "url('" + it.url.replace(/'/g, "%27") + "')"; main.setAttribute("role", "img"); main.setAttribute("aria-label", (opts.name || "Room") + " photo"); }
      else main.innerHTML = "";
      [].forEach.call(thumbs.children, function (b, k) { b.classList.toggle("active", k === cur); });
    }
    thumbs.innerHTML = items.length < 2 ? "" : items.map(function (it, i) {
      var bg = it.kind === "video" ? poster(it.url) : it.url;
      return '<button type="button" class="' + (i === 0 ? "active" : "") + '" data-i="' + i + '" style="' + (bg ? "background-image:url('" + esc(bg) + "')" : "background:#1c222b") + ';position:relative" aria-label="' + (it.kind === "video" ? "Play room video" : esc(opts.name || "Room") + " photo " + (i + 1)) + '">' +
        (it.kind === "video" ? '<span style="position:absolute;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.35);color:#fff;font-size:1.3rem">&#9654;</span>' : "") + "</button>";
    }).join("");
    thumbs.onclick = function (e) { var b = e.target.closest("button[data-i]"); if (b) show(Number(b.dataset.i)); };
    main.setAttribute("tabindex", "0");
    main.onkeydown = function (e) { if (e.key === "ArrowRight") show(cur + 1); if (e.key === "ArrowLeft") show(cur - 1); };
    show(0);
    return { show: show, count: items.length };
  }

  window.UyehMedia = { mp4: mp4, poster: poster, embed: embed, player: player, guard: guard, gallery: gallery };
})();
