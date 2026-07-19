# Cozy Pixel-Art Pi Dashboard

A little pixel-art display for a 1024×600 Raspberry Pi screen. Shows a clock,
weather, system stats, an animated pixel pet, and the live status of your
**A-to-Z opportunity bot** — the whole screen flashes and the pet celebrates
when an opportunity becomes claimable.

Everything runs locally on the Pi. No pip installs, no API keys.

There's also a **phone app** for it — installable to your home screen — that
switches which screen the kiosk is showing, watches live stats, and controls
alerts. See [Phone app](#phone-app).

```
server.py              tiny stdlib backend: serves the pages + JSON API
static/
  index.html           kiosk shell (just a mount point)
  shell.js             owns the poll, the alert, and screen swapping
  screens/*.js         one file per kiosk screen  <- add new screens here
  pet.js               createPet() — the roaming pixel cat
  style.css            kiosk styles
  control.html/.js/.css   the phone app
  manifest.json, sw.js, icon-*.png   PWA bits
pi-dashboard.service   systemd unit for the backend
kiosk.sh               launches Chromium fullscreen at the dashboard
.env.example           copy to .env on the Pi for secrets/switches
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

## Alert history

The dashboard's left sidebar shows the most recent bot/dashboard events:
claimable found, claimable cleared, bot stale/online transitions,
remote-control changes, and recent error-looking bot log lines.

## Phone app

```
http://<pi-ip-address>:8080/control      # any device on the same network
```

Find the Pi's IP with `hostname -I` on the Pi.

**Install it to your home screen.** Android Chrome offers *Install app* from the
menu; on iOS use Safari's *Share → Add to Home Screen*. It then opens fullscreen
with its own icon, no browser chrome. Android only offers a true install over
**HTTPS**, which is what the [Cloudflare tunnel](#reaching-it-from-anywhere)
below is for — over plain LAN HTTP you'll get iOS's basic home-screen icon only.

The app can:

- **switch which screen the kiosk shows** (Dashboard, Cats Chilling, …)
- watch live stats — bot, claimable, CPU, temp, RAM, disk, uptime, weather
- mute/unmute the alert beep, and turn the fullscreen flash on/off
- send a 10-second test alert
- turn the kiosk **display on/off**, and reload the kiosk browser
- force-refresh the weather and Canvas caches
- clear the alert history

It polls only while visible, so it doesn't drain your battery in the background.
If the Pi goes away it says so and recovers on its own when it's back.

Mute, flash and the current screen are saved to `state.json`, so they survive a
restart.

## Screens

The kiosk can show different screens, chosen from the phone. Adding one takes
**one file and one line**:

1. Create `static/screens/<id>.js`:

   ```js
   registerScreen({
     id: "clock",                    // must match the filename
     label: "Big Clock",             // shown in the phone's picker
     html: `<div class="big-clock"></div>`,   // injected before mount
     mount(root, ctx) { ... },       // start things here
     unmount() { ... },              // stop what mount started
     data(d) { ... },                // optional: latest /api/stats payload
   });
   ```

2. Add it to `SCREENS` in `server.py`:

   ```python
   SCREENS = [
       {"id": "dashboard", "label": "Dashboard"},
       {"id": "cats",      "label": "Cats Chilling"},
       {"id": "clock",     "label": "Big Clock"},   # <- new
   ]
   ```

That's it — `shell.js` lazy-loads the file the first time you switch to it, and
swaps screens without reloading the page.

**Use `ctx.every(fn, ms)` and `ctx.frame(fn)` instead of `setInterval` /
`requestAnimationFrame`.** They're cancelled automatically on unmount. A screen
that leaks a timer leaves ghost animations running and climbs CPU on the Pi
after a few switches — this is the one way to really break this design.

`ctx.petLayer` is the full-screen overlay for cats; `createPet(layer, opts)`
returns `{stop(), celebrate(on)}`. Call `stop()` in `unmount`. See
`static/screens/cats.js` — it's about 25 lines and runs three of them.

## Reaching it from anywhere

Serving the page from a normal web host *cannot* work: the page is only a
frontend, and its requests still have to reach the Pi on your home network.
A Cloudflare tunnel gives the Pi itself a public HTTPS hostname, with no port
forwarding and without exposing your home IP.

On the **Pi**:

```bash
cloudflared tunnel login                                  # pick your domain
cloudflared tunnel create pi-dashboard
cloudflared tunnel route dns pi-dashboard control.example.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: pi-dashboard
credentials-file: /home/ej/.cloudflared/<UUID>.json
ingress:
  - hostname: control.example.com
    service: http://127.0.0.1:8080
  - service: http_status:404
```

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

> `cloudflared service install` runs as **root** and reads
> `/etc/cloudflared/config.yml`, not `~/.cloudflared/`. Copy both the config and
> the credentials JSON there, or it will start and serve nothing.

**Then lock it down.** A public hostname with no auth means anyone who finds it
can drive your kiosk and read your Canvas assignments.

1. Cloudflare Zero Trust → Access → Applications → Add → Self-hosted.
   Domain `control.example.com`, policy *Allow* → *Emails* → your address,
   login method *One-time PIN*. Set the session to **1 month** — a home-screen
   app that re-authenticates weekly is miserable to live with.

2. In `/home/ej/pi/.env`:

   ```
   BIND=127.0.0.1
   REQUIRE_AUTH=1
   ```

   `REQUIRE_AUTH` makes the server require the identity header Cloudflare adds
   after verifying you. **That header is only trustworthy because `BIND` closes
   off direct access** — set both together, never one alone. Requests from
   localhost (the kiosk itself) always pass.

## Display on/off, and sudo

Display on/off tries, in order: `vcgencmd display_power`, the same under `sudo`,
then `wlopm` for Wayland stacks where `vcgencmd` silently does nothing. If none
work the app tells you so in the alert history rather than pretending.

Try it as your own user first — it often already works via the `video` group:

```bash
vcgencmd display_power 0    # off
vcgencmd display_power 1    # on
```

Only if that's denied, add `/etc/sudoers.d/pi-dashboard` (create it with
`sudo visudo -f /etc/sudoers.d/pi-dashboard`, mode 0440):

```
ej ALL=(root) NOPASSWD: /usr/bin/vcgencmd display_power 0, /usr/bin/vcgencmd display_power 1
```

Exact commands only — no wildcards, and nothing that can reboot or shut down the
Pi. Verify with `sudo -n /usr/bin/vcgencmd display_power 1` (no password prompt).

## Canvas assignments

Canvas needs a personal access token (Account → Settings → New Access Token).
Put it in `/home/ej/pi/.env` — copy `.env.example` and `chmod 600` it:

```
CANVAS_TOKEN=...
CANVAS_URL=https://yourschool.instructure.com
```

> The systemd unit reads this file. Without it the service runs with an empty
> token and the card just says "link canvas" — even though running
> `python3 server.py` by hand from a shell with the variable exported works
> fine. If Canvas works manually but not as a service, this is why. Check with
> `sudo systemctl show pi-dashboard -p Environment`.

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
python3 build_cat.py --icons         # regenerate the phone app's icons
```

Run `--icons` after switching fur color, or the app icon won't match.

## Tweaks

- Colors / theme: CSS variables at the top of `static/style.css`
  (`static/control.css` mirrors them for the phone).
- Cat behavior (speed, how often it grooms): `static/pet.js`.
- Weather location: `LOCATION` at the top of `server.py` (currently Fullerton/Long Beach).
- Poll interval: `setInterval(poll, 5000)` in `static/shell.js`.
