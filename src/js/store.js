// Live state and polling. Buses poll all the time (the tray and alerts need
// them); trains and the whole-network feed only while a screen shows them.
(function (A) {
  'use strict';
  const T = A.time;

  const S = A.state = {
    boards: [],            // one per watched stop
    busError: null,
    busUpdated: 0,
    trains: { list: [], before: {}, heading: {}, movedAt: 0, updated: 0, error: null },
    live: { buses: [], trains: [], ferries: [], updated: 0, loading: true, error: null },
    weather: null,
  };
  const need = { trains: 0, live: 0 };
  const kicks = {};
  const busy = {};

  /** A screen wants trains / the live feed while it's up. */
  A.need = function (what, on) {
    need[what] = Math.max(0, need[what] + (on ? 1 : -1));
    if (on) A.refresh(what);
  };
  A.refresh = function (what) { if (kicks[what]) kicks[what](); };

  function loop(name, everyMs, work, when) {
    let timer = null;
    const run = async () => {
      clearTimeout(timer);
      if (!when || when()) {
        if (!busy[name]) {
          busy[name] = true;
          try { await work(); } catch (e) { console.warn(name, e); } finally { busy[name] = false; }
        }
      }
      timer = setTimeout(run, everyMs);
    };
    kicks[name] = run;
    run();
  }

  // ---------- buses ----------
  async function refreshBuses() {
    const codes = A.settings.get('stops');
    const route = A.settings.get('route');
    const out = await Promise.all(codes.map(async (code) => {
      try { return await A.buses.board(code, route); } catch (e) {
        const old = S.boards.find((b) => b.code === code) || { code, departures: [], name: '', headsign: '' };
        return Object.assign({}, old, { error: e.message });
      }
    }));
    S.boards = out;
    S.busError = (out.find((b) => b.error) || {}).error || null;
    S.busUpdated = T.now();
    A.emit('buses', S);
    updateTray();
    checkAlerts();
  }

  // ---------- trains: markers glide from where they are to each new fix ----------
  const GLIDE = 12000;
  A.glide = (movedAt, now) => {
    const t = Math.min(1, Math.max(0, (now - movedAt) / GLIDE));
    return t * t * (3 - 2 * t);
  };
  async function refreshTrains() {
    try {
      const fresh = await A.trains.poll();
      const old = S.trains;
      const now = performance.now();
      const f = A.glide(old.movedAt, now);
      const before = {};
      const heading = Object.assign({}, old.heading);
      for (const t of old.list) {
        const b = old.before[t.v.id];
        before[t.v.id] = b ? [b[0] + (t.x - b[0]) * f, b[1] + (t.y - b[1]) * f] : [t.x, t.y];
      }
      for (const t of fresh) {
        const b = before[t.v.id];
        if (!b) continue;
        const dx = t.x - b[0], dy = t.y - b[1];
        if (Math.hypot(dx, dy) > 0.25) heading[t.v.id] = Math.atan2(dy, dx);
      }
      S.trains = { list: fresh, before, heading, movedAt: now, updated: T.now(), error: null };
    } catch (e) {
      S.trains = Object.assign({}, S.trains, { error: e.message });
    }
    A.emit('trains', S.trains);
  }

  async function refreshLive() {
    try {
      const all = await A.live.all();
      S.live = Object.assign(all, { updated: T.now(), loading: false, error: null });
    } catch (e) {
      S.live = Object.assign({}, S.live, { loading: false, error: e.message });
    }
    A.emit('live', S.live);
  }

  async function refreshWeather() {
    const w = await A.weather.fetch();
    if (w) { S.weather = w; A.emit('weather', w); }
  }

  // ---------- the tray tooltip: the next bus each way ----------
  A.nextBus = function (b) {
    return (b.departures || []).find((d) => !d.cancelled && d.expected >= T.now() - 30) || null;
  };
  function updateTray() {
    if (!A.desktop) return;
    const now = T.now();
    const lines = S.boards.map((b) => {
      const d = A.nextBus(b);
      const head = (d && d.headsign) || b.headsign || b.code;
      return d ? `${d.route} to ${head}: ${A.countdown(d.expected - now)}${d.live ? '' : ' (sched.)'}` : `${head}: no buses soon`;
    });
    A.desktop.setTray({ tooltip: 'AKL Live\n' + lines.join('\n'), lines });
  }
  setInterval(updateTray, 30000);

  // ---------- alerts: "your bus is N minutes away" ----------
  const alerted = new Set();
  function checkAlerts() {
    const alerts = A.settings.get('alerts') || {};
    const lead = (+A.settings.get('alertMin') || 5) * 60;
    const walk = +A.settings.get('walkMin') || 0;
    const now = T.now();
    for (const b of S.boards) {
      if (!alerts[b.code]) continue;
      for (const d of b.departures || []) {
        const eta = d.expected - now;
        if (d.cancelled || eta > lead || eta < 60 || alerted.has(d.tripId)) continue;
        alerted.add(d.tripId);
        const p = A.punctuality(d.live ? d.delay : null);
        const leave = walk ? (eta - walk * 60 > 60 ? ` Leave in ${A.countdown(eta - walk * 60)}.` : ' Leave now.') : '';
        const title = `${d.route} to ${d.headsign} in ${A.countdown(eta)}`;
        const body = `${b.name || 'Stop ' + b.code}: ${d.live ? p.text.toLowerCase() + ', live GPS' : 'scheduled'}.${leave}`;
        if (A.desktop) A.desktop.notify(title, body);
        else if (window.Notification && Notification.permission === 'granted') new Notification(title, { body });
        A.emit('alerted', { title, body });
      }
    }
  }
  setInterval(checkAlerts, 15000);

  A.start = function () {
    loop('buses', 30000, refreshBuses);
    loop('trains', 15000, refreshTrains, () => need.trains > 0 && !document.hidden);
    loop('live', 20000, refreshLive, () => need.live > 0 && !document.hidden);
    loop('weather', 15 * 60000, refreshWeather);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { A.refresh('trains'); A.refresh('live'); }
    });
    A.on('settings', (k) => { if (k === 'stops' || k === 'route' || k === 'apiKey' || k === '*') A.refresh('buses'); });
  };
})(window.AKL);
