/* Claude Code usage: context-window fill of the most recent local session,
   read by the server from ~/.claude. This is the "context used" bar, not the
   /usage plan limit -- that number isn't stored on disk to read. Data is
   pushed from shell.js (also replayed on mount); no timers of our own. */
registerScreen({
  id: "claude",
  label: "Claude Usage",

  html: `<div class="claude-screen">
           <div class="claude-card">
             <img class="claude-icon" src="claude.svg" alt="" />
             <div class="claude-title">CLAUDE CODE</div>
             <div class="claude-bar"><i></i></div>
             <div class="claude-pct">--</div>
             <div class="claude-sub">context used</div>
           </div>
         </div>`,

  data(d) {
    const c = (d && d.claude) || {};
    const card = document.querySelector(".claude-card");
    const fill = document.querySelector(".claude-bar i");
    const pctEl = document.querySelector(".claude-pct");
    const sub = document.querySelector(".claude-sub");
    if (!card) return;

    if (c.pct == null) {
      fill.style.width = "0%";
      card.classList.remove("warn", "hot");
      pctEl.textContent = c.linked === false ? "—" : "idle";
      sub.textContent = c.linked === false
        ? "log into Claude on the Pi"
        : "no session yet";
      return;
    }

    const pct = Math.max(0, Math.min(100, c.pct));
    fill.style.width = pct + "%";
    pctEl.textContent = Math.round(pct) + "%";
    sub.textContent = c.active ? "context used" : "context used · idle";
    card.classList.toggle("warn", pct >= 60 && pct < 85);
    card.classList.toggle("hot", pct >= 85);
  },
});
