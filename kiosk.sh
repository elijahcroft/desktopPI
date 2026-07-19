#!/usr/bin/env bash
# Launch Chromium fullscreen showing the dashboard.
# Run this from the Pi's graphical session autostart (see README).
set -e

URL="http://localhost:8080"

# Pick whichever chromium binary exists on the Pi.
BIN="$(command -v chromium-browser || command -v chromium || echo chromium)"

# Wait until the backend is answering before opening the browser.
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "$URL"; then break; fi
  sleep 1
done

exec "$BIN" \
  --kiosk --app="$URL" \
  --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --disable-features=TranslateUI --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --overscroll-history-navigation=0
