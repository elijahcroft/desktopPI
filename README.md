# Cozy Pixel-Art Pi Dashboard

A little pixel-art display for a 1024×600 Raspberry Pi screen. Shows a clock,
weather, system stats, an animated pixel pet, and the live status of your
**A-to-Z opportunity bot** — the whole screen flashes and the pet celebrates
when an opportunity becomes claimable.

Everything runs locally on the Pi. No pip installs, no API keys.

```
server.py          tiny stdlib backend: serves the page + /api/stats JSON
static/            the pixel-art page (index.html, style.css, app.js, pet.js, font)
pi-dashboard.service   systemd unit for the backend
kiosk.sh           launches Chromium fullscreen at the dashboard
```

## Try it on any machine first

```bash
python3 server.py --demo      # synthetic bot + weather; real system stats
# open http://localhost:8080  (size the window to 1024x600)
```
Demo mode surfaces a fake "claimable" every ~30s so you can see the alert fire.

## Install on the Pi

1. Copy this folder to the Pi (e.g. `/home/ej/pi`). If your user/path differ,
   edit `User=` and the paths in `pi-dashboard.service`.

2. Start the backend as a service:
   ```bash
   sudo cp pi-dashboard.service /etc/systemd/system/
   sudo systemctl enable --now pi-dashboard.service
   curl -s localhost:8080/api/stats | head    # sanity check
   ```

3. Make Chromium open it fullscreen on boot. Pick the one matching your Pi OS:

   **Wayland / labwc (Raspberry Pi OS Bookworm, default):**
   add to `~/.config/labwc/autostart`:
   ```
   /home/ej/pi/kiosk.sh &
   ```

   **X11 / LXDE (older / X session):**
   add to `~/.config/lxsession/LXDE-pi/autostart`:
   ```
   @/home/ej/pi/kiosk.sh
   ```
   ```bash
   chmod +x /home/ej/pi/kiosk.sh
   ```

4. Reboot. The dashboard comes up fullscreen.

## The bot widget

The backend reads the bot's status from journald with:
```
journalctl -t run.sh -n 120 -o json
```
It matches your existing log lines, e.g.
`[bot] polled 3 opportunities, 0 claimable`. No changes to the bot are needed —
it just has to keep logging under the `run.sh` syslog identifier (it already does).
If you ever rename it, set `BOT_IDENTIFIER` at the top of `server.py`.

The bot dot is **green** when a poll happened in the last 2 minutes, otherwise red.

## Weather

Location auto-detects from the Pi's public IP once at startup (via ipapi.co),
then forecasts come from open-meteo.com — both keyless. To pin a specific place,
set `LOCATION = "lat,lon"` near the top of `server.py` and restart the service.

## The cat

The pet is a real pixel-art cat that wanders its little "yard", pauses to sit and
groom, and paces + meows when the bot has a claimable opportunity. It's sliced from
the sprite pack in `Free pack/` into `static/cat.png` (walk in 4 directions, sit,
groom, meow). To switch fur color, regenerate the sheet (needs Pillow, dev-time only):

```bash
python3 build_cat.py                 # orange tabby (default)
python3 build_cat.py "cat 1.png"     # grey tabby
python3 build_cat.py "cat 1.9.png"   # white
```

## Tweaks

- Colors / theme: CSS variables at the top of `static/style.css`.
- Cat behavior (speed, how often it grooms): `static/pet.js`.
- Weather location: `LOCATION` at the top of `server.py` (currently Fullerton/Long Beach).
- Poll interval: `setInterval(poll, 5000)` in `static/app.js`.
