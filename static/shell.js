/* Kiosk shell: owns the single /api/stats poll, the global alert (flash/beep),
   and screen swapping. Screens never poll — they get data pushed to them.

   Adding a screen: create static/screens/<id>.js calling registerScreen({...})
   and add {"id": ..., "label": ...} to SCREENS in server.py. Nothing else.

     registerScreen({
       id, label,
       html,              // markup injected into #screen-root before mount
       mount(root, ctx),  // ctx.every/ctx.frame/ctx.petLayer — see below
       unmount(),         // optional; timers started via ctx are auto-cleared
       data(d),           // latest /api/stats payload (also replayed on mount)
     })

   Timers started with ctx.every()/ctx.frame() are cancelled automatically on
   unmount. Use them instead of setInterval/requestAnimationFrame — a screen
   that leaks a timer means ghost animations and climbing CPU after a few swaps. */
(function () {
  const REG = {};
  window.registerScreen = (s) => { REG[s.id] = s; };

  const root = document.getElementById("screen-root");
  const petLayer = document.getElementById("petlayer");

  let cur = null;        // active screen object
  let ctx = null;        // active screen's timer context
  let last = null;       // most recent payload, replayed to a freshly mounted screen
  let reloadToken = null;
  let wasAlerting = false;

  // ---- per-screen timer bookkeeping ----
  function makeCtx() {
    const intervals = [], frames = [];
    let dead = false;
    return {
      petLayer,
      every(fn, ms) {
        const id = setInterval(() => { if (!dead) fn(); }, ms);
        intervals.push(id);
        return id;
      },
      frame(fn) {                       // self-rescheduling rAF loop
        const tick = (t) => { if (dead) return; fn(t); frames.push(requestAnimationFrame(tick)); };
        frames.push(requestAnimationFrame(tick));
      },
      _kill() {
        dead = true;
        intervals.forEach(clearInterval);
        frames.forEach(cancelAnimationFrame);
      },
    };
  }

  function loadScript(src) {
    return new Promise((ok, fail) => {
      const t = document.createElement("script");
      t.src = src;
      t.onload = ok;
      t.onerror = () => fail(new Error("failed to load " + src));
      document.head.appendChild(t);
    });
  }

  async function show(id) {
    if (cur && cur.id === id) return;
    if (!REG[id]) {
      try { await loadScript(`screens/${id}.js`); }
      catch (e) { console.error(e); return; }     // keep the current screen
    }
    const next = REG[id];
    if (!next) { console.error("screen did not register:", id); return; }

    if (cur) {
      if (cur.unmount) { try { cur.unmount(); } catch (e) { console.error(e); } }
      if (ctx) ctx._kill();
    }
    root.innerHTML = next.html || "";
    cur = next;
    ctx = makeCtx();
    if (cur.mount) cur.mount(root, ctx);
    if (last && cur.data) cur.data(last);
  }

  // ---- global alert: fires on every screen, not just the dashboard ----
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
    } catch (e) { /* audio may be blocked; the visual flash still fires */ }
  }

  function handleAlert(d) {
    const a = d.alerts || {};
    const alerting = (d.bot && d.bot.claimable > 0) || !!a.test;
    document.body.classList.toggle("alert", alerting && a.flash !== false);
    if (alerting && !wasAlerting && !a.muted) beep();
    wasAlerting = alerting;
    return alerting;
  }

  async function poll() {
    let d;
    try {
      d = await (await fetch("/api/stats", { cache: "no-store" })).json();
    } catch (e) {
      document.body.classList.add("offline");
      return;
    }
    document.body.classList.remove("offline");
    last = d;

    // Reload only on a forward token change, so a service restart (which resets
    // the token to 0) can't put a crash-looping kiosk into a reload loop.
    if (reloadToken === null) reloadToken = d.reload_token;
    else if (d.reload_token > reloadToken) { location.reload(); return; }

    handleAlert(d);
    if (d.screen && (!cur || d.screen !== cur.id)) await show(d.screen);
    if (cur && cur.data) cur.data(d);
  }

  poll();
  setInterval(poll, 5000);
})();
