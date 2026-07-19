/* Roaming pixel cat. Wanders the WHOLE screen, naps in its bed (the pet-card
   rug), gets the zoomies, pounces, grooms, and emits hearts/sparkles/Zzz.
   Gets excited (meows + fast pacing) when the bot has a claimable opportunity.
   Sprite sheet: static/cat.png — 32px frames, 3x scale (96px on screen). */
(function () {
  const SCALE = 3;
  const SP = 32 * SCALE;              // on-screen sprite size (96)
  const layer = document.getElementById("petlayer");
  const cat = document.getElementById("cat");
  const sayEl = document.getElementById("cat-say");

  // clip -> {row, frames} (matches how cat.png was assembled)
  const CLIPS = {
    walk_down:  { row: 0, frames: 4 },
    walk_up:    { row: 1, frames: 4 },
    walk_right: { row: 2, frames: 8 },
    walk_left:  { row: 3, frames: 8 },
    sit:        { row: 4, frames: 8 },
    groom:      { row: 5, frames: 9 },
    meow:       { row: 6, frames: 3 },
  };

  // cute things the cat says, picked at random
  const MEOWS  = ["meow~", "mrrp?", "nya~", "prrr…", "mew!", "hi ej!"];
  const HAPPY  = ["♥", "✨", "★", "♪"];

  let clip = "sit", frame = 0, frameT = 0, fps = 6;
  let x = 40, y = 90, target = null;
  let mode = "idle", modeUntil = 0;     // walk | idle | meow | nap | zoomies
  let zoomsLeft = 0;
  let excited = false;
  let sayUntil = 0;
  let fxT = 0;
  let lastT = performance.now();

  function bounds() {
    return { w: window.innerWidth - SP, h: window.innerHeight - SP };
  }

  // center of the cat bed (the pet-card rug), in screen coords
  function bedTarget() {
    const r = document.getElementById("pet-card").getBoundingClientRect();
    return { x: r.left + r.width / 2 - SP / 2, y: r.top + r.height / 2 - SP / 2 };
  }

  function setClip(name, fpsOverride) {
    if (clip !== name) { clip = name; frame = 0; frameT = 0; }
    fps = fpsOverride || (name.startsWith("walk") ? 9 : 5);
  }

  function say(text, ms) {
    sayEl.textContent = text || "";
    sayEl.classList.toggle("show", !!text);
    sayUntil = text ? performance.now() + (ms || 1600) : 0;
  }

  // spawn a little emoji that floats up from the cat's head
  function fx(emoji) {
    const p = document.createElement("div");
    p.className = "cat-fx";
    p.textContent = emoji;
    p.style.left = Math.round(x + SP / 2) + "px";
    p.style.top = Math.round(y + 6) + "px";
    layer.appendChild(p);
    setTimeout(() => p.remove(), 1500);
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function pickTarget() {
    const b = bounds();
    target = { x: Math.random() * Math.max(1, b.w), y: Math.random() * Math.max(1, b.h) };
  }

  function startWalking() { pickTarget(); mode = "walk"; }

  function startZoomies() {
    mode = "zoomies";
    zoomsLeft = 4 + Math.floor(Math.random() * 4);
    pickTarget();
    say(pick(["ZOOMIES!", "wheee!", "zzzoom!"]), 1200);
    fx("💨");
  }

  function startNap() {
    mode = "walk"; target = bedTarget(); target._nap = true;
    setClip("walk_down");
  }

  function startIdle() {
    mode = "idle";
    const roll = Math.random();
    if (roll < 0.4) { setClip("groom"); say("*lick lick*", 1800); }
    else            { setClip("sit"); say(""); }
    modeUntil = performance.now() + 2500 + Math.random() * 4000;
  }

  // decide what to do after an idle spell
  function nextAction(now) {
    const roll = Math.random();
    if (roll < 0.18) startZoomies();
    else if (roll < 0.34) startNap();
    else if (roll < 0.55) { setClip("meow"); say(pick(MEOWS)); modeUntil = now + 1200; mode = "meow"; }
    else startWalking();
  }

  function step(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    if (sayUntil && now > sayUntil) say("");

    if (excited) { say("mrrp! claimable!", 800); }

    if (mode === "walk" || mode === "zoomies") {
      const zoom = mode === "zoomies";
      const speed = excited ? 130 : zoom ? 210 : 44;   // px/sec
      const dx = target.x - x, dy = target.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist < 4) {
        if (target && target._nap) {                    // reached the bed
          mode = "nap"; setClip("sit", 3);
          modeUntil = now + 8000 + Math.random() * 8000;
          say("Zzz…", 2000); fxT = now;
        } else if (excited) { pickTarget(); }
        else if (zoom) {
          if (--zoomsLeft > 0) { pickTarget(); if (Math.random() < 0.4) fx(pick(HAPPY)); }
          else startIdle();
        } else startIdle();
      } else {
        const mvx = (dx / dist) * speed * dt;
        const mvy = (dy / dist) * speed * dt;
        x += mvx; y += mvy;
        const fpsW = excited ? 14 : zoom ? 16 : 9;
        if (Math.abs(dx) > Math.abs(dy)) setClip(dx < 0 ? "walk_left" : "walk_right", fpsW);
        else                              setClip(dy < 0 ? "walk_up" : "walk_down", fpsW);
      }
    } else if (mode === "nap") {
      if (now - fxT > 1400) { fx("💤"); fxT = now; }     // drift Zzz upward
      if (now > modeUntil) { fx("♥"); startIdle(); }
    } else if (mode === "idle") {
      if (excited) startWalking();
      else {
        if (Math.random() < 0.004) fx(pick(HAPPY));      // occasional happy sparkle
        if (now > modeUntil) nextAction(now);
      }
    } else if (mode === "meow" && now > modeUntil) {
      startWalking();
    }

    // advance frame
    frameT += dt;
    if (frameT > 1 / fps) { frameT = 0; frame = (frame + 1) % CLIPS[clip].frames; }

    // draw
    const c = CLIPS[clip];
    cat.style.backgroundPosition = `-${frame * SP}px -${c.row * SP}px`;
    cat.style.left = Math.round(x) + "px";
    cat.style.top = Math.round(y) + "px";
    sayEl.style.left = Math.round(x + SP / 2) + "px";
    sayEl.style.top = Math.round(y - 8) + "px";

    requestAnimationFrame(step);
  }

  // called by app.js when claimable status changes
  window.petCelebrate = (on) => {
    if (on && !excited) { excited = true; fx("❗"); startWalking(); }
    if (!on && excited) { excited = false; say(""); startIdle(); }
  };

  startIdle();
  requestAnimationFrame(step);
})();
