#!/usr/bin/env python3
"""Cozy pixel-art Pi dashboard backend.

Serves the static pixel-art page and a /api/stats JSON feed the page polls.
Stdlib only -- no pip installs. System stats read straight from /proc + /sys,
weather from no-key public APIs, bot status parsed from journald.

Usage:
    python3 server.py            # real data (run this on the Pi)
    python3 server.py --demo     # synthetic bot/weather for dev on any box
"""

import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
PORT = 8080
# 0.0.0.0 so phones on the LAN can reach it. Once the Cloudflare tunnel is up,
# set BIND=127.0.0.1 in the unit's EnvironmentFile -- cloudflared connects to
# localhost, and that is what makes trusting the Access header safe.
BIND = os.environ.get("BIND", "0.0.0.0")
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

# Set to "lat,lon" (e.g. "51.5,-0.12") to hardcode weather location.
# Left as None -> auto-detect from the Pi's public IP once at startup.
LOCATION = "33.83,-118.05"  # Fullerton / Long Beach area, CA

# Syslog identifier the bot logs under (from `run.sh[17947]: ...`).
BOT_IDENTIFIER = "run.sh"

# Canvas: token is a secret -> read from env, never committed.
#   CANVAS_TOKEN  personal access token (Account > Settings > New Access Token)
#   CANVAS_URL    school host, e.g. https://csufullerton.instructure.com
CANVAS_TOKEN = os.environ.get("CANVAS_TOKEN", "")
CANVAS_URL = os.environ.get("CANVAS_URL", "https://csufullerton.instructure.com").rstrip("/")

DEMO = "--demo" in sys.argv[1:]

# Turn on once the Cloudflare tunnel is live (REQUIRE_AUTH=1 in the unit's
# EnvironmentFile). Off by default so LAN-only setups keep working untouched.
REQUIRE_AUTH = os.environ.get("REQUIRE_AUTH", "") not in ("", "0", "false")

WEATHER_TTL = 600  # seconds
_weather_cache = {"t": 0, "data": None}
_latlon = None  # resolved once

CANVAS_TTL = 900  # seconds -- Canvas is many requests; poll it rarely
_canvas_cache = {"t": 0, "data": None}

BOT_TTL = 3  # seconds -- see bot_status()
_bot_cache = {"t": 0, "data": None}

# Claude Code context-window usage, read from the most recent local transcript
# under ~/.claude. Cheap (one tail read) so a short cache is plenty.
CLAUDE_TTL = 5  # seconds
_claude_cache = {"t": 0, "data": None}
CLAUDE_PROJECTS = os.path.expanduser("~/.claude/projects")
CONTEXT_WINDOW = 200000  # Opus/Sonnet auto-compact window

# Sparkline of recent context%. In-memory (a reboot starts fresh); one point
# every CLAUDE_HISTORY_EVERY seconds keeps the trend readable, not jittery.
CLAUDE_HISTORY_MAX = 60
CLAUDE_HISTORY_EVERY = 30
_claude_history = []  # [(ts, pct)]

# A session on another machine (e.g. the laptop) reports here via POST /api/claude.
# The card shows whichever machine -- local disk or remote -- was active most
# recently, so a laptop session becomes visible on the Pi. We compare each
# side's last-activity time (transcript mtime); `recv` is only a liveness guard
# so a dead reporter's last report stops counting after REMOTE_TTL.
REMOTE_TTL = 90  # seconds: drop a remote report if the reporter goes silent
_remote_claude = {"data": None, "recv": 0.0, "ts": 0.0}
LOCAL_HOST = os.environ.get("HOST_LABEL") or socket.gethostname()

ALERT_HISTORY_LIMIT = 12
_alert_history = []
_seen_alert_keys = set()
_last_claimable = None
_last_running = None

# Kiosk screens. One entry here + one file at static/screens/<id>.js is all a
# new screen needs -- see README.
SCREENS = [
    {"id": "dashboard", "label": "Dashboard"},
    {"id": "assignments", "label": "Assignments"},
    {"id": "cats", "label": "Cats Chilling"},
    {"id": "claude", "label": "Claude Usage"},
]
_SCREEN_IDS = {s["id"] for s in SCREENS}

_control = {
    "muted": False,
    "flash": True,
    "test_until": 0,
    "screen": "dashboard",
    "reload_token": 0,
}

# Survives restarts so a reboot doesn't silently revert screen/mute choices.
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state.json")
_PERSIST_KEYS = ("muted", "flash", "screen")


def load_state():
    try:
        with open(STATE_FILE) as f:
            saved = json.load(f)
    except (OSError, ValueError):
        return
    for k in _PERSIST_KEYS:
        if k in saved:
            _control[k] = saved[k]
    if _control["screen"] not in _SCREEN_IDS:
        _control["screen"] = "dashboard"


def save_state():
    try:
        with open(STATE_FILE, "w") as f:
            json.dump({k: _control[k] for k in _PERSIST_KEYS}, f)
    except OSError:
        pass  # a read-only disk shouldn't take the dashboard down


# ---------------------------------------------------------------------------
# System stats (/proc + /sys, no deps)
# ---------------------------------------------------------------------------
def _read_cpu_times():
    with open("/proc/stat") as f:
        parts = f.readline().split()[1:]
    vals = [int(x) for x in parts]
    idle = vals[3] + (vals[4] if len(vals) > 4 else 0)  # idle + iowait
    total = sum(vals)
    return idle, total


_cpu_prev = _read_cpu_times()


def cpu_pct():
    global _cpu_prev
    idle, total = _read_cpu_times()
    pidle, ptotal = _cpu_prev
    _cpu_prev = (idle, total)
    dt = total - ptotal
    if dt <= 0:
        return 0.0
    return round(100.0 * (1.0 - (idle - pidle) / dt), 1)


def mem_pct():
    info = {}
    with open("/proc/meminfo") as f:
        for line in f:
            k, v = line.split(":", 1)
            info[k] = int(v.split()[0])  # kB
    total = info.get("MemTotal", 1)
    avail = info.get("MemAvailable", info.get("MemFree", 0))
    return round(100.0 * (total - avail) / total, 1)


def temp_c():
    paths = [
        "/sys/class/thermal/thermal_zone0/temp",
    ]
    for p in paths:
        try:
            with open(p) as f:
                return round(int(f.read().strip()) / 1000.0, 1)
        except (OSError, ValueError):
            continue
    return None


def disk_pct(path="/"):
    try:
        s = os.statvfs(path)
        total = s.f_blocks * s.f_frsize
        free = s.f_bavail * s.f_frsize
        if total == 0:
            return 0.0
        return round(100.0 * (total - free) / total, 1)
    except OSError:
        return None


def uptime_s():
    try:
        with open("/proc/uptime") as f:
            return int(float(f.read().split()[0]))
    except (OSError, ValueError):
        return None


def system_stats():
    return {
        "cpu_pct": cpu_pct(),
        "mem_pct": mem_pct(),
        "temp_c": temp_c(),
        "disk_pct": disk_pct(),
        "uptime_s": uptime_s(),
    }


# ---------------------------------------------------------------------------
# Weather (no key: ipapi.co for location, open-meteo for forecast)
# ---------------------------------------------------------------------------
def _fetch_json(url, timeout=6):
    req = urllib.request.Request(url, headers={"User-Agent": "pi-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def resolve_latlon():
    global _latlon
    if _latlon is not None:
        return _latlon
    if LOCATION:
        try:
            lat, lon = (float(x) for x in LOCATION.split(","))
            _latlon = (lat, lon, "Fullerton")
            return _latlon
        except ValueError:
            pass
    try:
        d = _fetch_json("https://ipapi.co/json/")
        _latlon = (d["latitude"], d["longitude"], d.get("city", ""))
    except Exception:
        _latlon = None
    return _latlon


# Open-Meteo WMO weather codes -> (label, icon-key used by the frontend)
WMO = {
    0: ("Clear", "sun"), 1: ("Mostly clear", "sun"), 2: ("Partly cloudy", "cloud"),
    3: ("Overcast", "cloud"), 45: ("Fog", "fog"), 48: ("Fog", "fog"),
    51: ("Drizzle", "rain"), 53: ("Drizzle", "rain"), 55: ("Drizzle", "rain"),
    61: ("Rain", "rain"), 63: ("Rain", "rain"), 65: ("Heavy rain", "rain"),
    71: ("Snow", "snow"), 73: ("Snow", "snow"), 75: ("Heavy snow", "snow"),
    77: ("Snow", "snow"), 80: ("Showers", "rain"), 81: ("Showers", "rain"),
    82: ("Showers", "rain"), 85: ("Snow showers", "snow"), 86: ("Snow showers", "snow"),
    95: ("Thunderstorm", "storm"), 96: ("Thunderstorm", "storm"), 99: ("Thunderstorm", "storm"),
}


def _fmt_clock(iso):
    # "2026-07-19T05:46" -> "5:46 AM"
    try:
        hh, mm = iso.split("T")[1].split(":")[:2]
        h = int(hh)
        ap = "AM" if h < 12 else "PM"
        h12 = h % 12 or 12
        return f"{h12}:{mm} {ap}"
    except Exception:
        return iso


def weather():
    now = time.time()
    if _weather_cache["data"] and now - _weather_cache["t"] < WEATHER_TTL:
        return _weather_cache["data"]

    if DEMO:
        data = {"temp_c": 21, "label": "Partly cloudy", "icon": "cloud",
                "city": "Demoville", "hi": 24, "lo": 15,
                "humidity": 50, "wind_kmh": 12,
                "sunrise": "5:46 AM", "sunset": "8:28 PM"}
        _weather_cache.update(t=now, data=data)
        return data

    loc = resolve_latlon()
    if not loc:
        return None
    lat, lon, city = loc
    try:
        url = (
            "https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat}&longitude={lon}"
            "&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m"
            "&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset"
            "&timezone=auto&forecast_days=1"
        )
        d = _fetch_json(url)
        code = int(d["current"]["weather_code"])
        label, icon = WMO.get(code, ("Weather", "cloud"))
        data = {
            "temp_c": round(d["current"]["temperature_2m"]),
            "label": label,
            "icon": icon,
            "city": city,
            "hi": round(d["daily"]["temperature_2m_max"][0]),
            "lo": round(d["daily"]["temperature_2m_min"][0]),
            "humidity": round(d["current"]["relative_humidity_2m"]),
            "wind_kmh": round(d["current"]["wind_speed_10m"]),
            "sunrise": _fmt_clock(d["daily"]["sunrise"][0]),
            "sunset": _fmt_clock(d["daily"]["sunset"][0]),
        }
        _weather_cache.update(t=now, data=data)
        return data
    except Exception:
        return _weather_cache["data"]


# ---------------------------------------------------------------------------
# Bot status (journald)
# ---------------------------------------------------------------------------
POLL_RE = re.compile(r"polled\s+(\d+)\s+opportunities,\s+(\d+)\s+claimable")
ERROR_RE = re.compile(r"\b(error|exception|traceback|failed|failure)\b", re.I)


def add_alert_event(kind, title, detail="", ts=None, key=None):
    if ts is None:
        ts = time.time()
    if key is None:
        key = (kind, title, detail, int(ts))
    if key in _seen_alert_keys:
        return
    _seen_alert_keys.add(key)
    _alert_history.insert(0, {
        "ts": ts,
        "kind": kind,
        "title": title,
        "detail": detail,
    })
    del _alert_history[ALERT_HISTORY_LIMIT:]


def update_bot_alerts(status):
    global _last_claimable, _last_running

    now = time.time()
    running = bool(status.get("running"))
    claimable = status.get("claimable")

    if _last_running is None:
        if running:
            add_alert_event("ok", "Bot online", "polling recently", now, ("initial-online",))
    elif running != _last_running:
        if running:
            add_alert_event("ok", "Bot online", "polling resumed")
        else:
            add_alert_event("warn", "Bot stale", "no poll in 2 minutes")
    _last_running = running

    if claimable is None:
        return
    claimable = int(claimable)
    prev = _last_claimable
    event_ts = status.get("last_poll") or now

    if prev is None:
        if claimable > 0:
            add_alert_event(
                "claim",
                "Claimable found",
                f"{claimable} ready out of {status.get('opportunities') or '?'}",
                event_ts,
                ("initial-claim", claimable),
            )
    elif claimable > 0 and prev <= 0:
        add_alert_event(
            "claim",
            "Claimable found",
            f"{claimable} ready out of {status.get('opportunities') or '?'}",
            event_ts,
        )
    elif claimable <= 0 and prev > 0:
        add_alert_event("ok", "Claimable cleared", "back to zero", event_ts)
    _last_claimable = claimable


def alerts_payload():
    return {
        "history": _alert_history,
        "muted": bool(_control["muted"]),
        "flash": bool(_control["flash"]),
        "test": time.time() < float(_control.get("test_until", 0)),
    }


def set_display_power(on):
    """Blank/wake the kiosk display. Tries the no-sudo path first (vcgencmd
    usually works for users in the `video` group), then sudo, then wlopm for
    Wayland stacks where vcgencmd silently no-ops. Returns True if one worked.
    """
    arg = "1" if on else "0"
    attempts = [
        ["vcgencmd", "display_power", arg],
        ["sudo", "-n", "/usr/bin/vcgencmd", "display_power", arg],
        ["wlopm", "--on" if on else "--off", "*"],
    ]
    for cmd in attempts:
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        except (OSError, subprocess.SubprocessError):
            continue
        if r.returncode == 0:
            return True
    return False


def state_payload():
    """The one payload both GET endpoints return, so the phone sees exactly
    what the kiosk sees. Calling this is also what advances alert history."""
    return {
        "now": time.time(),
        "system": system_stats(),
        "weather": weather(),
        "bot": bot_status(),
        "canvas": canvas(),
        "claude": claude_usage(),
        "alerts": alerts_payload(),
        "screen": _control["screen"],
        "screens": SCREENS,
        "reload_token": _control["reload_token"],
    }


def _demo_bot():
    # Occasionally surface a claimable to exercise the alert path.
    claimable = 1 if int(time.time()) % 30 < 6 else 0
    status = {
        "running": True,
        "mode": "alert",
        "logged_in": True,
        "opportunities": 3,
        "claimable": claimable,
        "last_poll": time.time() - 5,
    }
    update_bot_alerts(status)
    return status


def bot_status():
    """Memoized briefly: both /api/stats and /api/control call this, and each
    miss shells out to journalctl. Two pollers at 5s would otherwise spawn ~24
    subprocesses a minute on a Pi."""
    now = time.time()
    if _bot_cache["data"] is not None and now - _bot_cache["t"] < BOT_TTL:
        return _bot_cache["data"]
    data = _bot_status_uncached()
    _bot_cache.update(t=now, data=data)
    return data


def _bot_status_uncached():
    if DEMO:
        return _demo_bot()

    status = {
        "running": False, "mode": None, "logged_in": False,
        "opportunities": None, "claimable": None, "last_poll": None,
    }
    try:
        out = subprocess.run(
            ["journalctl", "-t", BOT_IDENTIFIER, "-n", "120", "-o", "json",
             "--no-pager"],
            capture_output=True, text=True, timeout=6,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return status

    for line in out.splitlines():
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        msg = rec.get("MESSAGE", "")
        ts = rec.get("__REALTIME_TIMESTAMP")
        ts = float(ts) / 1e6 if ts else None

        if "starting in" in msg:
            m = re.search(r"in '([^']+)' mode", msg)
            if m:
                status["mode"] = m.group(1)
        if "session is live" in msg:
            status["logged_in"] = True
        if ERROR_RE.search(msg):
            clean = msg.strip()
            if len(clean) > 120:
                clean = clean[:117] + "..."
            add_alert_event(
                "error",
                "Bot log error",
                clean,
                ts or time.time(),
                ("journal-error", ts, clean),
            )
        m = POLL_RE.search(msg)
        if m:
            status["opportunities"] = int(m.group(1))
            status["claimable"] = int(m.group(2))
            status["last_poll"] = ts

    if status["last_poll"]:
        status["running"] = (time.time() - status["last_poll"]) < 120
    update_bot_alerts(status)
    return status


# ---------------------------------------------------------------------------
# Canvas assignments (needs a personal access token -- the one keyed feature)
# ---------------------------------------------------------------------------
def _canvas_get(path, params=None):
    url = f"{CANVAS_URL}/api/v1{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {CANVAS_TOKEN}",
        "User-Agent": "pi-dashboard/1.0",
    })
    with urllib.request.urlopen(req, timeout=12) as r:
        return json.loads(r.read().decode())


def _demo_canvas():
    day = 86400
    now = time.time()
    mk = lambda offs: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now + offs))
    return {
        "linked": True,
        "items": [
            {"course": "MATH 250B", "title": "Homework 4", "due": mk(1 * day)},
            {"course": "CPSC 335",  "title": "Algorithm Quiz", "due": mk(2 * day + 3600)},
            {"course": "PHYS 226",  "title": "Lab Report 5", "due": mk(4 * day)},
            {"course": "CPSC 349",  "title": "Web Project Milestone", "due": mk(6 * day)},
            {"course": "MATH 250B", "title": "Homework 5", "due": mk(8 * day)},
            {"course": "ENGL 102",  "title": "Essay Draft 2", "due": mk(9 * day)},
            {"course": "CPSC 335",  "title": "Midterm Review Set", "due": mk(10 * day)},
            {"course": "PHYS 226",  "title": "Problem Set 6", "due": mk(12 * day)},
            {"course": "CPSC 349",  "title": "Web Project Final", "due": mk(14 * day)},
            {"course": "ENGL 102",  "title": "Peer Review", "due": mk(15 * day)},
        ],
    }


def canvas():
    """Upcoming assignments across active courses. Cached; token-gated."""
    now = time.time()
    if _canvas_cache["data"] and now - _canvas_cache["t"] < CANVAS_TTL:
        return _canvas_cache["data"]

    if DEMO:
        data = _demo_canvas()
        _canvas_cache.update(t=now, data=data)
        return data

    if not CANVAS_TOKEN:
        return {"linked": False, "items": []}

    try:
        courses = _canvas_get("/courses", {"enrollment_state": "active",
                                           "per_page": 100})
        items = []
        for c in courses:
            if not isinstance(c, dict) or "id" not in c:
                continue
            assigns = _canvas_get(
                f"/courses/{c['id']}/assignments",
                {"bucket": "upcoming", "per_page": 50, "order_by": "due_at"},
            )
            for a in assigns:
                if a.get("due_at"):
                    items.append({
                        "course": c.get("name") or "",
                        "title": a.get("name") or "",
                        "due": a["due_at"],
                        "url": a.get("html_url"),
                    })
        items.sort(key=lambda x: x["due"])
        data = {"linked": True, "items": items[:20]}
        _canvas_cache.update(t=now, data=data)
        return data
    except Exception:
        # Keep showing the last good list on a transient/expired-token error.
        return _canvas_cache["data"] or {"linked": True, "items": [], "error": True}


# ---------------------------------------------------------------------------
# Claude Code usage (context-window fill of the most recent local session)
# ---------------------------------------------------------------------------
# This is the "context used" number the CLI shows, NOT the /usage plan limit --
# that 5h/weekly percentage is fetched live and never written to disk, so it
# can't be read here. Log into Claude on the Pi and use it; this reflects the
# most recently active session.
def _latest_transcript():
    latest, latest_m = None, 0.0
    try:
        for base, _dirs, files in os.walk(CLAUDE_PROJECTS):
            for name in files:
                if not name.endswith(".jsonl"):
                    continue
                p = os.path.join(base, name)
                try:
                    m = os.path.getmtime(p)
                except OSError:
                    continue
                if m > latest_m:
                    latest, latest_m = p, m
    except OSError:
        pass
    return latest, latest_m


def _last_usage(path):
    """(tokens, model) from the last message that carries usage, else (None, None).
    Reads only the tail -- transcripts grow large and we want the newest turn."""
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - 262144))
            lines = f.read().decode("utf-8", "ignore").splitlines()
    except OSError:
        return None, None
    for line in reversed(lines):
        try:
            o = json.loads(line)
        except ValueError:
            continue  # a tail-truncated first line, or non-JSON -- skip
        m = o.get("message") or {}
        u = m.get("usage") or o.get("usage")
        if u and ("input_tokens" in u or "cache_read_input_tokens" in u):
            tokens = (u.get("input_tokens", 0)
                      + u.get("cache_creation_input_tokens", 0)
                      + u.get("cache_read_input_tokens", 0))
            return tokens, m.get("model")
    return None, None


def _short_model(model):
    """'claude-opus-4-8' -> 'opus-4-8'; None stays None."""
    return model.replace("claude-", "").strip() if model else None


def _record_history(pct):
    now = time.time()
    if _claude_history and now - _claude_history[-1][0] < CLAUDE_HISTORY_EVERY:
        return
    _claude_history.append((now, round(pct, 1)))
    del _claude_history[:-CLAUDE_HISTORY_MAX]


def record_remote_claude(body):
    """Store a usage report POSTed by another machine (see claude_reporter.py).
    `ts` is the reporter's last-activity time (its transcript mtime); we fall
    back to now if it's missing so an old session can't masquerade as fresh."""
    now = time.time()
    try:
        pct = float(body["pct"])
    except (KeyError, TypeError, ValueError):
        pct = None
    try:
        ts = float(body["ts"])
    except (KeyError, TypeError, ValueError):
        ts = now
    _remote_claude["data"] = {
        "linked": True,
        "pct": None if pct is None else max(0.0, min(100.0, round(pct, 1))),
        "tokens": int(body.get("tokens") or 0) or None,
        "model": (_short_model(str(body["model"])[:24]) if body.get("model") else None),
        "active": bool(body.get("active")),
        "host": (str(body["host"])[:16] if body.get("host") else "remote"),
    }
    _remote_claude["recv"] = now
    _remote_claude["ts"] = ts


def claude_usage():
    now = time.time()
    if _claude_cache["data"] is not None and now - _claude_cache["t"] < CLAUDE_TTL:
        return _claude_cache["data"]

    if DEMO:
        pct = 9 + int(now / 3) % 40
        _record_history(pct)
        data = {"linked": True, "pct": pct, "tokens": pct * CONTEXT_WINDOW // 100,
                "active": True, "model": "opus-4-8", "host": LOCAL_HOST,
                "spark": [p for _, p in _claude_history]}
        _claude_cache.update(t=now, data=data)
        return data

    # Local candidate: the newest transcript on this machine's disk.
    local, local_act = None, 0.0
    path, mtime = _latest_transcript()
    if path:
        tokens, model = _last_usage(path)
        if tokens is None:
            local = {"linked": True, "pct": None}
        else:
            local = {
                "linked": True,
                "pct": round(100.0 * tokens / CONTEXT_WINDOW, 1),
                "tokens": tokens,
                "model": _short_model(model),
                "active": (now - mtime) < 120,  # a turn landed in the last 2 min
                "host": LOCAL_HOST,
            }
        local_act = mtime

    # Remote candidate: last report from another machine, ignored once the
    # reporter goes silent. Compare last-activity times so an idle-but-reporting
    # laptop doesn't mask a live session on the Pi.
    remote = _remote_claude["data"]
    remote_live = remote and (now - _remote_claude["recv"] < REMOTE_TTL)
    remote_act = _remote_claude["ts"] if remote_live else 0.0

    if remote_live and remote_act >= local_act:
        data = dict(remote)
    elif local:
        data = dict(local)
    else:
        data = {"linked": False, "pct": None}

    if data.get("pct") is not None:
        _record_history(data["pct"])
    data["spark"] = [p for _, p in _claude_history]

    _claude_cache.update(t=now, data=data)
    return data


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
CONTENT_TYPES = {
    ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
    ".ttf": "font/ttf", ".png": "image/png", ".svg": "image/svg+xml",
    ".ico": "image/x-icon", ".json": "application/manifest+json",
}


def read_json_body(handler):
    try:
        n = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        n = 0
    if n <= 0:
        return {}
    if n > 4096:
        raise ValueError("request too large")
    return json.loads(handler.rfile.read(n).decode() or "{}")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # quiet

    def _authed(self):
        """Local requests (the kiosk) always pass. Remote ones must carry the
        header Cloudflare Access sets after it verifies identity at the edge.

        This is only safe because cloudflared connects to 127.0.0.1 -- if port
        8080 is ever exposed directly, that header becomes a trivial bypass.
        REQUIRE_AUTH stays off until the tunnel is actually up.
        """
        if not REQUIRE_AUTH:
            return True
        if self.client_address[0] in ("127.0.0.1", "::1"):
            return True
        return bool(self.headers.get("Cf-Access-Authenticated-User-Email"))

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path in ("/api/stats", "/api/control"):
            if not self._authed():
                self._send(403, b"forbidden", "text/plain")
                return
            self._send(200, json.dumps(state_payload()).encode(), "application/json")
            return

        rel = "index.html" if path in ("/", "") else (
            "control.html" if path == "/control" else path.lstrip("/")
        )
        full = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not full.startswith(STATIC_DIR) or not os.path.isfile(full):
            self._send(404, b"not found", "text/plain")
            return
        ext = os.path.splitext(full)[1].lower()
        with open(full, "rb") as f:
            self._send(200, f.read(), CONTENT_TYPES.get(ext, "application/octet-stream"))

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path not in ("/api/control", "/api/claude"):
            self._send(404, b"not found", "text/plain")
            return
        if not self._authed():
            self._send(403, b"forbidden", "text/plain")
            return
        try:
            body = read_json_body(self)
        except (ValueError, json.JSONDecodeError):
            self._send(400, b"bad json", "text/plain")
            return

        if path == "/api/claude":
            record_remote_claude(body)
            self._send(200, b'{"ok":true}', "application/json")
            return

        if "muted" in body:
            _control["muted"] = bool(body["muted"])
            add_alert_event(
                "control",
                "Sound muted" if _control["muted"] else "Sound enabled",
                "changed from remote control",
            )
        if "flash" in body:
            _control["flash"] = bool(body["flash"])
            add_alert_event(
                "control",
                "Flash enabled" if _control["flash"] else "Flash disabled",
                "changed from remote control",
            )
        if body.get("test_alert"):
            _control["test_until"] = time.time() + 10
            add_alert_event("control", "Test alert", "sent from remote control")
        if body.get("clear_history"):
            _alert_history.clear()
            add_alert_event("control", "History cleared", "remote control")

        if "screen" in body:
            want = str(body["screen"])
            if want not in _SCREEN_IDS:
                self._send(400, b"unknown screen", "text/plain")
                return
            if want != _control["screen"]:
                _control["screen"] = want
                add_alert_event("control", f"Screen: {want}", "changed from remote control")

        if "refresh" in body:
            what = str(body["refresh"])
            if what in ("weather", "all"):
                _weather_cache["t"] = 0
            if what in ("canvas", "all"):
                _canvas_cache["t"] = 0
            add_alert_event("control", f"Refreshed {what}", "remote control")

        action = body.get("action")
        if action == "reload_kiosk":
            _control["reload_token"] = int(time.time())
            add_alert_event("control", "Kiosk reloaded", "remote control")
        elif action in ("screen_on", "screen_off"):
            on = action == "screen_on"
            ok = set_display_power(on)
            add_alert_event(
                "control",
                "Display on" if on else "Display off",
                "remote control" if ok else "command failed -- see README",
            )

        if any(k in body for k in _PERSIST_KEYS):
            save_state()

        self._send(200, json.dumps(state_payload()).encode(), "application/json")


def main():
    load_state()
    srv = ThreadingHTTPServer((BIND, PORT), Handler)
    mode = "DEMO" if DEMO else "live"
    print(f"[dashboard] serving on http://{BIND}:{PORT}  ({mode} mode)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    main()
