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
import subprocess
import sys
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
PORT = 8080
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

# Set to "lat,lon" (e.g. "51.5,-0.12") to hardcode weather location.
# Left as None -> auto-detect from the Pi's public IP once at startup.
LOCATION = "33.83,-118.05"  # Fullerton / Long Beach area, CA

# Syslog identifier the bot logs under (from `run.sh[17947]: ...`).
BOT_IDENTIFIER = "run.sh"

DEMO = "--demo" in sys.argv[1:]

WEATHER_TTL = 600  # seconds
_weather_cache = {"t": 0, "data": None}
_latlon = None  # resolved once


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


def _demo_bot():
    # Occasionally surface a claimable to exercise the alert path.
    claimable = 1 if int(time.time()) % 30 < 6 else 0
    return {
        "running": True,
        "mode": "alert",
        "logged_in": True,
        "opportunities": 3,
        "claimable": claimable,
        "last_poll": time.time() - 5,
    }


def bot_status():
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
        m = POLL_RE.search(msg)
        if m:
            status["opportunities"] = int(m.group(1))
            status["claimable"] = int(m.group(2))
            status["last_poll"] = ts

    if status["last_poll"]:
        status["running"] = (time.time() - status["last_poll"]) < 120
    return status


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
CONTENT_TYPES = {
    ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
    ".ttf": "font/ttf", ".png": "image/png", ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # quiet

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path == "/api/stats":
            payload = {
                "now": time.time(),
                "system": system_stats(),
                "weather": weather(),
                "bot": bot_status(),
            }
            self._send(200, json.dumps(payload).encode(), "application/json")
            return

        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        full = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not full.startswith(STATIC_DIR) or not os.path.isfile(full):
            self._send(404, b"not found", "text/plain")
            return
        ext = os.path.splitext(full)[1].lower()
        with open(full, "rb") as f:
            self._send(200, f.read(), CONTENT_TYPES.get(ext, "application/octet-stream"))


def main():
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    mode = "DEMO" if DEMO else "live"
    print(f"[dashboard] serving on http://localhost:{PORT}  ({mode} mode)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    main()
