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

        <!-- network + sessions (the cat still roams the whole screen) -->
        <section id="net-card" class="card">
          <h2>network <span class="pulse">🖧</span></h2>
          <div class="net-rates">
            <span class="net-rate down"><b id="net-down">—</b><span>▼ down</span></span>
            <span class="net-rate up"><b id="net-up">—</b><span>▲ up</span></span>
          </div>
          <svg id="net-spark" viewBox="0 0 100 30" preserveAspectRatio="none">
            <polyline class="sp-down" points=""></polyline>
            <polyline class="sp-up" points=""></polyline>
          </svg>
          <div id="net-sess" class="net-sess"></div>
          <div class="net-foot"><span id="net-ip">—</span><span id="net-iface"></span></div>
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
          <div class="bot-beat">
            <span class="bb-lbl">heartbeat</span>
            <svg id="bot-ecg" viewBox="0 0 120 22" preserveAspectRatio="none"></svg>
          </div>
        </section>

        <!-- claude usage (live /usage plan limits) -->
        <section id="dash-claude" class="card">
          <h2>claude <img class="pulse claude-glyph" src="claude.svg" alt="" /></h2>
          <div class="dc-body">
            <div class="dc-plan"><b id="dc-plan">—</b><span id="dc-model"></span></div>

            <div class="dc-lim" id="dc-session">
              <div class="dc-lim-top"><span class="dc-lim-lbl">session · 5h</span>
                <b class="dc-lim-pct">—</b></div>
              <div class="dc-track"><i></i></div>
              <div class="dc-lim-reset">resets —</div>
            </div>

            <div class="dc-lim" id="dc-week">
              <div class="dc-lim-top"><span class="dc-lim-lbl">this week</span>
                <b class="dc-lim-pct">—</b></div>
              <div class="dc-track"><i></i></div>
              <div class="dc-lim-reset">resets —</div>
            </div>

            <div class="dc-meta">
              <span id="dc-ctx">ctx —</span>
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
let calDays = new Set();   // 'YYYY-MM-DD's with a calendar event (from payload)

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` +
         `-${String(d.getDate()).padStart(2, "0")}`;
}

// Light up the week cells that have events. Runs after buildWeek and whenever a
// fresh payload lands, since either the week or the event set can change first.
function markWeek() {
  document.querySelectorAll("#week .wk").forEach((el) => {
    el.classList.toggle("has-ev", calDays.has(el.dataset.date));
  });
}

function buildWeek(d) {
  const start = new Date(d); start.setDate(d.getDate() - d.getDay());
  let html = "";
  for (let i = 0; i < 7; i++) {
    const day = new Date(start); day.setDate(start.getDate() + i);
    const today = day.toDateString() === d.toDateString();
    html += `<div class="wk" data-date="${isoDate(day)}"><div class="wd">${WD[i]}</div>` +
            `<div class="dn${today ? " today" : ""}">${day.getDate()}</div></div>`;
  }
  $("week").innerHTML = html;
  markWeek();
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

// ---- network throughput + sessions ----
function fmtRate(kbps) {
  if (kbps == null) return "—";
  if (kbps >= 1024) return (kbps / 1024).toFixed(1) + " MB/s";
  if (kbps >= 100)  return Math.round(kbps) + " KB/s";
  return kbps.toFixed(kbps < 10 ? 1 : 0) + " KB/s";
}

// ECG-style heartbeat of the bot's recent polls: a flatline of tiny blips
// (one per poll) with a tall orange spike wherever a claimable was found.
function renderBeat(polls) {
  const svg = $("bot-ecg");
  if (!svg) return;
  const W = 120, BASE = 17, LOW = 12, HIGH = 3;
  if (!polls.length) {
    svg.innerHTML = `<line x1="0" y1="${BASE}" x2="${W}" y2="${BASE}" class="ecg-flat"/>`;
    return;
  }
  const step = W / polls.length;
  let pts = [`0,${BASE}`];
  const spikes = [];
  polls.forEach((p, i) => {
    const x = (i + 0.5) * step;
    const peak = p.c > 0 ? HIGH : LOW;
    pts.push(`${(x - step * 0.28).toFixed(1)},${BASE}`,
             `${x.toFixed(1)},${peak}`,
             `${(x + step * 0.28).toFixed(1)},${BASE}`);
    if (p.c > 0) spikes.push(`<circle cx="${x.toFixed(1)}" cy="${HIGH}" r="1.8" class="ecg-hit"/>`);
  });
  pts.push(`${W},${BASE}`);
  svg.innerHTML =
    `<polyline class="ecg-trace" points="${pts.join(" ")}"/>` + spikes.join("");
}

function renderNet(net) {
  net = net || {};
  $("net-down").textContent = fmtRate(net.down_kbps);
  $("net-up").textContent = fmtRate(net.up_kbps);

  // Down and up share one vertical scale so the two lines are comparable.
  const dn = net.spark_down || [], up = net.spark_up || [];
  const max = Math.max(1, ...dn, ...up);
  const pts = (vals) => {
    if (!vals || vals.length < 2) return "";
    const n = vals.length;
    return vals.map((v, i) =>
      `${((i / (n - 1)) * 100).toFixed(1)},${(30 - (v / max) * 30).toFixed(1)}`
    ).join(" ");
  };
  document.querySelector("#net-spark .sp-down").setAttribute("points", pts(dn));
  document.querySelector("#net-spark .sp-up").setAttribute("points", pts(up));

  const sess = net.sessions || [];
  const box = $("net-sess");
  box.innerHTML = sess.length
    ? sess.map((s) => `<div class="sess"><i></i><span>${esc(s.user)}</span>` +
        `<span class="src">${esc(s.from)}</span></div>`).join("")
    : '<div class="none">no active sessions</div>';

  $("net-ip").textContent = net.ip || "—";
  $("net-iface").textContent = net.iface || "";
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

// "resets in 42m" / "resets in 8h 20m" / "resets Sun 11am" from an ISO string.
function fmtReset(iso) {
  if (!iso) return "resets —";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "resets —";
  const s = Math.floor((t - Date.now()) / 1000);
  if (s <= 0) return "resetting…";
  if (s < 3600) return "resets in " + Math.ceil(s / 60) + "m";
  if (s < 86400) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return "resets in " + h + "h" + (m ? " " + m + "m" : "");
  }
  const d = new Date(t);
  let h = d.getHours(); const ap = h < 12 ? "am" : "pm"; h = h % 12 || 12;
  const mm = d.getMinutes();
  return "resets " + DAYS[d.getDay()].slice(0, 3) + " " + h +
         (mm ? ":" + String(mm).padStart(2, "0") : "") + ap;
}

// Fill one .dc-lim block (session or week) from a utilization % + reset time.
function setLimit(id, pct, reset) {
  const el = $(id);
  if (!el) return;
  const has = pct != null;
  const p = has ? Math.max(0, Math.min(100, pct)) : 0;
  el.querySelector(".dc-lim-pct").textContent = has ? Math.round(p) + "%" : "—";
  el.querySelector(".dc-track i").style.width = p + "%";
  el.querySelector(".dc-lim-reset").textContent = has ? fmtReset(reset) : "resets —";
  el.classList.toggle("warn", p >= 50 && p < 80);
  el.classList.toggle("hot", p >= 80);
}

function renderClaude(c) {
  c = c || {};
  if (!$("dash-claude")) return;

  setLimit("dc-session", c.session_pct, c.session_reset);
  setLimit("dc-week", c.week_pct, c.week_reset);

  $("dc-plan").textContent =
    c.plan ? "Claude " + c.plan : (c.linked === false ? "not logged in" : "Claude");
  $("dc-model").textContent = c.model || "";

  // context of the most recent local session, kept as a small extra line
  const tok = fmtTokens(c.tokens);
  $("dc-ctx").textContent = c.pct == null
    ? "ctx —"
    : "ctx " + Math.round(c.pct) + "%" + (tok ? " · " + tok : "");
  $("dc-host").textContent = c.host || "";
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
  renderBeat(b.polls || []);

  // claude usage (context-used bar of the latest local session)
  renderClaude(d.claude);

  // the shell owns body.alert / the beep; the pet still reacts to claimables
  const a = d.alerts || {};
  const alerting = (b.claimable || 0) > 0 || !!a.test;

  if (pet) pet.celebrate(alerting);

  renderHistory(a);
  renderNet(d.net);

  // week-strip event dots
  calDays = new Set((d.calendar && d.calendar.days) || []);
  markWeek();
}
