# Enable em-trak GPS output on the NMEA 2000 bus

This guide is for owners of an **em-trak B900-series** Class B AIS transceiver
(B921 / B922 / B923 / **B924**) connected to your boat's NMEA 2000 (N2K)
backbone.

The em-trak has its own internal GPS. By default it can publish that fix to
the N2K bus so the rest of your electronics (and the hara-marina bridge) can
see your position even if no other GPS is wired in. If your hara-marina boat
page shows **"No AIS signal"** and the marina-bridge logs show no
`pgn=129025/129026/129029` frames, the most likely causes are:

1. The em-trak has no GPS fix (antenna problem or no sky view).
2. GPS PGN output is disabled in the em-trak's configuration.

This document covers #2 — how to verify and re-enable the GPS PGN output
using **proAIS2**.

---

## What you need

- A Windows or macOS laptop
- The **USB power/data cable** that came with the B900 (5-pin connector on
  the unit, USB-A on the laptop)
- **proAIS2** configuration software (free, from em-trak)
  - Download: <https://productsupport.em-trak.com/hc/en-gb/articles/34224227251869>
- The unit powered on (12/24 V) — USB alone is not enough to power the radio
  side, but is enough for configuration

---

## Step 1 — Connect

1. Power the em-trak from the boat's 12/24 V supply.
2. Plug the USB cable from the unit into your laptop.
3. Launch **proAIS2**. It should auto-detect the COM/serial port. If it
   doesn't, pick the port labelled `usbserial` / `STMicroelectronics` from
   the dropdown and click **Connect**.

## Step 2 — Confirm there is a GPS fix

Open the **GPS Status** tab.

- Expect: **2D fix** or **3D fix**, satellites in view ≥ 4, HDOP < 3.
- If status is **No fix** for several minutes:
  - Check the GPS antenna cable (TNC connector on the back of the unit).
  - Check the antenna has a clear view of the sky.
  - Move the boat out from under any cover.

If there is no fix, fixing the antenna will solve the problem and steps 3–4
are unnecessary — once a fix arrives the unit will start emitting position
PGNs automatically (assuming they were never disabled).

## Step 3 — Check NMEA 2000 PGN output

Open the **Configuration** tab → scroll to the **NMEA 2000 Output** section.

You should see a list of PGNs with checkboxes. The ones that matter for
hara-marina are:

| PGN    | Description                        | Should be |
| ------ | ---------------------------------- | --------- |
| 129025 | Position, Rapid Update             | ✅ enabled |
| 129026 | COG & SOG, Rapid Update            | ✅ enabled |
| 129029 | GNSS Position Data                 | ✅ enabled |
| 129038 | AIS Class A Position Report        | ✅ enabled |
| 129039 | AIS Class B Position Report        | ✅ enabled |
| 129040 | AIS Class B Extended Position Rpt  | ✅ enabled |
| 129793 | AIS UTC and Date Report            | ✅ enabled |
| 129794 | AIS Class A Static and Voyage Data | ✅ enabled |
| 129809 | AIS Class B Static Data, Part A    | ✅ enabled |
| 129810 | AIS Class B Static Data, Part B    | ✅ enabled |

Tick any that are unchecked. **Don't disable** anything that is already
enabled.

## Step 4 — Write and reboot

1. Click **Write Configuration** (button at the bottom of the
   Configuration tab).
2. Wait for the "Configuration written successfully" confirmation.
3. Power-cycle the N2K bus (turn the boat's instruments breaker off, wait
   10 seconds, on again). The em-trak needs a clean re-announce on the bus.

## Step 5 — Verify on the boat page

- Open your boat's hara-marina page (e.g. `https://hara-marina.vercel.app/<your-boat>`).
- Within ~30 seconds the **AIS · MARINA STATUS** panel should switch from
  "No AIS signal" to a live state with SOG/COG and an AIS position card.
- The marina map will start showing your boat as soon as a fix is published.

If it still shows "No AIS signal" after 5 minutes:

- Take a screenshot of the proAIS2 **GPS Status** tab and the **NMEA 2000
  Output** section and send it to the marina operator. We'll look at the
  bridge logs from our side.

---

## Where to find your MMSI

The em-trak is programmed with your assigned MMSI at install time. To
read it back:

- proAIS2 → **Configuration** tab → top of the page shows **MMSI** and
  **Vessel Name**.
- Or look on the unit's label / your original AIS licence paperwork.

Enter that MMSI in your hara-marina **Settings → Identity → AIS MMSI** so
the boat page can look up your AIS track.

---

## Reference links

- em-trak knowledge base: <https://productsupport.em-trak.com/hc/en-gb>
- B900 Series user manual (English): <https://productsupport.em-trak.com/hc/en-gb/articles/28856300686749>
- proAIS2 download: <https://productsupport.em-trak.com/hc/en-gb/articles/34224227251869>
- "How do I configure my unit?": <https://productsupport.em-trak.com/hc/en-gb/articles/28856189867933>
- "Need to change the MMSI number?": <https://productsupport.em-trak.com/hc/en-gb/articles/28856198026525>

---

## Why this matters for hara-marina

The marina-bridge on board reads NMEA 2000 PGNs from your YDWG-02 gateway
and forwards a telemetry snapshot to the cloud. With GPS PGN output enabled
on the em-trak, the bridge can:

- Show your live position on the marina map without a separate GPS plotter.
- Detect when you leave / approach the marina (auto-state transitions).
- Cross-check VHF AIS sightings (via AISStream volunteer receivers) against
  your own GPS for trip recording.

Without GPS PGNs, the bridge still sees your AIS Class B static data
(name, MMSI, dimensions) — but no live position, so the marina page will
keep showing **"No AIS signal"** even if the unit is otherwise healthy.
