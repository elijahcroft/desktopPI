/* The original dashboard, as a screen. Markup moved verbatim from index.html,
   logic moved from app.js. Clock ticks locally; everything else comes from the
   payload the shell pushes into data(). */
registerScreen({
  id: "dashboard",
  label: "Dashboard",

  html: `
  <div id="app">

    <!-- ---- sidebar ---- -->
    <aside id="sidebar">
      <div class="brand"><span class="brand-cat">🐱</span> a-to-z</div>
      <div id="alert-panel">
        <div class="side-title">alert history</div>
        <div id="history-list">
          <div class="hist-empty">waiting…</div>
        </div>
      </div>
      <div class="side-foot">
        <span class="online"><i></i> system online</span>
        <span id="control-state">sound on · flash on</span>
        <span id="uptime">up —</span>
      </div>
    </aside>

    <!-- ---- main ---- -->
    <main id="main">
      <div id="screen">

        <!-- clock + week -->
        <section id="clock-card" class="card">
          <div class="clock-top">
            <div id="time">--:--</div><span id="ampm">AM</span>
          </div>
          <div id="date">loading…</div>
          <div id="week"></div>
        </section>

        <!-- weather -->
        <section id="weather-card" class="card">
          <div class="wx-head">
            <canvas id="wx-icon" width="64" height="64"></canvas>
            <div class="wx-text">
              <div id="wx-temp">--°</div>
              <div id="wx-label">weather</div>
              <div id="wx-meta"></div>
            </div>
          </div>
          <div class="wx-rows">
            <div class="wx-row"><span class="ic">💧</span><span class="k">Humidity</span>
              <div class="wx-bar"><i id="wx-hum-bar"></i></div><b id="wx-hum">--</b></div>
            <div class="wx-row"><span class="ic">💨</span><span class="k">Wind</span>
              <b id="wx-wind" class="r">--</b></div>
            <div class="wx-row"><span class="ic">🌅</span><span class="k">Sunrise</span>
              <b id="wx-sunrise" class="r">--</b></div>
            <div class="wx-row"><span class="ic">🌇</span><span class="k">Sunset</span>
              <b id="wx-sunset" class="r">--</b></div>
          </div>
        </section>

        <!-- canvas assignments (the cat still roams the whole screen) -->
        <section id="canvas-card" class="card">
          <h2>assignments <span class="pulse">📚</span></h2>
          <div id="cv-list"><div class="cv-empty">loading…</div></div>
        </section>

        <!-- system stats -->
        <section id="stats-card" class="card">
          <h2>system <span class="pulse">〜</span></h2>
          <div class="gauge" data-k="cpu"><span class="ic">🖥️</span><span class="lbl">CPU</span><div class="bar"><i></i></div><span class="val">--</span></div>
          <div class="gauge" data-k="mem"><span class="ic">🧠</span><span class="lbl">RAM</span><div class="bar"><i></i></div><span class="val">--</span></div>
          <div class="gauge" data-k="temp"><span class="ic">🌡️</span><span class="lbl">TMP</span><div class="bar"><i></i></div><span class="val">--</span></div>
          <div class="gauge" data-k="disk"><span class="ic">💽</span><span class="lbl">DSK</span><div class="bar"><i></i></div><span class="val">--</span></div>
        </section>

        <!-- bot -->
        <section id="bot-card" class="card">
          <h2>a-to-z bot <span id="bot-dot" class="dot"></span></h2>
          <div class="bot-line"><span class="ic">⟨⟩</span><span>mode</span><b id="bot-mode">—</b></div>
          <div class="bot-line"><span class="ic">◎</span><span>opportunities</span><b id="bot-opps">—</b></div>
          <div class="bot-line"><span class="ic">🕒</span><span>last poll</span><b id="bot-poll">—</b></div>
        </section>

        <!-- claude usage -->
        <section id="dash-claude" class="card">
          <h2>claude <span class="pulse">✳</span></h2>
          <div class="dc-body">
            <div class="dc-head">
              <span id="dc-pct">--</span>
              <span id="dc-sub">context used</span>
            </div>
            <div class="dc-track"><i></i></div>
            <svg id="dc-spark" viewBox="0 0 100 24" preserveAspectRatio="none">
              <polyline points=""></polyline>
            </svg>
            <div class="dc-meta">
              <span id="dc-tok">—</span>
              <span id="dc-host"></span>
            </div>
          </div>
        </section>

      </div>

      <!-- ---- bottom dock (status strip) ---- -->
      <div id="dock">
        <div class="dock-mid">
          <span class="term">🌱 <span class="prompt">&gt;_ ~/dashboard</span></span>
          <span class="tagline">Stay curious. Build things. Help others.</span>
        </div>
      </div>
    </main>
  </div>`,

  mount(root, ctx) {
    pet = createPet(ctx.petLayer, {
      // Nap on the system card's rug. Returns null if it's somehow missing, so
      // the cat curls up in place rather than throwing mid-animation.
      bed() {
        const el = document.getElementById("stats-card");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2 - 48, y: r.top + r.height / 2 - 48 };
      },
    });
    tickClock();
    ctx.every(tickClock, 1000);
  },

  unmount() {
    if (pet) { pet.stop(); pet = null; }
  },

  data(d) { render(d); },
});

// ---------------------------------------------------------------------------
// Everything below is app.js, unchanged apart from being module-scoped.
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
let pet = null;   // set in mount(), torn down in unmount()

// ---- clock ----
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MON  = ["January","February","March","April","May","June","July",
              "August","September","October","November","December"];
const WD = "SMTWTFS";
let lastDay = -1;

function buildWeek(d) {
  const start = new Date(d); start.setDate(d.getDate() - d.getDay());
  let html = "";
  for (let i = 0; i < 7; i++) {
    const day = new Date(start); day.setDate(start.getDate() + i);
    const today = day.toDateString() === d.toDateString();
    html += `<div class="wk"><div class="wd">${WD[i]}</div>` +
            `<div class="dn${today ? " today" : ""}">${day.getDate()}</div></div>`;
  }
  $("week").innerHTML = html;
}

function tickClock() {
  const d = new Date();
  const ap = d.getHours() < 12 ? "AM" : "PM";
  const h12 = d.getHours() % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  $("time").textContent = `${h12}:${mm}`;
  $("ampm").textContent = ap;
  $("date").textContent = `${DAYS[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;
  if (d.getDate() !== lastDay) { buildWeek(d); lastDay = d.getDate(); }
}

// ---- weather icon (pixel, canvas) ----
function drawWx(icon) {
  const c = $("wx-icon"), x = c.getContext("2d");
  x.clearRect(0, 0, 64, 64);
  const px = (px_, py, w, h, col) => { x.fillStyle = col; x.fillRect(px_, py, w, h); };
  const sun = "#ffcb47", cloud = "#cdd7e0", drop = "#7aa9d6", snow = "#eef4f8", fog = "#c9c1b0";
  if (icon === "sun") {
    px(24, 24, 16, 16, sun);
    [[28,10],[28,46],[10,28],[46,28],[16,16],[40,16],[16,40],[40,40]]
      .forEach(([a,b]) => px(a, b, 8, 8, sun));
  } else {
    // little sun peeking behind the cloud for partly-cloudy warmth
    if (icon === "cloud") { px(34, 12, 12, 12, sun); px(38, 8, 4, 4, sun); px(48, 18, 4, 4, sun); }
    px(16, 26, 34, 14, cloud);
    px(22, 18, 18, 12, cloud);
    if (icon === "rain" || icon === "storm") [20,30,40].forEach(a => px(a, 44, 4, 12, drop));
    if (icon === "snow") [20,30,40].forEach(a => px(a, 46, 6, 6, snow));
    if (icon === "storm") px(28, 42, 8, 16, sun);
    if (icon === "fog") [0,1,2].forEach(i => px(14, 44 + i*6, 36, 4, fog));
  }
}

// ---- stats gauges ----
function setGauge(k, pct, valText, level) {
  const g = document.querySelector(`.gauge[data-k="${k}"]`);
  if (!g) return;
  g.querySelector("i").style.width = Math.max(0, Math.min(100, pct)) + "%";
  g.querySelector(".val").textContent = valText;
  g.classList.remove("warn", "hot");
  if (level) g.classList.add(level);
}
function lvl(pct) { return pct >= 85 ? "hot" : pct >= 60 ? "warn" : ""; }

function fmtUptime(s) {
  if (s == null) return "up —";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
        m = Math.floor((s % 3600) / 60);
  return "up " + (d ? d + "d " : "") + h + "h " + m + "m";
}

// ---- bot relative time ----
function ago(ts) {
  if (!ts) return "—";
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  return Math.floor(s / 3600) + "h ago";
}

// ---- canvas assignment due labels ----
const WKD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
function dueInfo(iso) {
  const d = new Date(iso);              // ISO is UTC; renders in local time
  const now = new Date();
  const mins = Math.round((d - now) / 60000);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((midnight(d) - midnight(now)) / 86400000);
  let label;
  if (mins < 0)        label = "late";
  else if (days === 0) label = time;
  else if (days === 1) label = "tmrw";
  else if (days < 7)   label = WKD[d.getDay()];
  else                 label = `${d.getMonth() + 1}/${d.getDate()}`;
  const cls = mins < 0 ? "overdue" : mins < 2880 ? "soon" : "";
  return { label, cls };
}

function renderCanvas(cv) {
  const box = $("cv-list");
  if (!cv || !cv.linked) {
    box.innerHTML = '<div class="cv-empty">link canvas<br>to see assignments</div>';
    return;
  }
  const items = cv.items || [];
  if (!items.length) {
    box.innerHTML = '<div class="cv-empty">🎉 all caught up</div>';
    return;
  }
  box.innerHTML = items.slice(0, 6).map((a) => {
    const { label, cls } = dueInfo(a.due);
    return `<div class="cv-item ${cls}"><div class="cv-main">` +
           `<div class="cv-title">${esc(a.title)}</div>` +
           `<div class="cv-course">${esc(a.course)}</div></div>` +
           `<div class="cv-due">${label}</div></div>`;
  }).join("");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function renderHistory(alerts) {
  const list = $("history-list");
  if (!list) return;
  const items = (alerts && alerts.history) || [];
  if (!items.length) {
    list.innerHTML = '<div class="hist-empty">no alerts yet</div>';
  } else {
    list.innerHTML = items.slice(0, 5).map((e) =>
      `<div class="hist-item ${esc(e.kind || "")}">` +
      `<div class="hist-dot"></div><div class="hist-copy">` +
      `<b>${esc(e.title)}</b><span>${esc(e.detail || ago(e.ts))}</span>` +
      `</div><time>${ago(e.ts)}</time></div>`
    ).join("");
  }
  $("control-state").textContent =
    `${alerts && alerts.muted ? "muted" : "sound on"} · ` +
    `${alerts && alerts.flash === false ? "flash off" : "flash on"}`;
}

// ---- claude usage (mirrors the standalone claude screen, compact) ----
function fmtTokens(n) {
  if (n == null) return null;
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n);
}

function drawSpark(vals) {
  const poly = document.querySelector("#dc-spark polyline");
  if (!poly) return;
  if (!vals || vals.length < 2) { poly.setAttribute("points", ""); return; }
  const n = vals.length;
  poly.setAttribute("points", vals.map((v, i) => {
    const x = (i / (n - 1)) * 100;
    const y = 24 - (Math.max(0, Math.min(100, v)) / 100) * 24;
    return x.toFixed(1) + "," + y.toFixed(1);
  }).join(" "));
}

function renderClaude(c) {
  c = c || {};
  const card = $("dash-claude");
  const fill = document.querySelector("#dash-claude .dc-track i");
  const pctEl = $("dc-pct");
  const sub = $("dc-sub");
  if (!card) return;

  drawSpark(c.spark);

  // token count · which machine the session is on
  const tok = fmtTokens(c.tokens);
  $("dc-tok").textContent = tok
    ? `${tok} · ${c.model || "claude"}`
    : (c.model || "");
  $("dc-host").textContent = c.host || "";

  if (c.pct == null) {
    fill.style.width = "0%";
    card.classList.remove("warn", "hot");
    pctEl.textContent = c.linked === false ? "—" : "idle";
    sub.textContent = c.linked === false ? "not logged in" : "no session yet";
    return;
  }

  const pct = Math.max(0, Math.min(100, c.pct));
  fill.style.width = pct + "%";
  pctEl.textContent = Math.round(pct) + "%";
  sub.textContent = c.active ? "context used" : "context used · idle";
  card.classList.toggle("warn", pct >= 60 && pct < 85);
  card.classList.toggle("hot", pct >= 85);
}

function render(d) {
  // weather
  const w = d.weather;
  if (w) {
    $("wx-temp").textContent = w.temp_c + "°";
    $("wx-label").textContent = w.label;
    $("wx-meta").textContent =
      (w.city ? w.city + "\n" : "") + `H:${w.hi}°  L:${w.lo}°`;
    drawWx(w.icon);
    if (w.humidity != null) {
      $("wx-hum").textContent = w.humidity + "%";
      $("wx-hum-bar").style.width = w.humidity + "%";
    }
    if (w.wind_kmh != null) $("wx-wind").textContent = w.wind_kmh + " km/h";
    if (w.sunrise) $("wx-sunrise").textContent = w.sunrise;
    if (w.sunset)  $("wx-sunset").textContent = w.sunset;
  } else {
    $("wx-label").textContent = "no data";
  }

  // system
  const s = d.system || {};
  setGauge("cpu", s.cpu_pct ?? 0, (s.cpu_pct ?? "—") + "%", lvl(s.cpu_pct ?? 0));
  setGauge("mem", s.mem_pct ?? 0, (s.mem_pct ?? "—") + "%", lvl(s.mem_pct ?? 0));
  const t = s.temp_c;
  setGauge("temp", t == null ? 0 : Math.min(100, (t / 85) * 100),
           t == null ? "—" : t + "°",
           t == null ? "" : t > 70 ? "hot" : t > 55 ? "warn" : "");
  setGauge("disk", s.disk_pct ?? 0, (s.disk_pct ?? "—") + "%", lvl(s.disk_pct ?? 0));
  $("uptime").textContent = fmtUptime(s.uptime_s);

  // bot
  const b = d.bot || {};
  $("bot-dot").classList.toggle("ok", !!b.running);
  $("bot-mode").textContent = b.mode || "—";
  $("bot-mode").classList.toggle("alert", b.mode === "alert");
  $("bot-opps").textContent = b.opportunities ?? "—";
  $("bot-poll").textContent = ago(b.last_poll);

  // claude usage (context-used bar of the latest local session)
  renderClaude(d.claude);

  // the shell owns body.alert / the beep; the pet still reacts to claimables
  const a = d.alerts || {};
  const alerting = (b.claimable || 0) > 0 || !!a.test;

  if (pet) pet.celebrate(alerting);

  renderHistory(a);
  renderCanvas(d.canvas);
}
