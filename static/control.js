/* Phone control app.

   Two things worth knowing:
   - Every request goes through api(), which is the only place that touches the
     network. A failure sets the offline banner and never leaves a button stuck
     mid-"sending".
   - Taps apply optimistically and mark that field dirty for 2s, so the 5s poll
     can't race an in-flight POST and visually revert the toggle you just hit. */
(function () {
  const $ = (id) => document.getElementById(id);
  const POLL_MS = 5000;
  const DIRTY_MS = 2000;

  let state = { muted: false, flash: true, history: [], screens: [] };
  const dirty = {};                  // field -> timestamp until which we own it
  let timer = null;

  function isDirty(k) { return dirty[k] && Date.now() < dirty[k]; }
  function markDirty(k) { dirty[k] = Date.now() + DIRTY_MS; }

  function esc(s) {
    return String(s ?? "").replace(/[&<>]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  function ago(ts) {
    if (!ts) return "";
    const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (s < 60) return s + "s";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  }

  function fmtUptime(s) {
    if (s == null) return "—";
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
          m = Math.floor((s % 3600) / 60);
    return (d ? d + "d " : "") + h + "h " + m + "m";
  }

  // ---- the only network path ----
  async function api(body) {
    const opts = body
      ? { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body) }
      : { cache: "no-store" };
    const r = await fetch("/api/control", opts);
    // An expired Cloudflare Access session answers with a redirect to a login
    // page rather than JSON. A full navigation is the only way to complete it.
    if (r.redirected || r.status === 403) { location.reload(); throw new Error("auth"); }
    if (!r.ok) throw new Error("http " + r.status);
    return r.json();
  }

  function offline(on, msg) {
    document.body.classList.toggle("offline", on);
    $("status").classList.toggle("err", on);
    if (on) $("status").textContent = msg || "offline — retrying…";
  }

  async function load() {
    try {
      render(await api());
      offline(false);
    } catch (e) {
      if (e.message !== "auth") offline(true);
    }
  }

  async function post(body, dirtyKeys) {
    const keys = dirtyKeys || [];
    keys.forEach(markDirty);
    try {
      const fresh = await api(body);
      // This response is the server's own confirmation, so it outranks the
      // optimistic value -- drop the guard before rendering it. The guard only
      // exists to stop the background poll racing an in-flight POST.
      keys.forEach((k) => delete dirty[k]);
      render(fresh);
      offline(false);
    } catch (e) {
      if (e.message !== "auth") offline(true, "couldn't reach the pi");
    }
  }

  // ---- render ----
  function render(s) {
    if (!s) return;
    state = s;
    const a = s.alerts || {};

    if (!document.body.classList.contains("offline")) {
      $("status").textContent =
        `${a.muted ? "sound muted" : "sound on"} · ` +
        `${a.flash === false ? "flash off" : "flash on"}`;
    }

    if (!isDirty("muted")) {
      $("mute-btn").classList.toggle("off", !!a.muted);
      $("mute-btn").setAttribute("aria-pressed", String(!a.muted));
      $("mute-btn").querySelector("b").textContent = a.muted ? "off" : "on";
    }
    if (!isDirty("flash")) {
      const off = a.flash === false;
      $("flash-btn").classList.toggle("off", off);
      $("flash-btn").setAttribute("aria-pressed", String(!off));
      $("flash-btn").querySelector("b").textContent = off ? "off" : "on";
    }

    if (!isDirty("screen")) renderScreens(s.screens || [], s.screen);
    renderLive(s);
    renderHistory(a.history || []);
  }

  function renderScreens(screens, current) {
    const box = $("screens");
    if (!screens.length) { box.innerHTML = '<div class="empty">no screens</div>'; return; }
    box.innerHTML = screens.map((s) =>
      `<button class="screen-opt" type="button" role="radio" data-id="${esc(s.id)}" ` +
      `aria-checked="${s.id === current}"><span class="tick"></span>${esc(s.label)}</button>`
    ).join("");
    box.querySelectorAll(".screen-opt").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.id;
        if (id === state.screen) return;
        box.querySelectorAll(".screen-opt").forEach((o) =>
          o.setAttribute("aria-checked", String(o === b)));   // optimistic
        state.screen = id;
        post({ screen: id }, ["screen"]);
      });
    });
  }

  function renderLive(s) {
    const sys = s.system || {}, bot = s.bot || {}, w = s.weather;
    const lvl = (p) => (p >= 85 ? "hot" : p >= 60 ? "warn" : "");
    const stat = (k, v, cls) =>
      `<div class="stat"><span class="k">${k}</span>` +
      `<span class="v ${cls || ""}">${esc(v)}</span></div>`;

    let html = "";
    html += stat("Bot", bot.running ? "online" : "offline", bot.running ? "ok" : "hot");
    html += stat("Claimable", bot.claimable ?? "—", bot.claimable > 0 ? "warn" : "");
    html += stat("CPU", (sys.cpu_pct ?? "—") + "%", lvl(sys.cpu_pct ?? 0));
    html += stat("Temp", sys.temp_c == null ? "—" : sys.temp_c + "°",
                 sys.temp_c > 70 ? "hot" : sys.temp_c > 55 ? "warn" : "");
    html += stat("RAM", (sys.mem_pct ?? "—") + "%", lvl(sys.mem_pct ?? 0));
    html += stat("Disk", (sys.disk_pct ?? "—") + "%", lvl(sys.disk_pct ?? 0));
    html += `<div class="stat wide"><span class="k">Uptime</span>` +
            `<span class="v">${esc(fmtUptime(sys.uptime_s))}</span></div>`;
    if (w) {
      html += `<div class="stat wide"><span class="k">${esc(w.city || "Weather")}</span>` +
              `<span class="v">${esc(w.temp_c)}° · ${esc(w.label)}</span></div>`;
    }
    $("live").innerHTML = html;
  }

  function renderHistory(items) {
    $("history").innerHTML = items.length ? items.map((e) =>
      `<div class="hist ${esc(e.kind || "")}">` +
      `<div class="dot"></div><div class="copy">` +
      `<b>${esc(e.title)}</b><span>${esc(e.detail || "")}</span>` +
      `</div><time>${ago(e.ts)}</time></div>`
    ).join("") : '<div class="empty">No alerts yet.</div>';
  }

  // ---- two-tap confirm (no confirm() — native dialogs look broken in a PWA) ----
  function confirmable(btn, label, fn) {
    let armed = false, t = null;
    btn.addEventListener("click", () => {
      if (armed) {
        clearTimeout(t); armed = false;
        btn.classList.remove("confirming");
        btn.textContent = label;
        fn();
        return;
      }
      armed = true;
      btn.classList.add("confirming");
      btn.textContent = "Tap again to confirm";
      t = setTimeout(() => {
        armed = false;
        btn.classList.remove("confirming");
        btn.textContent = label;
      }, 4000);
    });
  }

  // ---- wiring ----
  $("mute-btn").addEventListener("click", () => {
    const next = !(state.alerts || {}).muted;
    $("mute-btn").classList.toggle("off", next);
    $("mute-btn").querySelector("b").textContent = next ? "off" : "on";
    $("mute-btn").setAttribute("aria-pressed", String(!next));
    post({ muted: next }, ["muted"]);
  });

  $("flash-btn").addEventListener("click", () => {
    const next = (state.alerts || {}).flash === false;   // currently off -> turn on
    $("flash-btn").classList.toggle("off", !next);
    $("flash-btn").querySelector("b").textContent = next ? "on" : "off";
    $("flash-btn").setAttribute("aria-pressed", String(next));
    post({ flash: next }, ["flash"]);
  });

  $("test-btn").addEventListener("click", () => post({ test_alert: true }));
  $("refresh-btn").addEventListener("click", () => post({ refresh: "all" }));
  $("reload-btn").addEventListener("click", () => post({ action: "reload_kiosk" }));
  $("screen-on-btn").addEventListener("click", () => post({ action: "screen_on" }));
  confirmable($("screen-off-btn"), "Display Off", () => post({ action: "screen_off" }));
  confirmable($("clear-btn"), "Clear History", () => post({ clear_history: true }));

  // ---- polling: only while visible; phones background aggressively ----
  function startPolling() {
    if (timer) return;
    load();
    timer = setInterval(load, POLL_MS);
  }
  function stopPolling() { clearInterval(timer); timer = null; }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") startPolling();
    else stopPolling();
  });
  startPolling();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
})();
