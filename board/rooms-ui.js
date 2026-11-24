/* =============================================================================
   rooms-ui.js — Director-panel "Rooms & Room Types" workspace
   -----------------------------------------------------------------------------
   Loaded by board/director-panel.html AFTER the main inline <script>, so it can
   reuse the panel's own helpers (html``, adminApi, POST/PATCH/DEL, bqs, toast,
   openDrawer, runAction, confirmAction, fmtMoney, ...) and replace the two old
   page loaders:

       PAGE_LOADERS.rooms      -> workspace, "Rooms" tab
       PAGE_LOADERS.roomtypes  -> workspace, "Room types" tab

   Model it implements (matches the patched backend):
     • A ROOM TYPE is the sellable category: price, occupancy, photos, rate plans,
       overbooking allowance. Availability is counted at this level.
     • A ROOM is a physical unit that belongs to exactly one type. Once linked,
       the type owns price / currency / max occupancy (the form shows them
       read-only). A room with no type cannot be sold — the UI flags it and
       offers a one-click "link rooms" flow.
     • Only a Director creates, edits or deletes rooms and creates room types /
       adds units. Managers keep: room status, type details, rate plans, photos.

   Scope = the branch chosen in the top bar (director_active_branch). Managers are
   pinned to their own branch by the server.
   ============================================================================= */
(function () {
  "use strict";
  if (typeof PAGE_LOADERS === "undefined" || typeof adminApi === "undefined" || typeof html === "undefined") {
    console.error("rooms-ui.js must be loaded after the director-panel script.");
    return;
  }

  /* ---------------------------------------------------------------- API ---- */
  Object.assign(adminApi, {
    ruTypes: () => adminRequest(`/manager/room-types${bqs()}`),
    ruRooms: () => adminRequest(`/manager/rooms${bqs()}`),
    ruCreateRoom: (p) => POST("/director/rooms", p),
    ruUpdateRoom: (id, p) => PATCH(`/director/rooms/${id}`, p),
    ruDeleteRoom: (id) => DEL(`/director/rooms/${id}${bqs()}`),
    ruRoomStatus: (id, status) => adminRequest(`/manager/rooms/${id}/status${bqs()}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    ruAddUnits: (typeId, count) => POST(`/manager/room-types/${typeId}/units`, { count }),
    ruPlans: (typeId) => adminRequest(`/manager/room-types/${typeId}/rate-plans${bqs()}`),
    ruCreatePlan: (typeId, p) => POST(`/manager/room-types/${typeId}/rate-plans`, p),
    ruUpdatePlan: (typeId, planId, p) => PATCH(`/manager/room-types/${typeId}/rate-plans/${planId}`, p),
    ruDeletePlan: (typeId, planId) => DEL(`/manager/room-types/${typeId}/rate-plans/${planId}${bqs()}`),
  });

  /* -------------------------------------------------------------- styles ---- */
  if (!document.getElementById("ru-style")) {
    const st = document.createElement("style");
    st.id = "ru-style";
    st.textContent = `
    .ru-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px}
    .ru-card{background:var(--panel);border:1px solid var(--border);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
    .ru-card.is-off{opacity:.72}
    .ru-photo{height:150px;background:var(--ivory-deep);display:flex;align-items:center;justify-content:center;color:var(--text-faint);font-size:1.6rem;position:relative}
    .ru-photo img{width:100%;height:100%;object-fit:cover;display:block}
    .ru-photo .ru-flags{position:absolute;top:8px;left:8px;display:flex;gap:6px;flex-wrap:wrap}
    .ru-body{padding:14px 16px;display:flex;flex-direction:column;gap:8px;flex:1}
    .ru-title{font-weight:700;font-size:1.02rem;color:var(--ink)}
    .ru-meta{color:var(--text-muted);font-size:.82rem;display:flex;gap:10px;flex-wrap:wrap}
    .ru-price{font-weight:700;color:var(--ink)}
    .ru-price small{font-weight:500;color:var(--text-muted)}
    .ru-bar{display:flex;height:8px;border-radius:99px;overflow:hidden;background:var(--ivory-deep)}
    .ru-bar i{display:block;height:100%}
    .ru-bar .ok{background:var(--teal)} .ru-bar .warn{background:var(--brass)} .ru-bar .off{background:#b9b1a2}
    .ru-units{font-size:.8rem;color:var(--text-muted);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
    .ru-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:auto;padding-top:6px}
    .ru-banner{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;border:1px solid rgba(163,57,42,.35);background:rgba(163,57,42,.07);color:var(--ink);border-radius:10px;padding:12px 14px;margin-bottom:16px}
    .ru-banner b{color:var(--danger)}
    .ru-filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}
    .ru-filters input,.ru-filters select{min-width:150px}
    .ru-chip-unlinked{background:rgba(163,57,42,.12);color:var(--danger);border:0;border-radius:99px;padding:2px 9px;font-size:.72rem;font-weight:700;cursor:pointer}
    .ru-link{background:none;border:0;padding:0;color:var(--brass-dark);font-weight:600;cursor:pointer;font:inherit}
    .ru-link:hover{text-decoration:underline}
    .ru-help{font-size:.78rem;color:var(--text-muted);margin-top:4px;line-height:1.35}
    .ru-inherit{background:var(--ivory);border:1px dashed var(--border);border-radius:8px;padding:10px 12px;font-size:.85rem;color:var(--text-muted)}
    .ru-inherit b{color:var(--ink)}
    .ru-section{border-top:1px solid var(--border-soft);margin-top:16px;padding-top:14px}
    .ru-danger{border:1px solid rgba(163,57,42,.3);border-radius:10px;padding:12px 14px;margin-top:18px}
    .ru-tier-row{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end;margin-bottom:8px}
    .ru-plan-row td{vertical-align:top}
    .ru-sub{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .ru-sticky{position:sticky;bottom:-24px;background:var(--panel);padding:12px 0 4px;margin-top:16px;border-top:1px solid var(--border-soft);display:flex;gap:8px;z-index:2}
    .ru-select-sm{padding:4px 6px;font-size:.82rem;border-radius:6px;border:1px solid var(--border);background:var(--panel)}
    @media (max-width:700px){.ru-tier-row{grid-template-columns:1fr 1fr auto}}
    `;
    document.head.appendChild(st);
  }

  /* --------------------------------------------------------------- state ---- */
  const RU = (window.RU = {
    tab: "types",
    branchId: null,
    types: [],
    rooms: [],
    plans: {},            // typeId -> [ratePlan]
    filter: { q: "", type: "", status: "" },
    view: null,           // drawer view: {kind:'type'|'plan'|'room'|'link', ...}
    stack: [],
    tags: null,
    tiers: [],
  });

  const $ = (id) => document.getElementById(id);
  const val = (id) => { const e = $(id); return e ? String(e.value) : ""; };
  const numOrNull = (id) => { const v = val(id).trim(); return v === "" ? null : Number(v); };
  const checked = (id) => { const e = $(id); return !!(e && e.checked); };
  const csv = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
  const canCreate = () => isDirector();           // rooms + new types + units are Director-only
  const byId = (arr, id) => arr.find((x) => x.id === id) || null;
  const typeName = (id) => { const t = byId(RU.types, id); return t ? t.name : "—"; };
  const note = (msg, type) => showNotice("ruNotice", msg, type || "error");
  const pageNote = (msg, type) => showNotice("ruPageNotice", msg, type || "error");

  function unitsOf(typeId) {
    const rs = RU.rooms.filter((r) => r.roomTypeId === typeId);
    const active = rs.filter((r) => r.status === "ACTIVE");
    const blocked = active.filter((r) => r.housekeepingStatus === "OUT_OF_ORDER").length;   // mirrors typeAvailability()
    return {
      rooms: rs,
      total: rs.length,
      active: active.length,
      maintenance: rs.filter((r) => r.status === "MAINTENANCE").length,
      inactive: rs.filter((r) => r.status === "INACTIVE").length,
      blocked,
      sellable: Math.max(0, active.length - blocked),
    };
  }
  const unlinked = () => RU.rooms.filter((r) => !r.roomTypeId);

  /* ------------------------------------------------------------- loading ---- */
  async function fetchData() {
    const [t, r] = await Promise.all([adminApi.ruTypes(), adminApi.ruRooms()]);
    RU.types = (t.roomTypes || []).slice().sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.name).localeCompare(String(b.name)));
    RU.rooms = r.rooms || [];
  }

  RU.load = async function (tab) {
    if (tab) RU.tab = tab;
    CURRENT_PAGE = RU.tab === "rooms" ? "rooms" : "roomtypes";
    const bid = getActiveBranchId();
    if (!bid) {
      render(html`${pageHeader("Rooms & Room Types", "")}<div class="panel"><div class="empty-state">Pick a branch in the top bar first — rooms and room types are managed per branch.</div></div>`);
      return;
    }
    if (RU.branchId !== bid) { RU.branchId = bid; RU.filter = { q: "", type: "", status: "" }; RU.plans = {}; RU.tags = null; RU.view = null; }
    await fetchData();
    RU.renderPage();
  };

  RU.reload = async function () {
    try { await fetchData(); } catch (err) { toast(err.message, "error"); return; }
    if ($("ruRoot")) RU.renderPage();
    if (RU.view && drawerEl()) renderDrawer();
  };

  /* ---------------------------------------------------------------- page ---- */
  RU.renderPage = function () {
    const branch = getActiveBranch();
    const un = unlinked();
    const totalRooms = RU.rooms.length;
    const sellableNow = RU.types.filter((t) => t.isActive).reduce((n, t) => n + unitsOf(t.id).sellable, 0);
    const outOfService = RU.rooms.filter((r) => r.status !== "ACTIVE" || r.housekeepingStatus === "OUT_OF_ORDER").length;

    const actions = canCreate()
      ? html`<div class="ru-sub">
          <button class="btn btn-outline" onclick="RU.openRoom(null)" ${RU.types.length ? "" : "disabled"} title="${RU.types.length ? "" : "Create a room type first"}"><i class="fas fa-plus"></i> Add room</button>
          <button class="btn btn-primary" onclick="RU.openType(null)"><i class="fas fa-plus"></i> New room type</button>
        </div>`
      : "";

    render(html`
      <div id="ruRoot">
        ${pageHeader("Rooms & Room Types", branch ? `${branch.name} — what guests book (types) and the physical rooms behind them.` : "What guests book (types) and the physical rooms behind them.", actions)}
        <div id="ruPageNotice"></div>
        <div class="stats-grid">
          <div class="stat-card"><b>${RU.types.length}</b><span>Room types</span></div>
          <div class="stat-card"><b>${totalRooms}</b><span>Physical rooms</span></div>
          <div class="stat-card is-good"><b>${sellableNow}</b><span>Sellable right now</span></div>
          <div class="stat-card ${outOfService ? "is-warn" : ""}"><b>${outOfService}</b><span>Out of service</span></div>
          <div class="stat-card ${un.length ? "is-bad" : ""}"><b>${un.length}</b><span>Not linked to a type</span></div>
        </div>
        ${un.length ? html`
          <div class="ru-banner">
            <div><b>${un.length} room${un.length === 1 ? "" : "s"} not linked to a room type.</b>
              <span class="muted"> They are not counted in availability and cannot be sold online until they belong to a type.</span></div>
            ${canCreate() ? html`<button class="btn btn-primary btn-sm" onclick="RU.openLink()">Link rooms</button>` : html`<span class="faint">Ask a Director to link them.</span>`}
          </div>` : ""}
        <div class="tabs">
          <button class="tab-btn ${RU.tab === "types" ? "active" : ""}" onclick="RU.setTab('types')">Room types (${RU.types.length})</button>
          <button class="tab-btn ${RU.tab === "rooms" ? "active" : ""}" onclick="RU.setTab('rooms')">Rooms (${totalRooms})</button>
        </div>
        <div id="ruTabBody">${RU.tab === "types" ? typesTab() : roomsTab()}</div>
      </div>
    `);
    if (RU.tab === "rooms") RU.renderRoomsTable();
  };

  RU.setTab = function (tab) {
    RU.tab = tab;
    CURRENT_PAGE = tab === "rooms" ? "rooms" : "roomtypes";
    if (typeof setActiveNav === "function") setActiveNav(CURRENT_PAGE);
    RU.renderPage();
  };

  /* ---------------------------------------------------------- types tab ---- */
  function typesTab() {
    if (!RU.types.length) {
      return html`<div class="panel"><div class="empty-state">No room types at this branch yet.${canCreate() ? " Create the first one — it can create its rooms for you in the same step." : ""}</div></div>`;
    }
    return html`<div class="ru-grid">${html.join(RU.types.map(typeCard))}</div>`;
  }

  function typeCard(t) {
    const u = unitsOf(t.id);
    const pct = (n) => (u.total ? Math.round((n / u.total) * 100) : 0);
    const pOk = pct(u.sellable), pWarn = pct(u.blocked + u.maintenance), pOff = Math.max(0, 100 - pOk - pWarn);
    const over = Number(t.overbookingAllowance || 0);
    return html`
      <div class="ru-card ${t.isActive ? "" : "is-off"}">
        <div class="ru-photo">
          ${t.images && t.images[0] ? html`<img src="${t.images[0]}" alt="">` : html`<i class="fa-solid fa-camera"></i>`}
          <div class="ru-flags">
            ${t.isFeatured ? html`<span class="badge badge-active"><i class="fas fa-star"></i> Signature</span>` : ""}
            ${t.isActive ? "" : html`<span class="badge badge-inactive">Inactive</span>`}
          </div>
        </div>
        <div class="ru-body">
          <div class="ru-title">${t.name}</div>
          <div class="ru-meta">
            <span><i class="fas fa-user"></i> ${t.maxAdults} adult${t.maxAdults === 1 ? "" : "s"}${t.maxChildren ? ` + ${t.maxChildren} child${t.maxChildren === 1 ? "" : "ren"}` : ""}</span>
            ${t.bedConfiguration ? html`<span><i class="fas fa-bed"></i> ${t.bedConfiguration}</span>` : ""}
            ${t.sizeSqm ? html`<span>${t.sizeSqm} m²</span>` : ""}
          </div>
          <div class="ru-price">${fmtMoney(t.basePrice, t.currency)} <small>/ night</small></div>
          ${u.total ? html`
            <div class="ru-bar" title="Sellable / blocked or in maintenance / inactive"><i class="ok" style="width:${pOk}%"></i><i class="warn" style="width:${pWarn}%"></i><i class="off" style="width:${pOff}%"></i></div>
            <div class="ru-units"><span><b>${u.total}</b> room${u.total === 1 ? "" : "s"} · <b>${u.sellable}</b> sellable</span>
              <span>${u.maintenance + u.blocked ? `${u.maintenance + u.blocked} blocked` : ""}${u.inactive ? `${u.maintenance + u.blocked ? " · " : ""}${u.inactive} inactive` : ""}</span></div>
          ` : html`<div class="ru-units" style="color:var(--danger)"><span>No rooms yet — this type cannot be sold.</span></div>`}
          ${over > 0 ? html`<div class="ru-units"><span class="badge badge-warning">Overbooking +${over}</span></div>` : ""}
          <div class="ru-actions">
            <button class="btn btn-sm btn-primary" onclick="RU.openType('${t.id}')">Manage</button>
            <button class="btn btn-sm btn-outline" onclick="RU.openType('${t.id}','plans')">Rate plans</button>
            ${canCreate() ? html`<button class="btn btn-sm btn-outline" onclick="RU.openType('${t.id}','units')">+ Rooms</button>` : ""}
          </div>
        </div>
      </div>`;
  }

  /* ---------------------------------------------------------- rooms tab ---- */
  function roomsTab() {
    return html`
      <div class="panel flush">
        <div style="padding:14px 16px 0;">
          <div class="ru-filters">
            <input type="search" id="ruQ" placeholder="Search room number or name" value="${RU.filter.q}" oninput="RU.filter.q=this.value;RU.renderRoomsTable()">
            <select id="ruFType" onchange="RU.filter.type=this.value;RU.renderRoomsTable()">
              <option value="">All types</option>
              <option value="__none" ${RU.filter.type === "__none" ? "selected" : ""}>Not linked to a type</option>
              ${html.join(RU.types.map((t) => html`<option value="${t.id}" ${RU.filter.type === t.id ? "selected" : ""}>${t.name}</option>`))}
            </select>
            <select id="ruFStatus" onchange="RU.filter.status=this.value;RU.renderRoomsTable()">
              <option value="">Any status</option>
              ${html.join(["ACTIVE", "MAINTENANCE", "INACTIVE"].map((s) => html`<option value="${s}" ${RU.filter.status === s ? "selected" : ""}>${s.charAt(0) + s.slice(1).toLowerCase()}</option>`))}
            </select>
            <span class="faint" id="ruCount" style="align-self:center;"></span>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th></th><th>Room</th><th>Type</th><th>Floor</th><th>Price</th><th>Status</th><th>Housekeeping</th><th></th></tr></thead>
            <tbody id="ruRoomsBody"></tbody>
          </table>
        </div>
      </div>`;
  }

  RU.renderRoomsTable = function () {
    const body = $("ruRoomsBody");
    if (!body) return;
    const q = RU.filter.q.trim().toLowerCase();
    const rows = RU.rooms.filter((r) => {
      if (q && !(String(r.roomNumber).toLowerCase().includes(q) || String(r.name || "").toLowerCase().includes(q))) return false;
      if (RU.filter.type === "__none" && r.roomTypeId) return false;
      if (RU.filter.type && RU.filter.type !== "__none" && r.roomTypeId !== RU.filter.type) return false;
      if (RU.filter.status && r.status !== RU.filter.status) return false;
      return true;
    });
    const cnt = $("ruCount"); if (cnt) cnt.textContent = `${rows.length} of ${RU.rooms.length}`;
    if (!rows.length) {
      body.innerHTML = html`<tr><td colspan="8" class="empty-state">${RU.rooms.length ? "No rooms match these filters." : "No rooms at this branch yet."}</td></tr>`;
      return;
    }
    body.innerHTML = html.join(rows.map((r) => html`
      <tr>
        <td>${r.images && r.images[0] ? html`<img src="${r.images[0]}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:6px;">` : html`<span class="offering-photo-placeholder"><i class="fa-solid fa-camera"></i></span>`}</td>
        <td><b>${r.roomNumber}</b>${r.name && (!r.roomType || r.name !== r.roomType.name) ? html`<div class="faint" style="font-size:.78rem;">${r.name}</div>` : ""}</td>
        <td>${r.roomTypeId
          ? html`<button class="ru-link" onclick="RU.openType('${r.roomTypeId}')">${r.roomType ? r.roomType.name : typeName(r.roomTypeId)}</button>`
          : html`<button class="ru-chip-unlinked" onclick="${canCreate() ? `RU.openRoom('${r.id}')` : ""}" title="Not counted in availability">Not linked</button>`}</td>
        <td>${r.floor || "—"}</td>
        <td>${fmtMoney(r.basePrice, r.currency)}</td>
        <td>
          <select class="ru-select-sm" onchange="RU.setRoomStatus('${r.id}', this.value)" aria-label="Status">
            ${html.join(["ACTIVE", "MAINTENANCE", "INACTIVE"].map((s) => html`<option value="${s}" ${r.status === s ? "selected" : ""}>${s.charAt(0) + s.slice(1).toLowerCase()}</option>`))}
          </select>
        </td>
        <td><span class="badge badge-${String(r.housekeepingStatus || "CLEAN").toLowerCase()}">${String(r.housekeepingStatus || "CLEAN").replace(/_/g, " ")}</span></td>
        <td style="white-space:nowrap;">
          ${canCreate() ? html`
            <button class="btn btn-sm btn-outline" onclick="RU.openRoom('${r.id}')">Edit</button>
            <button class="btn btn-sm btn-outline" onclick="RU.deleteRoom('${r.id}')">Delete</button>` : ""}
        </td>
      </tr>`));
  };

  RU.setRoomStatus = async function (id, status) {
    try {
      await adminApi.ruRoomStatus(id, status);
      toast("Room status updated");
    } catch (err) {
      toast(err.message, "error");
    }
    RU.reload();
  };

  RU.deleteRoom = function (id) {
    const r = byId(RU.rooms, id);
    if (!r) return;
    confirmAction(`Delete room ${r.roomNumber}? This can't be undone.`, async () => {
      const res = await runAction(null, () => adminApi.ruDeleteRoom(id), "Room deleted");
      if (res) { RU.view = null; await RU.reload(); }
    }, { confirmLabel: "Delete room" });
  };

  /* -------------------------------------------------------------- drawer ---- */
  const drawerEl = () => document.querySelector("#modalMount .drawer");
  function showDrawer(body) {
    const el = drawerEl();
    if (el) { el.innerHTML = body; return; }
    openDrawer(body, { wide: true });
  }
  function renderDrawer() {
    const v = RU.view;
    if (!v) return;
    if (v.kind === "type") return showDrawer(typeView(v));
    if (v.kind === "plan") return showDrawer(planView(v));
    if (v.kind === "room") return showDrawer(roomView(v));
    if (v.kind === "link") return showDrawer(linkView());
  }
  RU.openView = function (v) { RU.view = v; RU.stack = []; closeModal(); renderDrawer(); };
  RU.go = function (v) { RU.stack.push(RU.view); RU.view = v; renderDrawer(); };
  RU.back = function () {
    const prev = RU.stack.pop();
    if (!prev) { RU.view = null; closeModal(); return; }
    RU.view = prev; renderDrawer();
  };
  const head = (title, sub, withBack) => html`
    <div class="drawer-head">
      <div>${withBack ? html`<button class="ru-link" onclick="RU.back()">← Back</button>` : ""}<h3 style="margin:4px 0 0;">${title}</h3>${sub ? html`<p class="muted" style="margin:2px 0 0;font-size:.85rem;">${sub}</p>` : ""}</div>
      <button class="btn btn-sm btn-outline" onclick="closeModal()">Close</button>
    </div>
    <div id="ruNotice"></div>`;

  /* ---------------------------------------------------------- type view ---- */
  RU.openType = function (id, tab) {
    if (!id && !canCreate()) return toast("Only a Director can create room types.", "error");
    RU.openView({ kind: "type", id: id || null, tab: id ? tab || "details" : "details" });
    if (id && (tab === "plans")) loadPlans(id);
  };
  RU.typeTab = function (tab) {
    RU.view.tab = tab;
    renderDrawer();
    if (tab === "plans" && RU.view.id) loadPlans(RU.view.id);
  };

  function typeView(v) {
    const t = v.id ? byId(RU.types, v.id) : null;
    if (v.id && !t) return html`${head("Room type", "", false)}<div class="empty-state">This room type no longer exists.</div>`;
    if (!t) return html`${head("New room type", "Creates the type and, optionally, its first rooms.", false)}${typeDetailsForm(null)}`;
    const u = unitsOf(t.id);
    const tabs = [["details", "Details"], ["units", `Rooms (${u.total})`], ["photos", "Photos & video"], ["plans", "Rate plans"]];
    return html`
      ${head(t.name, `${fmtMoney(t.basePrice, t.currency)} / night · ${u.total} room${u.total === 1 ? "" : "s"} · ${u.sellable} sellable`, false)}
      <div class="tabs">${html.join(tabs.map(([k, label]) => html`<button class="tab-btn ${v.tab === k ? "active" : ""}" onclick="RU.typeTab('${k}')">${label}</button>`))}</div>
      ${v.tab === "details" ? typeDetailsForm(t) : v.tab === "units" ? typeUnits(t, u) : v.tab === "photos" ? typePhotos(t) : typePlans(t)}`;
  }

  function typeDetailsForm(t) {
    const u = t ? unitsOf(t.id) : null;
    return html`
      <div class="form-row">
        <div class="form-field"><label>Name</label><input type="text" id="rtName" value="${t ? t.name : ""}" maxlength="80"></div>
        <div class="form-field"><label>Base price / night</label><input type="number" id="rtPrice" min="0" step="0.01" value="${t ? t.basePrice : ""}"></div>
        <div class="form-field"><label>Currency</label>
          <input type="text" id="rtCurrency" maxlength="3" style="text-transform:uppercase;" value="${t ? t.currency : ""}" placeholder="${(getActiveBranch() && getActiveBranch().currency) || "branch default"}" ${t ? "disabled" : ""}>
        </div>
      </div>
      ${t && u.total ? html`<div class="ru-help" style="margin:-6px 0 12px;">Changing the price updates all ${u.total} room${u.total === 1 ? "" : "s"} of this type and queues a rate push to connected channels.</div>` : ""}
      <div class="form-field"><label>Description</label><textarea id="rtDescription" rows="3">${t ? t.description || "" : ""}</textarea></div>
      <div class="form-row">
        <div class="form-field"><label>Max adults</label><input type="number" id="rtAdults" min="1" value="${t ? t.maxAdults : 2}"></div>
        <div class="form-field"><label>Max children</label><input type="number" id="rtChildren" min="0" value="${t ? t.maxChildren : 0}"></div>
        <div class="form-field"><label>Max guests (total)</label><input type="number" id="rtMaxOcc" min="1" value="${t ? t.maxOccupancy : 2}"></div>
        <div class="form-field"><label>Standard occupancy</label><input type="number" id="rtStdOcc" min="1" value="${t ? t.standardOccupancy : 2}"></div>
      </div>
      <div class="ru-help" style="margin:-6px 0 12px;">Extra-person pricing (set per rate plan) starts above the standard occupancy.</div>
      <div class="form-row">
        <div class="form-field"><label>Bed configuration</label><input type="text" id="rtBed" placeholder="1 King, 2 Twin…" value="${t ? t.bedConfiguration || "" : ""}"></div>
        <div class="form-field"><label>Size (m²)</label><input type="number" id="rtSize" min="0" value="${t && t.sizeSqm ? t.sizeSqm : ""}"></div>
        <div class="form-field"><label>Display order</label><input type="number" id="rtSort" step="1" value="${t ? t.sortOrder || 0 : 0}"></div>
      </div>
      <div class="form-field"><label>Amenities <span class="faint">(comma-separated)</span></label><input type="text" id="rtAmenities" value="${t ? (t.amenities || []).join(", ") : ""}" placeholder="Wi-Fi, mini bar, ocean view"></div>
      <div class="form-field"><label>Overbooking allowance</label>
        <input type="number" id="rtOver" min="0" max="20" step="1" value="${t ? t.overbookingAllowance || 0 : 0}" style="max-width:140px;">
        <div class="ru-help">How many rooms of this type may be sold beyond the physical count. Keep at <b>0</b> (never oversell) unless this branch has real no-show data to justify more.</div>
      </div>
      ${t ? "" : html`
        <div class="form-field"><label>Rooms to create now</label>
          <input type="number" id="rtUnits" min="1" max="100" step="1" value="1" style="max-width:140px;">
          <div class="ru-help">Numbered automatically from the type name (e.g. DELUXE-KING-01, -02 …). You can rename them or add more later.</div>
        </div>`}
      <div class="checkbox-item"><input type="checkbox" id="rtFeatured" ${t && t.isFeatured ? "checked" : ""}><label for="rtFeatured">Signature room — featured first on the public site</label></div>
      ${t ? html`<div class="checkbox-item" style="margin-top:6px;"><input type="checkbox" id="rtActive" ${t.isActive ? "checked" : ""}><label for="rtActive">Active — sellable and visible on the booking site</label></div>` : ""}
      <div class="ru-sticky">
        <button class="btn btn-primary" id="rtSaveBtn" onclick="RU.saveType(this)">${t ? "Save changes" : "Create room type"}</button>
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      </div>
      ${t && isDirector() ? html`
        <div class="ru-danger">
          <b>Delete this room type</b>
          <div class="ru-help">Only possible when it has no rooms, no bookings and no channel mapping. To stop selling it but keep history, untick “Active” above instead.</div>
          <button class="btn btn-sm btn-danger" style="margin-top:8px;" onclick="RU.deleteType('${t.id}')">Delete room type</button>
        </div>` : ""}`;
  }

  function collectType(existing) {
    const p = {
      name: val("rtName").trim(),
      basePrice: numOrNull("rtPrice"),
      description: val("rtDescription").trim() || null,
      maxAdults: numOrNull("rtAdults"),
      maxChildren: numOrNull("rtChildren") ?? 0,
      maxOccupancy: numOrNull("rtMaxOcc"),
      standardOccupancy: numOrNull("rtStdOcc"),
      bedConfiguration: val("rtBed").trim() || null,
      sizeSqm: numOrNull("rtSize"),
      sortOrder: numOrNull("rtSort") ?? 0,
      amenities: csv(val("rtAmenities")),
      overbookingAllowance: numOrNull("rtOver") ?? 0,
      isFeatured: checked("rtFeatured"),
    };
    if (existing) p.isActive = checked("rtActive");
    else {
      const cur = val("rtCurrency").trim().toUpperCase();
      if (cur) p.currency = cur;
      p.unitCount = numOrNull("rtUnits") ?? 1;
    }
    return p;
  }

  function validateType(p, existing) {
    if (!p.name) return "Give the room type a name.";
    if (p.basePrice === null || !Number.isFinite(p.basePrice) || p.basePrice < 0) return "Enter a base price of 0 or more.";
    if (!Number.isInteger(p.maxAdults) || p.maxAdults < 1) return "Max adults must be at least 1.";
    if (!Number.isInteger(p.maxChildren) || p.maxChildren < 0) return "Max children cannot be negative.";
    if (!Number.isInteger(p.maxOccupancy) || p.maxOccupancy < 1) return "Max guests must be at least 1.";
    if (p.maxAdults > p.maxOccupancy) return "Max adults cannot exceed max guests.";
    if (!Number.isInteger(p.standardOccupancy) || p.standardOccupancy < 1 || p.standardOccupancy > p.maxOccupancy) return "Standard occupancy must be between 1 and max guests.";
    if (p.sizeSqm !== null && (!Number.isFinite(p.sizeSqm) || p.sizeSqm < 0)) return "Size must be a positive number.";
    if (!Number.isInteger(p.sortOrder)) return "Display order must be a whole number.";
    if (!Number.isInteger(p.overbookingAllowance) || p.overbookingAllowance < 0 || p.overbookingAllowance > 20) return "Overbooking allowance must be a whole number from 0 to 20.";
    if (p.currency && !/^[A-Z]{3}$/.test(p.currency)) return "Currency must be a 3-letter code such as NGN or USD.";
    if (!existing && (!Number.isInteger(p.unitCount) || p.unitCount < 1 || p.unitCount > 100)) return "Rooms to create must be between 1 and 100.";
    return null;
  }

  RU.saveType = async function (btn) {
    const t = RU.view && RU.view.id ? byId(RU.types, RU.view.id) : null;
    const p = collectType(t);
    const bad = validateType(p, t);
    if (bad) return note(bad);
    const res = await runAction(btn, () => (t ? adminApi.updateRoomType(t.id, p) : adminApi.createRoomType(p)), t ? "Room type saved" : "Room type created");
    if (!res) return;
    await fetchData();
    if (!t && res.roomType) RU.view = { kind: "type", id: res.roomType.id, tab: "units" };
    if ($("ruRoot")) RU.renderPage();
    renderDrawer();
  };

  RU.deleteType = function (id) {
    const t = byId(RU.types, id);
    if (!t) return;
    confirmAction(`Delete room type “${t.name}”? This can't be undone.`, async () => {
      const res = await runAction(null, () => adminApi.deleteRoomType(id), "Room type deleted");
      if (res) { RU.view = null; await RU.reload(); }
      else RU.openType(id);   // the server said no (rooms/bookings/mapping) — put the drawer back
    }, { confirmLabel: "Delete room type" });
  };

  /* --------------------------------------------------------- units tab ---- */
  function typeUnits(t, u) {
    const cap = u.sellable + Number(t.overbookingAllowance || 0);
    return html`
      <div class="stats-grid" style="margin-bottom:14px;">
        <div class="stat-card"><b>${u.total}</b><span>Physical rooms</span></div>
        <div class="stat-card is-good"><b>${u.sellable}</b><span>Sellable now</span></div>
        <div class="stat-card ${u.maintenance + u.blocked ? "is-warn" : ""}"><b>${u.maintenance + u.blocked}</b><span>Blocked</span></div>
        <div class="stat-card"><b>${cap}</b><span>Max sold per night</span></div>
      </div>
      ${canCreate() ? html`
        <div class="ru-inherit" style="margin-bottom:14px;">
          <div class="ru-sub">
            <b>Add rooms</b>
            <input type="number" id="ruAddCount" min="1" max="50" value="1" style="width:80px;">
            <button class="btn btn-sm btn-primary" id="ruAddBtn" onclick="RU.addUnits('${t.id}', this)">Create numbered rooms</button>
            <span class="faint">or</span>
            <button class="btn btn-sm btn-outline" onclick="RU.go({kind:'room', id:null, typeId:'${t.id}'})">Add one with my own number</button>
          </div>
        </div>` : ""}
      ${u.total ? html`
        <table>
          <thead><tr><th>Room</th><th>Floor</th><th>Status</th><th>Housekeeping</th><th></th></tr></thead>
          <tbody>${html.join(u.rooms.map((r) => html`
            <tr>
              <td><b>${r.roomNumber}</b></td>
              <td>${r.floor || "—"}</td>
              <td><select class="ru-select-sm" onchange="RU.setRoomStatus('${r.id}', this.value)">${html.join(["ACTIVE", "MAINTENANCE", "INACTIVE"].map((s) => html`<option value="${s}" ${r.status === s ? "selected" : ""}>${s.charAt(0) + s.slice(1).toLowerCase()}</option>`))}</select></td>
              <td><span class="badge badge-${String(r.housekeepingStatus || "CLEAN").toLowerCase()}">${String(r.housekeepingStatus || "CLEAN").replace(/_/g, " ")}</span></td>
              <td style="white-space:nowrap;">${canCreate() ? html`
                <button class="btn btn-sm btn-outline" onclick="RU.go({kind:'room', id:'${r.id}'})">Edit</button>
                <button class="btn btn-sm btn-outline" onclick="RU.deleteRoom('${r.id}')">Delete</button>` : ""}</td>
            </tr>`))}</tbody>
        </table>` : html`<div class="empty-state">No rooms of this type yet. ${canCreate() ? "Add some above — a type with no rooms cannot be sold." : "Ask a Director to add rooms."}</div>`}`;
  }

  RU.addUnits = async function (typeId, btn) {
    const n = Number(val("ruAddCount"));
    if (!Number.isInteger(n) || n < 1 || n > 50) return note("Enter a whole number from 1 to 50.");
    const res = await runAction(btn, () => adminApi.ruAddUnits(typeId, n), `${n} room${n === 1 ? "" : "s"} added`);
    if (res) { await fetchData(); if ($("ruRoot")) RU.renderPage(); renderDrawer(); }
  };

  /* -------------------------------------------------------- photos tab ---- */
  function typePhotos(t) {
    return html`
      <div class="form-field">
        <label>Photos <span class="faint">(the first one is the cover)</span></label>
        <div class="rt-media-grid">
          ${html.join((t.images || []).map((url) => html`
            <div class="rt-media-thumb"><img src="${url}" alt="">
              <button type="button" class="rt-media-remove" onclick="RU.removeImage('${t.id}', '${url}')" title="Remove photo">&times;</button></div>`))}
          <label class="rt-media-add"><input type="file" accept="image/*" style="display:none;" onchange="RU.addImage('${t.id}', this)"><i class="fa-solid fa-plus"></i><span>Add photo</span></label>
        </div>
      </div>
      <div class="form-field">
        <label>Walkthrough video <span class="faint">(optional)</span></label>
        ${t.videoUrl ? html`<video src="${t.videoUrl}" controls class="rt-media-video"></video>` : html`<div class="faint">No video yet.</div>`}
        ${isDirector() ? html`
          <div class="ru-sub" style="margin-top:8px;">
            <input type="file" accept="video/*" onchange="RU.addVideo('${t.id}', this)">
            ${t.videoUrl ? html`<button class="btn btn-sm btn-outline" onclick="RU.removeVideo('${t.id}')">Remove video</button>` : ""}
          </div>
          <div class="ru-help">Uploading a new video replaces the current one.</div>` : html`<div class="ru-help">Only a Director can change the video.</div>`}
      </div>`;
  }
  async function mediaOp(fn, okMsg) {
    try {
      const { roomType } = await fn();
      const i = RU.types.findIndex((x) => x.id === roomType.id);
      if (i >= 0) RU.types[i] = { ...RU.types[i], ...roomType };
      if (okMsg) toast(okMsg);
      if ($("ruRoot")) RU.renderPage();
      renderDrawer();
    } catch (err) { toast(err.message, "error"); }
  }
  RU.addImage = (id, el) => { const f = el.files[0]; if (f) mediaOp(() => adminApi.uploadRoomTypeImage(id, f), "Photo added"); };
  RU.removeImage = (id, url) => mediaOp(() => adminApi.deleteRoomTypeImage(id, url), "Photo removed");
  RU.addVideo = (id, el) => { const f = el.files[0]; if (f) mediaOp(() => adminApi.uploadRoomTypeVideo(id, f), "Video uploaded"); };
  RU.removeVideo = (id) => mediaOp(() => adminApi.deleteRoomTypeVideo(id), "Video removed");

  /* --------------------------------------------------------- plans tab ---- */
  async function loadPlans(typeId) {
    try {
      const { ratePlans } = await adminApi.ruPlans(typeId);
      RU.plans[typeId] = ratePlans || [];
    } catch (err) {
      RU.plans[typeId] = null;
      toast(err.message, "error");
    }
    if (RU.view && RU.view.kind === "type" && RU.view.id === typeId && RU.view.tab === "plans") renderDrawer();
  }

  const adjText = (p, cur) => {
    const parts = [];
    const pc = p.adjustmentPercent == null ? 0 : Number(p.adjustmentPercent);
    const fx = p.adjustmentFixed == null ? 0 : Number(p.adjustmentFixed);
    if (pc) parts.push(`${pc > 0 ? "+" : "−"}${Math.abs(pc)}%`);
    if (fx) parts.push(`${fx > 0 ? "+" : "−"}${fmtMoney(Math.abs(fx), cur)}`);
    return parts.length ? parts.join(", then ") : "Rack rate";
  };
  const planPrice = (base, p) => {
    let x = Number(base) || 0;
    if (p.adjustmentPercent != null && p.adjustmentPercent !== "") x *= 1 + Number(p.adjustmentPercent) / 100;
    if (p.adjustmentFixed != null && p.adjustmentFixed !== "") x += Number(p.adjustmentFixed);
    return Math.max(0, Math.round(x * 100) / 100);
  };
  const termsText = (p) => {
    const cancel = p.refundable === false ? "Non-refundable" : `Free cancellation ${p.freeCancellationHours}h before`;
    const pay = p.prepaymentRequired ? "Prepay in full" : Number(p.depositPercent) > 0 ? `${p.depositPercent}% deposit` : "Pay on arrival";
    return `${cancel} · ${pay}`;
  };
  const KIND_LABEL = { ROOM_ONLY: "Room only", BED_AND_BREAKFAST: "Bed & breakfast", HALF_BOARD: "Half board", FULL_BOARD: "Full board", ALL_INCLUSIVE: "All inclusive" };
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function typePlans(t) {
    const plans = RU.plans[t.id];
    if (plans === undefined) return html`<div class="loading-state">Loading rate plans…</div>`;
    if (plans === null) return html`<div class="notice error">Couldn't load rate plans.</div><button class="btn btn-outline" onclick="RU.typeTab('plans')">Retry</button>`;
    return html`
      <div class="ru-sub" style="justify-content:space-between;margin-bottom:12px;">
        <div class="ru-help" style="max-width:560px;margin:0;">A rate plan is a sellable product on top of this room type — price adjustment, meal plan and cancellation terms. The <b>default</b> plan is what guests get when they don't pick one. Exactly one plan is the default.</div>
        <button class="btn btn-primary btn-sm" onclick="RU.go({kind:'plan', typeId:'${t.id}', planId:null})"><i class="fas fa-plus"></i> New rate plan</button>
      </div>
      ${plans.length ? html`
        <div class="table-wrap"><table>
          <thead><tr><th>Plan</th><th>Price</th><th>Terms</th><th>Stay</th><th></th></tr></thead>
          <tbody>${html.join(plans.map((p) => html`
            <tr class="ru-plan-row">
              <td><b>${p.name}</b> <span class="mono faint">${p.code}</span>
                <div class="ru-sub" style="margin-top:4px;">
                  ${p.isDefault ? html`<span class="badge badge-active">Default</span>` : ""}
                  ${p.isActive ? "" : html`<span class="badge badge-inactive">Inactive</span>`}
                  <span class="faint" style="font-size:.78rem;">${KIND_LABEL[p.kind] || p.kind}</span>
                </div></td>
              <td>${fmtMoney(planPrice(t.basePrice, p), t.currency)}<div class="faint" style="font-size:.78rem;">${adjText(p, t.currency)}</div></td>
              <td style="font-size:.85rem;">${termsText(p)}</td>
              <td style="font-size:.85rem;">${p.minNights > 1 ? `Min ${p.minNights} nights` : "1+ night"}${p.maxNights ? `, max ${p.maxNights}` : ""}</td>
              <td style="white-space:nowrap;">
                <button class="btn btn-sm btn-outline" onclick="RU.go({kind:'plan', typeId:'${t.id}', planId:'${p.id}'})">Edit</button>
                ${p.isDefault ? "" : html`<button class="btn btn-sm btn-outline" onclick="RU.makeDefault('${t.id}','${p.id}')">Make default</button>`}
                <button class="btn btn-sm btn-outline" onclick="RU.deletePlan('${t.id}','${p.id}')">Delete</button>
              </td>
            </tr>`))}</tbody>
        </table></div>` : html`<div class="empty-state">No rate plans yet — guests are charged the rack rate. Add a plan (for example “Bed &amp; breakfast” or “Non-refundable −10%”).</div>`}`;
  }

  RU.makeDefault = async function (typeId, planId) {
    const res = await runAction(null, () => adminApi.ruUpdatePlan(typeId, planId, { isDefault: true }), "Default plan changed");
    if (res) loadPlans(typeId);
  };
  RU.deletePlan = function (typeId, planId) {
    const p = (RU.plans[typeId] || []).find((x) => x.id === planId);
    if (!p) return;
    confirmAction(`Delete rate plan “${p.name}”?`, async () => {
      const res = await runAction(null, () => adminApi.ruDeletePlan(typeId, planId), "Rate plan deleted");
      RU.openType(typeId, "plans");     // closeModal() ran inside confirmAction — bring the drawer back either way
      if (res) loadPlans(typeId);
    }, { confirmLabel: "Delete plan" });
  };

  /* --------------------------------------------------------- plan view ---- */
  function planView(v) {
    const t = byId(RU.types, v.typeId);
    const p = v.planId ? (RU.plans[v.typeId] || []).find((x) => x.id === v.planId) : null;
    if (!t || (v.planId && !p)) return html`${head("Rate plan", "", true)}<div class="empty-state">This plan no longer exists.</div>`;
    RU.tiers = p && Array.isArray(p.cancellationTiers) ? p.cancellationTiers.map((x) => ({ ...x })) : [];
    const d = p || { kind: "ROOM_ONLY", refundable: true, freeCancellationHours: 48, depositPercent: 0, prepaymentRequired: false, minNights: 1, advanceBookingMinDays: 0, isActive: true, isDefault: !(RU.plans[v.typeId] || []).length, closedToArrival: [], closedToDeparture: [] };
    const mode = d.adjustmentFixed != null && Number(d.adjustmentFixed) !== 0 ? "fixed" : d.adjustmentPercent != null && Number(d.adjustmentPercent) !== 0 ? "percent" : "none";
    const adjVal = mode === "fixed" ? d.adjustmentFixed : mode === "percent" ? d.adjustmentPercent : "";
    return html`
      ${head(p ? `Edit plan — ${p.name}` : "New rate plan", `${t.name} · rack rate ${fmtMoney(t.basePrice, t.currency)}`, true)}
      <div class="form-row">
        <div class="form-field"><label>Plan name</label><input type="text" id="rpName" maxlength="80" value="${p ? p.name : ""}" placeholder="Non-refundable B&B"></div>
        <div class="form-field"><label>Code</label><input type="text" id="rpCode" maxlength="20" style="text-transform:uppercase;" value="${p ? p.code : ""}" placeholder="NR-BB"><div class="ru-help">Shown on invoices and used for channel mapping.</div></div>
      </div>
      <div class="form-row">
        <div class="form-field"><label>Meal plan</label>
          <select id="rpKind">${html.join(Object.entries(KIND_LABEL).map(([k, l]) => html`<option value="${k}" ${d.kind === k ? "selected" : ""}>${l}</option>`))}</select></div>
        <div class="form-field"><label>Price adjustment</label>
          <div class="ru-sub">
            <select id="rpMode" onchange="RU.planPreview()" style="max-width:150px;">
              <option value="none" ${mode === "none" ? "selected" : ""}>None (rack rate)</option>
              <option value="percent" ${mode === "percent" ? "selected" : ""}>Percentage</option>
              <option value="fixed" ${mode === "fixed" ? "selected" : ""}>Fixed amount</option>
            </select>
            <input type="number" id="rpAdj" step="0.01" value="${adjVal}" oninput="RU.planPreview()" style="max-width:120px;" placeholder="-10">
          </div>
          <div class="ru-help" id="rpPreview"></div>
        </div>
      </div>
      <div class="form-field"><label>Description <span class="faint">(optional)</span></label><input type="text" id="rpDesc" maxlength="500" value="${p ? p.description || "" : ""}"></div>

      <div class="ru-section"><b>Payment &amp; cancellation</b>
        <div class="checkbox-item" style="margin:8px 0;"><input type="checkbox" id="rpRefundable" ${d.refundable ? "checked" : ""} onchange="RU.planPreview()"><label for="rpRefundable">Refundable</label></div>
        <div class="form-row">
          <div class="form-field"><label>Free cancellation (hours before arrival)</label><input type="number" id="rpFree" min="0" step="1" value="${d.freeCancellationHours}"></div>
          <div class="form-field"><label>Deposit %</label><input type="number" id="rpDeposit" min="0" max="100" step="1" value="${d.depositPercent}"></div>
        </div>
        <div class="checkbox-item" style="margin-bottom:10px;"><input type="checkbox" id="rpPrepay" ${d.prepaymentRequired ? "checked" : ""}><label for="rpPrepay">Prepayment required in full</label></div>
        <label style="font-weight:600;font-size:.85rem;">Cancellation penalty tiers <span class="faint" style="font-weight:400;">(optional — most generous first)</span></label>
        <div id="rpTiers" style="margin-top:6px;">${tiersHtml()}</div>
        <button type="button" class="btn btn-sm btn-outline" onclick="RU.addTier()">+ Add tier</button>
      </div>

      <div class="ru-section"><b>Stay rules</b>
        <div class="form-row" style="margin-top:8px;">
          <div class="form-field"><label>Min nights</label><input type="number" id="rpMin" min="1" step="1" value="${d.minNights}"></div>
          <div class="form-field"><label>Max nights</label><input type="number" id="rpMax" min="1" step="1" value="${d.maxNights == null ? "" : d.maxNights}" placeholder="no limit"></div>
          <div class="form-field"><label>Book at least … days ahead</label><input type="number" id="rpAdvMin" min="0" step="1" value="${d.advanceBookingMinDays}"></div>
          <div class="form-field"><label>Book at most … days ahead</label><input type="number" id="rpAdvMax" min="0" step="1" value="${d.advanceBookingMaxDays == null ? "" : d.advanceBookingMaxDays}" placeholder="no limit"></div>
        </div>
        <div class="form-field"><label>Closed to arrival on</label><div class="chip-row" style="margin-bottom:0;">${dayChips("cta", d.closedToArrival)}</div></div>
        <div class="form-field"><label>Closed to departure on</label><div class="chip-row" style="margin-bottom:0;">${dayChips("ctd", d.closedToDeparture)}</div></div>
      </div>

      <div class="ru-section"><b>Extra guests</b> <span class="faint">(per night, above the standard occupancy of ${t.standardOccupancy})</span>
        <div class="form-row" style="margin-top:8px;">
          <div class="form-field"><label>Extra adult</label><input type="number" id="rpXAdult" min="0" step="0.01" value="${d.extraAdultPrice == null ? "" : d.extraAdultPrice}"></div>
          <div class="form-field"><label>Extra child</label><input type="number" id="rpXChild" min="0" step="0.01" value="${d.extraChildPrice == null ? "" : d.extraChildPrice}"></div>
        </div>
      </div>

      <div class="ru-section">
        <div class="checkbox-item"><input type="checkbox" id="rpActive" ${d.isActive ? "checked" : ""} ${p && p.isDefault ? "disabled" : ""}><label for="rpActive">Active — available to guests</label></div>
        <div class="checkbox-item" style="margin-top:6px;"><input type="checkbox" id="rpDefault" ${d.isDefault ? "checked" : ""} ${p && p.isDefault ? "disabled" : ""}><label for="rpDefault">Default plan for this room type ${p && p.isDefault ? "(make another plan the default to change this)" : ""}</label></div>
      </div>
      <div class="ru-sticky">
        <button class="btn btn-primary" id="rpSaveBtn" onclick="RU.savePlan(this)">${p ? "Save plan" : "Create plan"}</button>
        <button class="btn btn-outline" onclick="RU.back()">Cancel</button>
      </div>`;
  }

  function dayChips(kind, selected) {
    const sel = new Set((selected || []).map(Number));
    return html.join(DAYS.map((label, i) => html`<button type="button" class="chip ${sel.has(i) ? "active" : ""}" data-k="${kind}" data-d="${i}" onclick="this.classList.toggle('active')">${label}</button>`));
  }
  function tiersHtml() {
    if (!RU.tiers.length) return html`<div class="ru-help" style="margin:0 0 8px;">No tiers — the free-cancellation window alone applies.</div>`;
    return html.join(RU.tiers.map((t, i) => html`
      <div class="ru-tier-row">
        <div class="form-field" style="margin:0;"><label>Hours before arrival ≥</label><input type="number" class="ru-tier-h" min="0" step="1" value="${t.hoursBefore}"></div>
        <div class="form-field" style="margin:0;"><label>Refund %</label><input type="number" class="ru-tier-p" min="0" max="100" step="1" value="${t.refundPercent}"></div>
        <button type="button" class="btn btn-sm btn-outline" onclick="RU.removeTier(${i})" aria-label="Remove tier">&times;</button>
      </div>`));
  }
  function readTiers() {
    const hs = Array.from(document.querySelectorAll(".ru-tier-h")), ps = Array.from(document.querySelectorAll(".ru-tier-p"));
    return hs.map((h, i) => ({ hoursBefore: h.value === "" ? NaN : Number(h.value), refundPercent: ps[i].value === "" ? NaN : Number(ps[i].value) }));
  }
  RU.addTier = function () { RU.tiers = readTiers(); RU.tiers.push({ hoursBefore: 24, refundPercent: 50 }); renderInto("rpTiers", tiersHtml()); };
  RU.removeTier = function (i) { RU.tiers = readTiers(); RU.tiers.splice(i, 1); renderInto("rpTiers", tiersHtml()); };

  RU.planPreview = function () {
    const el = $("rpPreview");
    if (!el || !RU.view) return;
    const t = byId(RU.types, RU.view.typeId);
    const mode = val("rpMode"), v = val("rpAdj");
    const p = { adjustmentPercent: mode === "percent" && v !== "" ? Number(v) : null, adjustmentFixed: mode === "fixed" && v !== "" ? Number(v) : null };
    el.textContent = mode === "none" || v === "" ? `Guests pay the rack rate: ${fmtMoney(t.basePrice, t.currency)} / night.`
      : `Example night: ${fmtMoney(t.basePrice, t.currency)} → ${fmtMoney(planPrice(t.basePrice, p), t.currency)}.`;
    const free = $("rpFree"); if (free) free.disabled = !checked("rpRefundable");
  };

  function collectPlan() {
    const mode = val("rpMode"), adj = val("rpAdj").trim();
    const p = {
      name: val("rpName").trim(),
      code: val("rpCode").trim().toUpperCase(),
      kind: val("rpKind"),
      description: val("rpDesc").trim() || null,
      adjustmentPercent: mode === "percent" && adj !== "" ? Number(adj) : null,
      adjustmentFixed: mode === "fixed" && adj !== "" ? Number(adj) : null,
      refundable: checked("rpRefundable"),
      freeCancellationHours: numOrNull("rpFree") ?? 0,
      depositPercent: numOrNull("rpDeposit") ?? 0,
      prepaymentRequired: checked("rpPrepay"),
      cancellationTiers: readTiers(),
      minNights: numOrNull("rpMin") ?? 1,
      maxNights: numOrNull("rpMax"),
      advanceBookingMinDays: numOrNull("rpAdvMin") ?? 0,
      advanceBookingMaxDays: numOrNull("rpAdvMax"),
      closedToArrival: Array.from(document.querySelectorAll('.chip[data-k="cta"].active')).map((b) => Number(b.dataset.d)),
      closedToDeparture: Array.from(document.querySelectorAll('.chip[data-k="ctd"].active')).map((b) => Number(b.dataset.d)),
      extraAdultPrice: numOrNull("rpXAdult"),
      extraChildPrice: numOrNull("rpXChild"),
      isActive: checked("rpActive"),
      isDefault: checked("rpDefault"),
    };
    if (!p.cancellationTiers.length) p.cancellationTiers = null;
    return p;
  }
  function validatePlan(p) {
    if (!p.name) return "Give the plan a name.";
    if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(p.code)) return "Code must be 1–20 letters, digits, - or _ (for example NR-BB).";
    const mode = val("rpMode");
    if (mode !== "none" && val("rpAdj").trim() === "") return "Enter the adjustment amount, or choose “None”.";
    if (p.adjustmentPercent !== null && (!Number.isFinite(p.adjustmentPercent) || p.adjustmentPercent < -100 || p.adjustmentPercent > 500)) return "Percentage must be between -100 and 500.";
    if (p.adjustmentFixed !== null && !Number.isFinite(p.adjustmentFixed)) return "Fixed adjustment must be a number.";
    if (!Number.isInteger(p.freeCancellationHours) || p.freeCancellationHours < 0) return "Free-cancellation hours must be 0 or more.";
    if (!Number.isInteger(p.depositPercent) || p.depositPercent < 0 || p.depositPercent > 100) return "Deposit must be 0–100%.";
    if (p.prepaymentRequired && p.depositPercent > 0 && p.depositPercent < 100) return "Prepayment in full and a partial deposit don't go together — pick one.";
    if (p.cancellationTiers) for (const t of p.cancellationTiers) {
      if (!Number.isInteger(t.hoursBefore) || t.hoursBefore < 0) return "Each cancellation tier needs hours ≥ 0.";
      if (!Number.isInteger(t.refundPercent) || t.refundPercent < 0 || t.refundPercent > 100) return "Each cancellation tier needs a refund between 0 and 100%.";
    }
    if (!Number.isInteger(p.minNights) || p.minNights < 1) return "Min nights must be at least 1.";
    if (p.maxNights !== null && (!Number.isInteger(p.maxNights) || p.maxNights < p.minNights)) return "Max nights cannot be smaller than min nights.";
    if (!Number.isInteger(p.advanceBookingMinDays) || p.advanceBookingMinDays < 0) return "Advance booking days must be 0 or more.";
    if (p.advanceBookingMaxDays !== null && (!Number.isInteger(p.advanceBookingMaxDays) || p.advanceBookingMaxDays < p.advanceBookingMinDays)) return "“At most” days ahead cannot be smaller than “at least”.";
    for (const k of ["extraAdultPrice", "extraChildPrice"]) if (p[k] !== null && (!Number.isFinite(p[k]) || p[k] < 0)) return "Extra-guest prices must be 0 or more.";
    return null;
  }

  RU.savePlan = async function (btn) {
    const v = RU.view;
    const existing = v.planId ? (RU.plans[v.typeId] || []).find((x) => x.id === v.planId) : null;
    const p = collectPlan();
    const bad = validatePlan(p);
    if (bad) return note(bad);
    if (existing && existing.isDefault) { delete p.isDefault; delete p.isActive; }
    else if (existing && !p.isDefault) delete p.isDefault;        // unticked on a non-default plan = no change
    const res = await runAction(btn, () => (existing ? adminApi.ruUpdatePlan(v.typeId, existing.id, p) : adminApi.ruCreatePlan(v.typeId, p)), existing ? "Plan saved" : "Plan created");
    if (!res) return;
    await loadPlans(v.typeId);
    RU.view = { kind: "type", id: v.typeId, tab: "plans" };
    RU.stack = [];
    renderDrawer();
  };

  /* ---------------------------------------------------------- room view ---- */
  async function ensureTags() {
    if (RU.tags) return RU.tags;
    try { const { tags } = await adminApi.listTags(getActiveBranchId(), "room"); RU.tags = tags || []; }
    catch { RU.tags = []; }
    return RU.tags;
  }

  RU.openRoom = function (id) {
    if (!canCreate()) return toast("Only a Director can create or edit rooms.", "error");
    if (!id && !RU.types.length) return toast("Create a room type first — every room belongs to one.", "error");
    RU.openView({ kind: "room", id: id || null, typeId: id ? null : RU.filter.type && RU.filter.type !== "__none" ? RU.filter.type : null });
  };

  function roomView(v) {
    const r = v.id ? byId(RU.rooms, v.id) : null;
    if (v.id && !r) return html`${head("Room", "", RU.stack.length > 0)}<div class="empty-state">This room no longer exists.</div>`;
    const curType = r ? r.roomTypeId : v.typeId || (RU.types[0] && RU.types[0].id);
    const t = byId(RU.types, curType);
    const isLinked = !!(r ? r.roomTypeId : true);
    ensureTags().then((tags) => { const box = $("rmTags"); if (box && !box.dataset.ready) { box.dataset.ready = "1"; box.innerHTML = tagBoxes(tags, r ? r.tags || [] : []); } });
    return html`
      ${head(r ? `Room ${r.roomNumber}` : "Add room", r ? (r.roomTypeId ? `Type: ${typeName(r.roomTypeId)}` : "Not linked to a room type — it can't be sold until you pick one.") : "Every room belongs to a room type.", RU.stack.length > 0)}
      <div class="form-field"><label>Room type</label>
        <select id="rmType" onchange="RU.roomTypeChanged()">
          ${r && !r.roomTypeId ? html`<option value="">— choose a type —</option>` : ""}
          ${html.join(RU.types.map((x) => html`<option value="${x.id}" ${x.id === curType ? "selected" : ""}>${x.name}</option>`))}
        </select>
        <div class="ru-help" id="rmTypeHelp">${r && r.roomTypeId ? "Moving a room to another type is blocked while it has an active or upcoming booking." : ""}</div>
      </div>
      ${r ? "" : html`
        <div class="form-field">
          <div class="checkbox-item"><input type="checkbox" id="rmRange" onchange="RU.rangeToggle()"><label for="rmRange">Create several rooms at once (a numbered range)</label></div>
        </div>`}
      <div id="rmSingle" class="form-row">
        <div class="form-field"><label>Room number</label><input type="text" id="rmNumber" maxlength="20" value="${r ? r.roomNumber : ""}" placeholder="214"></div>
        <div class="form-field"><label>Floor</label><input type="text" id="rmFloor" maxlength="20" value="${r ? r.floor || "" : ""}"></div>
      </div>
      <div id="rmRangeBox" style="display:none;" class="form-row">
        <div class="form-field"><label>Prefix <span class="faint">(optional)</span></label><input type="text" id="rmPrefix" maxlength="10" placeholder="A-"></div>
        <div class="form-field"><label>From</label><input type="number" id="rmFrom" step="1" min="0" placeholder="101"></div>
        <div class="form-field"><label>To</label><input type="number" id="rmTo" step="1" min="0" placeholder="110"></div>
        <div class="form-field"><label>Floor <span class="faint">(optional)</span></label><input type="text" id="rmFloor2" maxlength="20"></div>
      </div>
      <div class="form-field"><label>Display name <span class="faint">(optional — defaults to the type name)</span></label><input type="text" id="rmName" maxlength="80" value="${r ? (r.roomType && r.name === r.roomType.name ? "" : r.name || "") : ""}" placeholder="${t ? t.name : ""}"></div>
      <div id="rmPriceBox">${roomPriceBox(r, t)}</div>
      <div class="form-field"><label>Description <span class="faint">(optional)</span></label><textarea id="rmDesc" rows="2">${r ? r.description || "" : ""}</textarea></div>
      <div class="form-field"><label>Amenities <span class="faint">(comma-separated — blank copies the type's)</span></label><input type="text" id="rmAmen" value="${r ? (r.amenities || []).join(", ") : ""}"></div>
      <div class="form-field"><label>Tags <span class="faint">(manage the list on the Tags page)</span></label><div id="rmTags" class="checkbox-grid"><span class="faint">Loading…</span></div></div>
      <div class="form-field"><label>Status</label>
        <select id="rmStatus">${html.join([["ACTIVE", "Active (sellable)"], ["MAINTENANCE", "Maintenance"], ["INACTIVE", "Inactive"]].map(([k, l]) => html`<option value="${k}" ${(r ? r.status : "ACTIVE") === k ? "selected" : ""}>${l}</option>`))}</select>
      </div>
      ${r ? html`
        <div class="form-field"><label>Photos</label>
          <div class="rt-media-grid">
            ${html.join((r.images || []).map((url) => html`<div class="rt-media-thumb"><img src="${url}" alt=""><button type="button" class="rt-media-remove" onclick="RU.removeRoomImage('${r.id}','${url}')" title="Remove photo">&times;</button></div>`))}
            <label class="rt-media-add"><input type="file" accept="image/*" style="display:none;" onchange="RU.addRoomImage('${r.id}', this)"><i class="fa-solid fa-plus"></i><span>Add photo</span></label>
          </div>
          <div class="ru-help">Rooms without their own photos show the room type's gallery on the booking site.</div>
        </div>` : ""}
      <div class="ru-sticky">
        <button class="btn btn-primary" id="rmSaveBtn" onclick="RU.saveRoom(this)">${r ? "Save room" : "Add room"}</button>
        <button class="btn btn-outline" onclick="${RU.stack.length ? "RU.back()" : "closeModal()"}">Cancel</button>
      </div>`;
  }

  function roomPriceBox(r, t) {
    const linked = r ? !!r.roomTypeId : !!t;
    if (linked && t) {
      return html`<div class="ru-inherit">Price, currency and guest capacity come from the room type: <b>${fmtMoney(t.basePrice, t.currency)}</b> / night, up to <b>${t.maxOccupancy}</b> guest${t.maxOccupancy === 1 ? "" : "s"}. Change them on the type and every room follows.</div>`;
    }
    return html`<div class="form-row">
      <div class="form-field"><label>Price / night</label><input type="number" id="rmPrice" min="0" step="0.01" value="${r ? r.basePrice : ""}"></div>
      <div class="form-field"><label>Max guests</label><input type="number" id="rmOcc" min="1" step="1" value="${r ? r.maxOccupancy : 2}"></div>
    </div>
    <div class="ru-help" style="margin-top:-6px;">Used only until you link the room to a type.</div>`;
  }

  const tagBoxes = (tags, selected) => tags.length
    ? html.join(tags.map((tg) => html`<label class="checkbox-item"><input type="checkbox" value="${tg.name}" ${selected.includes(tg.name) ? "checked" : ""}> ${tg.name}</label>`))
    : html`<span class="faint">No tags yet.</span>`;

  RU.roomTypeChanged = function () {
    const v = RU.view, r = v.id ? byId(RU.rooms, v.id) : null;
    const t = byId(RU.types, val("rmType"));
    renderInto("rmPriceBox", roomPriceBox(r, t));
    const help = $("rmTypeHelp");
    if (help && r && r.roomTypeId && t && t.id !== r.roomTypeId) help.textContent = `Moves this room from ${typeName(r.roomTypeId)} to ${t.name}. Its price and capacity will follow the new type.`;
    const nm = $("rmName"); if (nm && t) nm.placeholder = t.name;
  };
  RU.rangeToggle = function () {
    const on = checked("rmRange");
    $("rmSingle").style.display = on ? "none" : "";
    $("rmRangeBox").style.display = on ? "" : "none";
  };

  RU.saveRoom = async function (btn) {
    const v = RU.view;
    const r = v.id ? byId(RU.rooms, v.id) : null;
    const typeId = val("rmType");
    const t = byId(RU.types, typeId);
    if (!t) return note("Pick a room type — every room must belong to one.");
    const tags = Array.from(document.querySelectorAll("#rmTags input:checked")).map((e) => e.value);
    const base = {
      description: val("rmDesc").trim() || undefined,
      tags,
    };
    const name = val("rmName").trim(); if (name) base.name = name;
    const amen = csv(val("rmAmen")); if (amen.length) base.amenities = amen;
    const status = val("rmStatus");

    /* create a numbered range */
    if (!r && checked("rmRange")) {
      const prefix = val("rmPrefix").trim(), from = numOrNull("rmFrom"), to = numOrNull("rmTo"), floor = val("rmFloor2").trim() || undefined;
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) return note("Enter a valid From / To range.");
      if (to - from + 1 > 50) return note("Create at most 50 rooms at a time.");
      const existing = new Set(RU.rooms.map((x) => String(x.roomNumber)));
      const numbers = []; for (let n = from; n <= to; n++) numbers.push(`${prefix}${n}`);
      const clash = numbers.filter((n) => existing.has(n));
      if (clash.length) return note(`These numbers already exist: ${clash.slice(0, 6).join(", ")}${clash.length > 6 ? "…" : ""}`);
      btn.disabled = true;
      let made = 0, failure = null;
      for (const n of numbers) {
        try { await adminApi.ruCreateRoom({ ...base, name: base.name, roomTypeId: typeId, roomNumber: n, floor, status }); made++; }
        catch (err) { failure = `${n}: ${err.message}`; break; }
      }
      btn.disabled = false;
      await fetchData();
      if ($("ruRoot")) RU.renderPage();
      if (failure) { toast(`Created ${made} of ${numbers.length}. Stopped at ${failure}`, "error"); renderDrawer(); return; }
      toast(`${made} rooms added`);
      return RU.stack.length ? (RU.stack.pop(), RU.view = { kind: "type", id: typeId, tab: "units" }, renderDrawer()) : (RU.view = null, closeModal());
    }

    const roomNumber = val("rmNumber").trim();
    if (!roomNumber) return note("Enter a room number.");
    if (RU.rooms.some((x) => String(x.roomNumber) === roomNumber && (!r || x.id !== r.id))) return note(`Room number ${roomNumber} already exists at this branch.`);
    const floor = val("rmFloor").trim();

    /* create */
    if (!r) {
      const res = await runAction(btn, () => adminApi.ruCreateRoom({ ...base, roomTypeId: typeId, roomNumber, floor: floor || undefined, status }), "Room added");
      if (!res) return;
      await fetchData();
      if ($("ruRoot")) RU.renderPage();
      if (RU.stack.length) { RU.stack.pop(); RU.view = { kind: "type", id: typeId, tab: "units" }; renderDrawer(); }
      else { RU.view = null; closeModal(); }
      return;
    }

    /* update */
    const payload = { ...base, roomNumber, floor: floor || null };
    if (!("name" in payload)) payload.name = r.name && (!r.roomType || r.name !== r.roomType.name) ? t.name : t.name;  // blank name = follow the type
    if (typeId !== r.roomTypeId) payload.roomTypeId = typeId;
    if (!r.roomTypeId && !typeId) {
      payload.basePrice = numOrNull("rmPrice"); payload.maxOccupancy = numOrNull("rmOcc");
    }
    if (payload.amenities === undefined) payload.amenities = t.amenities || [];
    const res = await runAction(btn, async () => {
      const out = await adminApi.ruUpdateRoom(r.id, payload);
      if (status !== r.status) await adminApi.ruRoomStatus(r.id, status);
      return out;
    }, "Room saved");
    if (!res) { await RU.reload(); return; }
    await fetchData();
    if ($("ruRoot")) RU.renderPage();
    if (RU.stack.length) RU.back(); else { RU.view = null; closeModal(); }
  };

  RU.addRoomImage = async function (id, el) {
    const f = el.files[0]; if (!f) return;
    try { await adminApi.uploadRoomImage(id, f); toast("Photo added"); await RU.reload(); } catch (err) { toast(err.message, "error"); }
  };
  RU.removeRoomImage = async function (id, url) {
    try { await adminApi.deleteRoomImage(id, url); toast("Photo removed"); await RU.reload(); } catch (err) { toast(err.message, "error"); }
  };

  /* ---------------------------------------------------------- link view ---- */
  RU.openLink = function () {
    if (!canCreate()) return;
    if (!RU.types.length) return toast("Create a room type first, then link the rooms to it.", "error");
    RU.openView({ kind: "link" });
  };
  function linkView() {
    const un = unlinked();
    if (!un.length) return html`${head("Link rooms to a type", "", false)}<div class="empty-state">Every room is linked. 🎉</div>`;
    return html`
      ${head("Link rooms to a type", `${un.length} room${un.length === 1 ? "" : "s"} can't be sold yet`, false)}
      <div class="form-field"><label>Link the selected rooms to</label>
        <select id="lkType">${html.join(RU.types.map((t) => html`<option value="${t.id}">${t.name} — ${fmtMoney(t.basePrice, t.currency)}</option>`))}</select>
        <div class="ru-help">Each room's price, currency and capacity will follow the type. Names and photos are kept.</div>
      </div>
      <div class="ru-sub" style="margin-bottom:8px;"><button class="btn btn-sm btn-outline" onclick="document.querySelectorAll('.lk-room').forEach(c=>c.checked=true)">Select all</button>
        <button class="btn btn-sm btn-outline" onclick="document.querySelectorAll('.lk-room').forEach(c=>c.checked=false)">Clear</button></div>
      <table><thead><tr><th></th><th>Room</th><th>Name</th><th>Price now</th></tr></thead>
        <tbody>${html.join(un.map((r) => html`<tr><td><input type="checkbox" class="lk-room" value="${r.id}" checked></td><td><b>${r.roomNumber}</b></td><td>${r.name}</td><td>${fmtMoney(r.basePrice, r.currency)}</td></tr>`))}</tbody></table>
      <div class="ru-sticky">
        <button class="btn btn-primary" id="lkBtn" onclick="RU.linkRooms(this)">Link selected rooms</button>
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      </div>`;
  }
  RU.linkRooms = async function (btn) {
    const ids = Array.from(document.querySelectorAll(".lk-room:checked")).map((c) => c.value);
    const typeId = val("lkType");
    if (!ids.length) return note("Select at least one room.");
    btn.disabled = true;
    let ok = 0, failed = [];
    for (const id of ids) {
      try { await adminApi.ruUpdateRoom(id, { roomTypeId: typeId }); ok++; }
      catch (err) { const r = byId(RU.rooms, id); failed.push(`${r ? r.roomNumber : id}: ${err.message}`); }
    }
    btn.disabled = false;
    await fetchData();
    if ($("ruRoot")) RU.renderPage();
    if (failed.length) { note(`${ok} linked, ${failed.length} failed — ${failed.slice(0, 2).join("; ")}`); renderDrawer(); }
    else { toast(`${ok} room${ok === 1 ? "" : "s"} linked to ${typeName(typeId)}`); RU.view = null; closeModal(); }
  };

  /* -------------------------------------------------------------- wiring ---- */
  PAGE_LOADERS.rooms = () => RU.load("rooms");
  PAGE_LOADERS.roomtypes = () => RU.load("types");
})();