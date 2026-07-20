#!/usr/bin/env python3
"""Report this machine's Claude Code context usage to the Pi dashboard.

Run it on any machine you also use Claude Code on (e.g. your laptop). It reads
your local ~/.claude transcripts -- exactly like the Pi reads its own -- and
POSTs the newest session's context% to the dashboard's /api/claude endpoint.
The dashboard then shows whichever machine was active most recently, so a
laptop session becomes visible on the Pi.

Stdlib only. Usage:

    python3 claude_reporter.py http://PI_ADDRESS:8080
    python3 claude_reporter.py http://pi.local:8080 --host laptop --interval 15

Leave it running in a terminal (or a login-session service) while you work.
"""

import argparse
import json
import os
import socket
import time
import urllib.request

PROJECTS = os.path.expanduser("~/.claude/projects")
CONTEXT_WINDOW = 200000  # keep in sync with server.py


def latest_transcript():
    latest, latest_m = None, 0.0
    for base, _dirs, files in os.walk(PROJECTS):
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
    return latest, latest_m


def last_usage(path):
    """(tokens, model) from the last message carrying usage; tail read only."""
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 262144))
            lines = f.read().decode("utf-8", "ignore").splitlines()
    except OSError:
        return None, None
    for line in reversed(lines):
        try:
            o = json.loads(line)
        except ValueError:
            continue
        m = o.get("message") or {}
        u = m.get("usage") or o.get("usage")
        if u and ("input_tokens" in u or "cache_read_input_tokens" in u):
            tokens = (u.get("input_tokens", 0)
                      + u.get("cache_creation_input_tokens", 0)
                      + u.get("cache_read_input_tokens", 0))
            return tokens, m.get("model")
    return None, None


def build_report(host):
    path, mtime = latest_transcript()
    if not path:
        return None
    tokens, model = last_usage(path)
    if tokens is None:
        return None
    return {
        "pct": round(100.0 * tokens / CONTEXT_WINDOW, 1),
        "tokens": tokens,
        "model": model,
        "host": host,
        "active": (time.time() - mtime) < 120,
        "ts": mtime,  # last-activity time; the Pi ranks machines by this
    }


def post(url, report):
    data = json.dumps(report).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=6) as r:
        r.read()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base_url", help="dashboard base URL, e.g. http://pi.local:8080")
    ap.add_argument("--host", default=socket.gethostname(),
                    help="label shown on the card (default: this machine's hostname)")
    ap.add_argument("--interval", type=float, default=15.0, help="seconds between reports")
    args = ap.parse_args()

    url = args.base_url.rstrip("/") + "/api/claude"
    print(f"[reporter] {args.host} -> {url} every {args.interval:g}s")
    while True:
        try:
            report = build_report(args.host)
            if report:
                post(url, report)
                print(f"[reporter] {report['pct']}%  "
                      f"{report['tokens']} tok  {report['model']}"
                      f"{'  (active)' if report['active'] else ''}")
        except Exception as e:  # keep looping through transient network/read errors
            print(f"[reporter] skip: {e}")
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
