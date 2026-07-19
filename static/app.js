/* Dashboard logic: clock ticks locally; /api/stats polled every 5s. */
(function () {
  const $ = (id) => document.getElementById(id);

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
    let h = d.getHours();
    const ap = h < 12 ? "AM" : "PM";
    const h12 = h % 12 || 12;
    const mm = String(d.getMinutes()).padStart(2, "0");
    $("time").textContent = `${h12}:${mm}`;
    $("ampm").textContent = ap;
    $("date").textContent = `${DAYS[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;
    if (d.getDate() !== lastDay) { buildWeek(d); lastDay = d.getDate(); }
  }
  tickClock();
  setInterval(tickClock, 1000);

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

  // ---- alert beep (WebAudio, no asset) ----
  let audioCtx = null;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "square"; o.frequency.value = 880;
      o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.05, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
      o.start(); o.stop(audioCtx.currentTime + 0.25);
    } catch (e) { /* audio may be blocked; visual alert still fires */ }
  }

  let wasClaimable = false;

  async function poll() {
    try {
      const r = await fetch("/api/stats", { cache: "no-store" });
      const d = await r.json();
      render(d);
    } catch (e) {
      $("bot-dot").classList.remove("ok");
    }
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
    const claim = b.claimable || 0;
    $("claim-n").textContent = claim;

    const alerting = claim > 0;
    document.body.classList.toggle("alert", alerting);
    $("claim-card").classList.toggle("alert", alerting);
    window.petCelebrate && window.petCelebrate(alerting);

    if (alerting && !wasClaimable) beep();
    wasClaimable = alerting;
  }

  poll();
  setInterval(poll, 5000);
})();
