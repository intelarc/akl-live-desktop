# AKL Live for Windows

The desktop version of [AKL Live](https://github.com/intelarc/akl-live-android):
live Auckland buses and trains, with the AT API key built in. Private.

## Install

Download `AKL-Live-Setup-*.exe` from **Releases → latest** and run it. It
installs for your account (no admin needed), adds **AKL Live** to the Start
menu and the desktop, and shows up in Settings → Apps for uninstalling.
Running a newer installer updates it in place and keeps your settings.

## What's in it

- **Buses.** The 27H at Aldersgate Road, both ways, each with a live scene:
  the bus drives in as it counts down, under Auckland's real sky and weather.
  - Next bus in detail: live or scheduled, minutes late, which model it is,
    the stops between it and you, how far away it is, its speed and how full.
  - "Leave in 3 min" from your walking time, the next five buses, and the rest
    of today's timetable.
  - A live satellite map of the whole route, and the weather for the next six
    hours.
- **Trains.** The post-CRL network diagram with every train gliding live.
  - Scroll to zoom and drag to pan. Hover for names; click a train for its
    next stops, or a station for live departures from every platform.
  - Line filters, and a Satellite or Map view of every train at its real GPS
    position.
- **Live.** Every bus in Auckland (about a thousand at once) on one map,
  coloured by operator. Trains and ferries can be added too.
  - Search by route, fleet number or model, and filter by operator, electric
    or double-decker.
  - Click a bus for its route, destination, delay, speed, load and model, then
    **Follow** it around town.
- **Fleet.** Every model on the road and how many are out right now, plus each
  operator's fleet at a glance.
  - Each model has a page: specs, history, fleet numbers, and a live map and
    list of every one of them.
- **Desktop extras.**
  - A tray icon with the countdown, and Windows alerts before your bus (the
    bell on each direction).
  - An always-on-top **desk board** (Ctrl+M) styled after the ESP32 one.
  - Start with Windows, close to the tray, light/dark following Windows, and
    keyboard shortcuts (Ctrl+1–5, Ctrl+R, Ctrl+F, F11).

## How it's built

Electron around plain web pages in `src/` (no framework, no bundler). Maps are
MapLibre GL (`src/vendor`, v5, BSD-3), with Esri World Imagery or LINZ aerials,
and OpenFreeMap streets. Data comes straight from the AT developer API and
Open-Meteo, the same way the Android app gets it.

`src/js/data/` is generated from the Android repo: the network schematic, the
27H's stops and the fleet list. Re-run this after changing them there:

    python tools/import_android.py

`python tools/make_icon.py` redraws the icons. `python tools/dev_server.py`
serves `src/` for trying things in a browser. That needs `src/js/keys.js`
(gitignored), holding `window.AKL_KEYS = { at: "…" }`.

## Building

GitHub Actions (`.github/workflows/build.yml`) builds the installer on
`windows-latest` on every push to `main`. It writes the `AT_API_KEY`
repository secret into `src/js/keys.js`, then runs electron-builder (NSIS) and
publishes the installer to the private `latest` release. Locally, with Node 22:
`npm install`, then `npm start` to run it or `npm run dist` for the installer.
