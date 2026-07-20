/* Full-screen assignments list — the dashboard's canvas card only shows 6
   items in a small box; this shows everything the server fetched (up to 20),
   two columns, sized to fit the fixed 1024x600 kiosk viewport with no scroll.
   Self-contained on purpose: screens are lazy-loaded independently, so this
   can't rely on dashboard.js having run first (e.g. if this is the boot
   screen), hence its own small esc()/dueInfo() copies below. */
registerScreen({
  id: "assignments",
  label: "Assignments",

  html: `
  <div class="assign-screen">
    <header class="assign-head">
      <div class="assign-title">📚 assignments</div>
      <div class="assign-sub" id="ax-sub"></div>
    </header>
    <div class="assign-card card">
      <div id="ax-list" class="ax-list"><div class="cv-empty">loading…</div></div>
      <div id="ax-more" class="ax-more"></div>
    </div>
  </div>`,

  mount(root, ctx) {
    pet = createPet(ctx.petLayer);
  },

  unmount() {
    if (pet) { pet.stop(); pet = null; }
  },

  data(d) { render(d.canvas); },
});

let pet = null;
const AX_LIMIT = 14;

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

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

function render(cv) {
  const list = document.getElementById("ax-list");
  const more = document.getElementById("ax-more");
  const sub = document.getElementById("ax-sub");
  if (!list) return;

  if (!cv || !cv.linked) {
    list.innerHTML = '<div class="cv-empty">link canvas<br>to see assignments</div>';
    more.textContent = "";
    sub.textContent = "";
    return;
  }

  const items = cv.items || [];
  if (!items.length) {
    list.innerHTML = '<div class="cv-empty">🎉 all caught up</div>';
    more.textContent = "";
    sub.textContent = "";
    return;
  }

  sub.textContent = `${items.length} upcoming`;
  list.innerHTML = items.slice(0, AX_LIMIT).map((a) => {
    const { label, cls } = dueInfo(a.due);
    return `<div class="cv-item ${cls}"><div class="cv-main">` +
           `<div class="cv-title">${esc(a.title)}</div>` +
           `<div class="cv-course">${esc(a.course)}</div></div>` +
           `<div class="cv-due">${label}</div></div>`;
  }).join("");

  const rest = items.length - AX_LIMIT;
  more.textContent = rest > 0 ? `+${rest} more due later` : "";
}
