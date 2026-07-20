/* Roaming pixel cat. Wanders the WHOLE screen, naps, gets the zoomies, grooms,
   and emits hearts/sparkles/Zzz. Sprite sheet: static/cat.png — 32px frames,
   3x scale (96px on screen).

   createPet(layer, opts) -> { stop(), celebrate(on) }
     layer   element to append the cat into (usually #petlayer)
     opts.bed    () => ({x, y}) | null   where to nap; null = nap in place
     opts.speed  walk px/sec (default 44)
     opts.says   array of things it says
   Multiple pets can share one layer — that's what the cats screen uses. */
(function () {
  const SCALE = 3;
  const SP = 32 * SCALE;              // on-screen sprite size (96)

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

  const MEOWS = ["meow~", "mrrp?", "nya~", "prrr…", "mew!", "hi ej!"];
  const HAPPY = ["♥", "✨", "★", "♪"];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  window.createPet = function (layer, opts) {
    opts = opts || {};
    const bed = opts.bed || null;         // null -> naps where it stands (no DOM lookup)
    const baseSpeed = opts.speed || 44;
    const says = opts.says || MEOWS;

    const cat = document.createElement("div");
    cat.className = "cat";
    const sayEl = document.createElement("div");
    sayEl.className = "cat-say";
    layer.appendChild(cat);
    layer.appendChild(sayEl);

    let clip = "sit", frame = 0, frameT = 0, fps = 6;
    let x = Math.random() * 300 + 40, y = Math.random() * 200 + 90, target = null;
    let mode = "idle", modeUntil = 0;
    let zoomsLeft = 0;
    let excited = false;
    let sayUntil = 0;
    let fxT = 0;
    let lastT = performance.now();
    let raf = null, alive = true;

    function bounds() {
      return { w: window.innerWidth - SP, h: window.innerHeight - SP };
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

    function fx(emoji) {
      const p = document.createElement("div");
      p.className = "cat-fx";
      p.textContent = emoji;
      p.style.left = Math.round(x + SP / 2) + "px";
      p.style.top = Math.round(y + 6) + "px";
      layer.appendChild(p);
      setTimeout(() => p.remove(), 1500);
    }

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

    // A missing bed used to throw here and kill the whole animation loop.
    // Now the cat just curls up wherever it is.
    function startNap() {
      const spot = bed && bed();
      if (!spot) {
        mode = "nap"; setClip("sit", 3);
        modeUntil = performance.now() + 8000 + Math.random() * 8000;
        say("Zzz…", 2000); fxT = performance.now();
        return;
      }
      mode = "walk"; target = { x: spot.x, y: spot.y, _nap: true };
      setClip("walk_down");
    }

    function startIdle() {
      mode = "idle";
      if (Math.random() < 0.4) { setClip("groom"); say("*lick lick*", 1800); }
      else                     { setClip("sit"); say(""); }
      modeUntil = performance.now() + 2500 + Math.random() * 4000;
    }

    function nextAction(now) {
      const roll = Math.random();
      if (roll < 0.18) startZoomies();
      else if (roll < 0.34) startNap();
      else if (roll < 0.55) { setClip("meow"); say(pick(says)); modeUntil = now + 1200; mode = "meow"; }
      else startWalking();
    }

    function step(now) {
      if (!alive) return;
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      if (sayUntil && now > sayUntil) say("");
      if (excited) say("mrrp! claimable!", 800);

      if (mode === "walk" || mode === "zoomies") {
        const zoom = mode === "zoomies";
        const speed = excited ? 130 : zoom ? 210 : baseSpeed;
        const dx = target.x - x, dy = target.y - y;
        const dist = Math.hypot(dx, dy);
        if (dist < 4) {
          if (target && target._nap) {
            mode = "nap"; setClip("sit", 3);
            modeUntil = now + 8000 + Math.random() * 8000;
            say("Zzz…", 2000); fxT = now;
          } else if (excited) { pickTarget(); }
          else if (zoom) {
            if (--zoomsLeft > 0) { pickTarget(); if (Math.random() < 0.4) fx(pick(HAPPY)); }
            else startIdle();
          } else startIdle();
        } else {
          x += (dx / dist) * speed * dt;
          y += (dy / dist) * speed * dt;
          // Tie leg-cycle rate to actual speed (~5px of travel per animation
          // frame) so faster gaits (zoomies, excited chase) don't outrun the
          // walk cycle and look like sliding/moonwalking.
          const fpsW = speed / 5;
          if (Math.abs(dx) > Math.abs(dy)) setClip(dx < 0 ? "walk_left" : "walk_right", fpsW);
          else                              setClip(dy < 0 ? "walk_up" : "walk_down", fpsW);
        }
      } else if (mode === "nap") {
        if (now - fxT > 1400) { fx("💤"); fxT = now; }
        if (now > modeUntil) { fx("♥"); startIdle(); }
      } else if (mode === "idle") {
        if (excited) startWalking();
        else {
          if (Math.random() < 0.004) fx(pick(HAPPY));
          if (now > modeUntil) nextAction(now);
        }
      } else if (mode === "meow" && now > modeUntil) {
        startWalking();
      }

      frameT += dt;
      if (frameT > 1 / fps) { frameT = 0; frame = (frame + 1) % CLIPS[clip].frames; }

      const c = CLIPS[clip];
      cat.style.backgroundPosition = `-${frame * SP}px -${c.row * SP}px`;
      cat.style.left = Math.round(x) + "px";
      cat.style.top = Math.round(y) + "px";
      sayEl.style.left = Math.round(x + SP / 2) + "px";
      sayEl.style.top = Math.round(y - 8) + "px";

      raf = requestAnimationFrame(step);
    }

    startIdle();
    raf = requestAnimationFrame(step);

    return {
      celebrate(on) {
        if (on && !excited) { excited = true; fx("❗"); startWalking(); }
        if (!on && excited) { excited = false; say(""); startIdle(); }
      },
      stop() {
        alive = false;
        if (raf) cancelAnimationFrame(raf);
        cat.remove();
        sayEl.remove();
      },
    };
  };
})();
