# AKL Live for Windows

The desktop version of [AKL Live](https://github.com/intelarc/akl-live-android):
live Auckland buses, trains and ferries, a journey planner, and detailed
maps, for Windows.

**[See it in screenshots →](https://intelarc.github.io/akl-live-desktop/)**

<!-- screenshots -->

## Install

1. Download `AKL-Live-Setup-*.exe` from
   **[Releases → latest](https://github.com/intelarc/akl-live-desktop/releases/latest)**
   and run it. It installs for your account (no admin needed), adds
   **AKL Live** to the Start menu and the desktop, and shows up in
   Settings → Apps for uninstalling. Running a newer installer updates it in
   place and keeps your settings.
2. The first time it opens, it asks for an **Auckland Transport API key**.
   They're free: sign up at [dev-portal.at.govt.nz](https://dev-portal.at.govt.nz),
   subscribe to AT's GTFS and real-time APIs, and paste your primary key in.
   AKL Live checks it with AT and keeps it on your computer. Directions and
   the maps work before you add one.

Windows may warn that the installer isn't signed: choose **More info → Run
anyway**.

## What's in it

- **Directions** (Ctrl+D). Plan any trip across Auckland by bus, train and ferry,
  like the AT app's journey planner, but running on this computer.
  - From and To take saved places (Home, Work), recent places, any stop or
    station, or any address or landmark. You can also right-click the map or
    pick a point on it.
  - Leave now, depart at, or arrive by, today or tomorrow. Options for how far
    you'll walk, how fast, how many changes, and bus, train or ferry.
  - Options are tagged Fastest, Least walking and Fewest changes. Each one
    shows its legs, when to leave, the first ride's live delay and how many
    stops away it is, and any alerts along the way.
  - The step-by-step view has turn-by-turn walking directions and every stop
    with its time. For each ride it shows live delays (with the timetabled time
    crossed out), which bus it is (model, operator, fleet number, how full),
    and where it is now. The map draws the whole journey along the real
    route, and tracks your bus live.
  - **Remind me to leave** sends a Windows alert a minute before you need to
    head out. **Copy directions** puts the trip on the clipboard.
- **Stops.** Search any stop, station or wharf by name or number, or click one
  on the map.
  - Live departures on every route (a station shows all its platforms), with
    delays, stops away, the model and how full each one is.
  - Approaching buses on the map, alerts at that stop, favourites, stops near
    home or anywhere you right-click, and "add to Buses".
- **Buses.** The 27H at Aldersgate Road, both ways, each with a live scene:
  the bus drives in as it counts down, under Auckland's real sky and weather.
  - Next bus in detail, "leave in 3 min" (or which bus you can still catch),
    the next five buses, and the rest of today's timetable.
  - A live route map, the weather for the next six hours, and alerts affecting
    your route or stops at the top.
- **Trains.** Auckland's whole rail network in AT's line colours (East West,
  South City, Onehunga West, and Te Huia to Hamilton), drawn along the real
  tracks from AT's timetable.
  - Lines that share rails run side by side, in the order they really sit.
    Where lines use different platforms (the CRL and the western line at
    Maungawhau), each keeps to its own, and a bar joins the station's
    platforms.
  - Every train sits where its GPS puts it, snapped onto its line. It points
    the way it's heading, with a dot when it's running late.
  - Click a train for its next stops, or a station for departures from every
    platform. Satellite and Map show the same over aerial photos or streets.
- **Live.** Every bus in Auckland on one map (about 1,200 at rush hour), plus
  trains and ferries if you like.
  - Search by route, fleet number or model. Showing a route draws its path
    each way and its stops.
  - Click a vehicle for its destination, delay, speed, load and model, the
    rest of its route with its next stops and times, and **Follow** it.
- **Fleet.** Every bus model on the road, with a real photo of each and how
  many are out, and a page per model with its specs, fleet numbers and a live
  map. Photos come from the AT Metro Wiki (CC BY-SA) or Wikimedia Commons, credited on each.
- **Alerts.** Every current and upcoming disruption: detours, moved stops, no
  service. Yours come first, with a badge in the sidebar.
- **Maps, in detail.**
  - Satellite photos (Esri, or LINZ's 7.5 cm aerials with a free key) with
    roads, street names, suburbs and places drawn over them,
    or OpenFreeMap's street map with hillshading.
  - All 5,800 stops appear as you zoom in; click one for its departures.
- **Search everything** (Ctrl+K): places and addresses (for directions),
  stops (for departures), routes (on the live map), fleet numbers, bus models,
  screens and actions.
- **Desktop extras.**
  - A tray icon with the countdown, and Windows alerts before your bus.
  - An always-on-top **desk board** (Ctrl+M), and taskbar right-click
    shortcuts.
  - Windows 11 Mica, start with Windows, close to the tray, light/dark
    following Windows.
  - Keyboard shortcuts: Ctrl+1–8, Ctrl+K, Ctrl+D, Ctrl+F, Ctrl+R, F11.

## How it's built

Electron around plain web pages in `src/` (no framework, no bundler).

- **The journey planner** is our own: `src/js/gtfs-worker.js` runs in a Web
  Worker.
  - It reads AT's full timetable (`gtfs.zip`, about 29 MB). The desktop app
    fetches it and checks for a new one every six hours.
  - It compiles one service day (about 15,000 trips and 450,000 stop times)
    into typed arrays. That takes about 2 seconds, and the result is cached in
    IndexedDB, so it's instant after the first time each day. Tomorrow is
    compiled when you first ask for it.
  - Routing is RAPTOR (round-based public transit routing) with walking
    transfers of up to 450 m between stops. A search takes around 10 ms, and
    it's rerun a few times to find several departures.
  - Live delays, vehicle positions and cancellations come from AT's realtime
    feeds.
- **Maps** are MapLibre GL (`src/vendor`, v5, BSD-3), using these sources:
  - Esri World Imagery or LINZ aerials.
  - OpenFreeMap vector tiles for streets, labels and buildings (©
    OpenStreetMap contributors).
  - AWS / Mapzen elevation tiles, for hill shading.
- **Places and walking:** [Photon](https://photon.komoot.io) for address
  search, and [FOSSGIS OSRM](https://routing.openstreetmap.de) for walking
  directions (both OpenStreetMap data).
- **Alerts** come from AT's `servicealerts` feed.

`src/js/data/` is generated from the Android repo: the train network (stations,
platforms and lines, in AT's GTFS colours), the 27H's stops and the fleet list. Re-run this after changing them there:

    python tools/import_android.py

`python tools/make_icon.py` redraws the icons. `python tools/dev_server.py`
serves `src/` for trying things in a browser, and proxies the timetable
download. For live data there, add your key in Settings, or put it in
`src/js/keys.js` (gitignored) as `window.AKL_KEYS = { at: "…" }`.

## Building

GitHub Actions (`.github/workflows/build.yml`) builds the installer on
`windows-latest` on every push to `main`, with electron-builder (NSIS), and
publishes it to the `latest` release. No API key is built in. Locally, with Node 22:
`npm install`, then `npm start` to run it or `npm run dist` for the installer.
