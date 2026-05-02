# Hara Marina · Quickstart

**Goal:** get your boat's live data on the marina dashboard in under 10 minutes,
with one shell command. No coding required.

## What you need

- A boat already added to the marina (ask the marina admin if it isn't).
- A computer on the boat that runs Linux and stays on while you're away —
  most owners use a **Raspberry Pi** (4 or Zero 2 W). The script also works
  on Intel NUCs, Cerbo's own SSH shell, or any Debian/Ubuntu box.
- That computer needs internet access (Wi-Fi, LTE dongle, marina shore Wi-Fi…).
- One of:
  - **Victron Cerbo GX** with "MQTT on LAN (SSL/Plain)" enabled, **or**
  - **Yacht Devices YDWG-02 / YDEN-02** Wi-Fi NMEA2000 router with the RAW
    server enabled (Settings → Server → RAW), **or** both.

## 1 · Generate your install command

Open <https://hara-marina.vercel.app/onboard> on your laptop, sign in with
your email (you'll get a magic link), then:

1. Pick your boat.
2. Pick your hardware (Cerbo / YDWG / both).
3. Click **Generate install command**.

You'll get a one-line `curl ... | sudo bash` command. **Copy it.** The link
inside it is good for 30 minutes — if you take longer, just regenerate.

## 2 · SSH into the boat computer

From your laptop:

    ssh pi@raspberrypi.local      # or whatever you named it

Don't have SSH set up? On Raspberry Pi OS:

1. With the SD card in your laptop, create an empty file named `ssh` (no
   extension) on the boot partition.
2. Boot the Pi, plug it into your boat router with Ethernet (easiest first
   time), and find its IP from your router admin page.
3. `ssh pi@<that-ip>` — default password is `raspberry` (change it after
   you log in!).

## 3 · Paste the command

Paste the line from step 1 and press **Enter**. You'll see something like:

    ⚓ downloading marina-bridge (latest)
    ✓ installed /usr/local/bin/marina-bridge
    ⚓ fetching boat config from marina
    ✓ config written to /etc/marina-bridge.yaml (boat: moi)
    ✓ created system user: marina
    ✓ wrote /etc/systemd/system/marina-bridge.service
    ✓ service enabled and started

The installer then tails the first ~8 seconds of logs so you can see the
bridge connect to your Cerbo / YDWG.

## 4 · Check the dashboard

Refresh `https://hara-marina.vercel.app/<your-boat-slug>`. Within ~30 s you
should see battery voltage, shore-power state, GPS, etc.

## Troubleshooting

**"setup token rejected"** — the link expired. Go back to the wizard and
generate a fresh command.

**Nothing on the dashboard after a minute** — check the bridge logs:

    sudo journalctl -u marina-bridge -f

Common things you'll see:

- `cerbo: connect: ...timeout` — the Pi can't reach `venus.local`. Make sure
  the Pi is on the same network as the Cerbo, or replace `venus.local` in
  `/etc/marina-bridge.yaml` with the Cerbo's IP.
- `cerbo: auto-detected VRM portal id: ...` — good, that's your boat
  publishing.
- `ydwg: dial tcp 192.168.4.1:1457: ... refused` — YDWG isn't on
  `192.168.4.1`. Find its IP (router page or YDWG WebGUI) and edit
  `/etc/marina-bridge.yaml`, then `sudo systemctl restart marina-bridge`.

**I want to change something** — edit `/etc/marina-bridge.yaml` and run
`sudo systemctl restart marina-bridge`.

**I want to uninstall** —

    sudo systemctl disable --now marina-bridge
    sudo rm /etc/systemd/system/marina-bridge.service
    sudo rm /usr/local/bin/marina-bridge /etc/marina-bridge.yaml
    sudo userdel marina
    sudo systemctl daemon-reload

## What just got installed?

- `/usr/local/bin/marina-bridge` — a single Go binary (~10 MB), no runtime
  dependencies. Reads from your Cerbo / YDWG, batches every 30 s, and
  publishes one JSON snapshot to the marina MQTT broker.
- `/etc/marina-bridge.yaml` — your config, including a freshly-rotated MQTT
  password. Mode `0640`, owned by user `marina`.
- `/etc/systemd/system/marina-bridge.service` — restarts the bridge on
  reboot or crash.
- A system user `marina` with no shell and no home directory.

The bridge only **publishes** to one topic (`marina/<your-slug>/telemetry`)
and only **reads** from your local Cerbo/YDWG. It cannot control anything
on your boat.

## Privacy

- Telemetry is sent to the marina you signed up with. Nobody else can read
  it (MQTT topic ACL is locked to `marina/<your-slug>/#`).
- The setup link is a 30-minute, single-purpose token bound to your email
  and your boat slug. It cannot be used to log into the marina or read
  other boats.

## Going further

- [Full owner onboarding doc](/docs/onboarding) — protocol details, custom
  HTTP-only flow, schema reference.
- [Bridge source on GitHub](https://github.com/kepsic/hara-marina/tree/main/infra/marina-bridge) —
  if you'd rather build from source or run it under your own user.
