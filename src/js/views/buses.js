// Buses: the watched stops, each with a live scene, the next bus in detail
// and the ones after; the whole route on a live map; the rest of today.
(function (A) {
  'use strict';
  const esc = A.esc, T = A.time;
  const V = {};
  const DIR = A.pal.dir;
  let root, lanes = {}, map, sceneRun = false, timetableAt = 0, routeFitted = false;

  V.mount = function (el) {
    root = el;
    root.innerHTML = `
      <div class="page">
        <header class="page-head">
          <div><h1 id="b-place"></h1><div class="sub" id="b-sub"></div></div>
          <div class="head-right">
            <div class="wx" id="b-wx"></div>
            <div class="clock" id="b-clock"></div>
            <button class="icon-btn" id="b-refresh" title="Refresh (Ctrl+R)">${A.icon('refresh')}</button>
          </div>
        </header>
        <div class="banner error" id="b-error" hidden></div>
        <div id="b-alerts"></div>
        <div class="pills" id="b-pills"></div>
        <div class="lanes" id="b-lanes"></div>
        <section class="card map-card" id="b-mapcard">
          <div class="card-head">
            <div><h2 id="b-maptitle">Live map</h2><div class="sub" id="b-mapsub"></div></div>
            <div class="card-tools">
              <div class="seg" id="b-basemap"><button data-b="satellite">Satellite</button><button data-b="streets">Map</button></div>
              <button class="icon-btn" id="b-expand" title="Bigger map">${A.icon('expand')}</button>
            </div>
          </div>
          <div class="route-map" id="b-map"></div>
          <div class="legend" id="b-legend"></div>
        </section>
        <section class="card" id="b-today">
          <div class="card-head"><div><h2>Rest of today</h2><div class="sub">Scheduled times; live times are above</div></div></div>
          <div class="today-grid" id="b-todaygrid"><div class="empty">Loading the timetable…</div></div>
        </section>
      </div>`;
    A.$('#b-refresh', root).onclick = () => { A.refresh('buses'); A.toast('Refreshing…'); };
    A.$('#b-expand', root).onclick = () => {
      const card = A.$('#b-mapcard', root);
      card.classList.toggle('expanded');
      A.$('#b-expand', root).innerHTML = A.icon(card.classList.contains('expanded') ? 'shrink' : 'expand');
      setTimeout(() => map && map.resize(), 50);
    };
    A.$$('#b-basemap button', root).forEach((b) => { b.onclick = () => A.settings.set('basemap', b.dataset.b); });
    A.on('buses', render);
    A.on('weather', renderWeather);
    A.on('alerts', renderAlerts);
    A.on('tick', renderClock);
    A.on('settings', (k) => { if (k === 'apiKey' || k === 'stops' || k === 'route') { timetableAt = 0; loadToday(); } });
    A.on('settings', (k) => {
      if (k === 'basemap' || k === '*') { syncBasemap(); }
      if (k === 'stops' || k === 'route' || k === 'place' || k === 'alerts' || k === 'walkMin' || k === '*') { lanes = {}; A.$('#b-lanes', root).innerHTML = ''; render(); timetableAt = 0; }
    });
    render();
    renderWeather();
  };

  V.show = function () {
    if (!map) {
      map = new A.MapView(A.$('#b-map', root), {
        cooperativeGestures: true,
        onPick: (p) => { if (p.kind === 'marker') { map.select(p.id === map.sel ? null : p.id); renderMapSub(); } },
        onBackground: () => { map.select(null); renderMapSub(); },
      });
      renderMap(true);
    }
    setTimeout(() => map.resize(), 30);
    syncBasemap();
    sceneRun = true;
    requestAnimationFrame(drawScenes);
    if (T.now() - timetableAt > 600) loadToday();
  };
  V.hide = function () { sceneRun = false; };

  function syncBasemap() {
    const b = A.settings.get('basemap');
    A.$$('#b-basemap button', root).forEach((x) => x.classList.toggle('on', x.dataset.b === b));
    if (map) map.setBasemap(b);
  }

  /** Disruptions on your route or at your stops, right up top. */
  function renderAlerts() {
    const el = A.$('#b-alerts', root);
    if (!el) return;
    const mine = A.alerts.mine();
    el.innerHTML = mine.slice(0, 2).map((a) => `<div class="buses-alert" data-go="alerts"><span class="chip ${a.cls}">${esc(a.label)}</span>` +
      `<span>${esc(a.header)}</span><small>${esc(A.alerts.when(a))}</small></div>`).join('');
    A.$$('[data-go]', el).forEach((b) => { b.onclick = () => A.show('alerts'); });
  }

  function renderClock(now) {
    const c = T.clockParts(now || T.now());
    A.$('#b-clock', root).innerHTML = `<b>${c.hm}</b><small>${c.ampm}</small>${A.liveBadge(A.state.busUpdated, now || T.now())}`;
  }

  function renderWeather() {
    const w = A.state.weather;
    const el = A.$('#b-wx', root);
    if (!w) { el.innerHTML = ''; return; }
    const night = A.isNight(T.hour());
    const [e, words] = A.weather.describe(w.code, w.cloudCover, night);
    const next = (w.hourly || []).slice(1, 7).map((h) => {
      const hr = +h.time.slice(11, 13);
      const [he] = A.weather.describe(h.code, 50, hr < 6 || hr > 19);
      return `<span title="${esc(h.rainChance)}% chance of rain"><small>${hr % 12 || 12}${hr < 12 ? 'a' : 'p'}</small>${he}<b>${Math.round(h.temp)}°</b></span>`;
    }).join('');
    el.innerHTML = `<div class="wx-now"><span class="wx-e">${e}</span><b>${Math.round(w.tempC)}°</b><small>${esc(words)}</small></div>` +
                   `<div class="wx-hours">${next}</div>`;
  }

  // ---------- one lane per watched stop ----------
  function laneFor(b, i) {
    if (lanes[b.code]) return lanes[b.code];
    const el = A.el(`<article class="card lane" data-code="${esc(b.code)}">
        <div class="scene-wrap">
          <canvas class="scene"></canvas>
          <div class="scene-top">
            <span class="lane-route"></span>
            <div class="dest"><div class="to"></div><div class="stopname"></div></div>
            <div class="big-count" data-big><b>--</b><small></small></div>
          </div>
          <button class="bell icon-btn" title="Alert me before each bus"></button>
        </div>
        <div class="lane-body"></div>
      </article>`);
    A.$('#b-lanes', root).appendChild(el);
    const lane = { el, i, scenery: new A.Scenery(i === 0, i + 3), progress: null, target: null, look: A.lookOf(null) };
    A.$('.bell', el).onclick = () => {
      const alerts = Object.assign({}, A.settings.get('alerts'));
      alerts[b.code] = !alerts[b.code];
      A.settings.set('alerts', alerts);
      A.toast(alerts[b.code] ? `You'll get an alert ${A.settings.get('alertMin')} min before each bus` : 'Alerts off for this stop');
      if (alerts[b.code] && !A.desktop && window.Notification && Notification.permission === 'default') Notification.requestPermission();
    };
    lanes[b.code] = lane;
    return lane;
  }

  function render() {
    const S = A.state;
    const now = T.now();
    A.$('#b-place', root).textContent = A.settings.get('place');
    const first = S.boards.find((b) => b.name);
    A.$('#b-sub', root).textContent = `${A.settings.get('route') || 'All routes'}${first ? ' · ' + first.name : ''}`;
    renderClock(now);
    const err = A.$('#b-error', root);
    err.hidden = !S.busError;
    err.textContent = S.busError || '';

    // "↑ Britomart 6 min" pills
    A.$('#b-pills', root).innerHTML = S.boards.map((b, i) => {
      const d = A.nextBus(b);
      return `<span class="pill"><i style="background:${DIR[i % 2]}">${i === 0 ? '↑' : '↓'}</i>${esc((d && d.headsign) || b.headsign || b.code)}` +
             `<b ${d ? `data-exp="${d.expected}"` : ''}>${d ? A.countdown(d.expected - now) : '—'}</b></span>`;
    }).join('');

    const alerts = A.settings.get('alerts') || {};
    S.boards.forEach((b, i) => {
      const lane = laneFor(b, i);
      const d = A.nextBus(b);
      const color = DIR[i % 2];
      lane.dest = d ? d.route : b.route;
      lane.look = A.lookOf(d && d.vehicle && (A.fleet.info(d.vehicle.label) || {}).model);
      const eta = d ? d.expected - now : null;
      lane.target = d && eta < 1500 ? Math.min(1, Math.max(0, 1 - eta / 1200)) : null;
      if (lane.progress == null || lane.tripId !== (d && d.tripId)) lane.progress = lane.target == null ? null : Math.max(0, lane.target - 0.05);
      lane.tripId = d && d.tripId;
      lane.moving = !!(d && d.live && eta > 30);
      lane.cancelled = !!(d && d.cancelled);

      const el = lane.el;
      A.$('.lane-route', el).innerHTML = A.routeBadge(lane.dest || A.settings.get('route'), color, true);
      A.$('.to', el).textContent = 'to ' + ((d && d.headsign) || b.headsign || '…');
      A.$('.stopname', el).textContent = `${b.name || 'Stop'} · stop ${b.code}`;
      const big = A.$('.big-count', el);
      if (d) { big.dataset.exp = d.expected; if (d.cancelled) big.dataset.cancelled = '1'; else delete big.dataset.cancelled; }
      else { delete big.dataset.exp; A.$('b', big).textContent = '--'; A.$('small', big).textContent = ''; }
      const bell = A.$('.bell', el);
      bell.innerHTML = A.icon(alerts[b.code] ? 'bell' : 'bellOff');
      bell.classList.toggle('on', !!alerts[b.code]);
      A.$('.lane-body', el).innerHTML = b.error && !b.departures.length ? `<div class="empty err">${esc(b.error)}</div>` : laneBody(b, d, color, now);
      A.paintPortraits(el);
    });
    A.tick();
    renderMap(false);
  }

  function laneBody(b, d, color, now) {
    if (!d) return `<div class="empty">No ${esc(A.settings.get('route') || '')} buses in the next few hours.</div>`;
    const p = A.punctuality(d.live ? d.delay : null);
    let h = `<div class="next-row">${A.chip(d.cancelled ? 'Cancelled' : p.text, d.cancelled ? 'late' : p.cls)}` +
            (d.live && !d.cancelled ? A.chip('● Live GPS', 'ok') : '') +
            `<div class="arrives"><b>Arrives ${T.clock(d.expected)}</b>` +
            (d.live && Math.abs(d.delay || 0) >= 60 ? `<s>timetabled ${T.clock(d.scheduled)}</s>` : '') + `</div></div>`;
    if (d.vehicle) h += A.vehicleRow(d.vehicle, { big: true });
    if (d.stopsAway != null) h += A.stopsTrack(b.code, d.stopsAway, color);
    const facts = [];
    if (d.vehicle) {
      const v = d.vehicle;
      if (b.lat) facts.push(`${A.km(v.lat, v.lon, b.lat, b.lon).toFixed(1)} km away`);
      if (v.speedKmh != null) facts.push(v.speedKmh < 2 ? 'Stopped' : `${Math.round(v.speedKmh)} km/h`);
      const occ = A.occupancy(v.occupancy);
      if (occ) facts.push(occ);
    }
    const walk = +A.settings.get('walkMin') || 0;
    if (walk && !d.cancelled) {
      const spare = d.expected - now - walk * 60;
      if (spare > 60) facts.push(`Leave in ${A.countdown(spare)} (${walk} min walk)`);
      else if (spare > -30) facts.push(`<b class="leave">Leave now</b>`);
      else {
        // this one's gone for you: which one can you still make?
        const next = b.departures.find((x) => !x.cancelled && x.expected - now - walk * 60 > 60);
        facts.push(next ? `Too late to walk to this one · catch the ${T.clock(next.expected)}, leave in ${Math.floor((next.expected - now - walk * 60) / 60)} min`
                        : 'Too late to walk to this one');
      }
    }
    if (facts.length) h += `<div class="facts">${facts.join('<span>·</span>')}</div>`;
    const later = b.departures.filter((x) => x !== d).slice(0, 5);
    if (later.length) {
      h += `<div class="later"><div class="later-head">Next buses</div>` + later.map((x) => {
        const q = A.punctuality(x.live ? x.delay : null);
        return `<div class="later-row"><b>${T.clock(x.expected)}</b>` +
               `<span class="${x.cancelled ? 'late' : q.cls}">${x.cancelled ? 'Cancelled' : q.text}${x.stopsAway != null ? `<small>${x.stopsAway} stops away</small>` : ''}</span>` +
               `${x.vehicle ? `<small class="model">${esc(((A.fleet.info(x.vehicle.label) || {}).model || {}).short || x.vehicle.label)}</small>` : '<small class="model"></small>'}` +
               `<em data-exp="${x.expected}">${A.countdown(x.expected - now)}</em></div>`;
      }).join('') + `</div>`;
    }
    return h;
  }

  // ---------- scenes: one animation loop for every lane ----------
  function drawScenes(ts) {
    if (!sceneRun) return;
    const t = ts / 1000, hour = T.hour(), wx = A.state.weather;
    for (const code of Object.keys(lanes)) {
      const lane = lanes[code];
      const c = A.$('canvas.scene', lane.el);
      const { ctx, w, h } = A.fitCanvas(c);
      if (w < 10) continue;
      if (lane.target != null) lane.progress = lane.progress == null ? lane.target : lane.progress + (lane.target - lane.progress) * 0.02;
      else lane.progress = null;
      A.drawScene(ctx, w, h, lane.scenery, {
        hour, t, progress: lane.progress, moving: lane.moving, cancelled: lane.cancelled, dest: lane.dest,
        look: lane.look, wx, dp: Math.max(1, h / 210),
      });
    }
    requestAnimationFrame(drawScenes);
  }

  // ---------- the route map ----------
  function renderMap(first) {
    if (!map) return;
    const S = A.state;
    const now = T.now();
    const withRoutes = S.boards.map((b, i) => ({ b, i, r: A.ROUTES[b.code] })).filter((x) => x.r);
    map.setLines(withRoutes.map(({ r, i }) => ({ coords: r.stops.map((s) => [s.lon, s.lat]), color: DIR[i % 2], width: 4.5, offset: i === 0 ? -2.5 : 2.5 })));
    const stops = [];
    withRoutes.forEach(({ b, i, r }) => r.stops.forEach((s) => {
      const mine = s.code === b.code;
      stops.push({ lon: s.lon, lat: s.lat, color: DIR[i % 2], big: mine, id: mine ? '' : s.code,
                   label: mine && i === 0 ? `You · ${A.settings.get('place')}` : undefined });
    }));
    map.setStops(stops);
    const marks = [];
    withRoutes.forEach(({ b, i }) => (b.departures || []).forEach((d) => {
      if (!d.vehicle || d.cancelled) return;
      marks.push({ id: d.tripId, lon: d.vehicle.lon, lat: d.vehicle.lat, bearing: d.vehicle.bearing, color: DIR[i % 2],
                   tag: A.countdown(d.expected - now) });
    }));
    map.setMarkers(marks);
    // frame the whole route once, as soon as we know it
    if (!routeFitted && withRoutes.length) {
      routeFitted = true;
      map.fit(withRoutes.flatMap(({ r }) => r.stops.map((s) => [s.lon, s.lat])), 40);
    }
    A.$('#b-maptitle', root).textContent = `${A.settings.get('route') || 'Route'} live map`;
    A.$('#b-legend', root).innerHTML = withRoutes.map(({ b, i }) =>
      `<span><i style="background:${DIR[i % 2]}"></i>to ${esc(b.headsign || '…')}</span>`).join('') +
      `<span class="hint">Ctrl + scroll to zoom · click a bus</span>`;
    renderMapSub();
  }

  function renderMapSub() {
    const S = A.state;
    const buses = S.boards.flatMap((b, i) => (b.departures || []).filter((d) => d.vehicle && !d.cancelled).map((d) => ({ b, d, i })));
    const sel = buses.find((x) => x.d.tripId === (map && map.sel));
    const el = A.$('#b-mapsub', root);
    if (sel) {
      const info = A.fleet.info(sel.d.vehicle.label);
      el.innerHTML = `${esc(sel.d.route)} to ${esc(sel.d.headsign)} · <span data-exp="${sel.d.expected}"></span> · ` +
        `${esc(info ? (info.model ? info.model.short : '') + ' ' + info.fleetNo : sel.d.vehicle.label)}` +
        (sel.d.vehicle.speedKmh != null ? ` · ${Math.round(sel.d.vehicle.speedKmh)} km/h` : '');
      A.tick();
    } else {
      el.textContent = buses.length ? `${buses.length} bus${buses.length === 1 ? '' : 'es'} on the way to you` : 'No buses heading your way are on the road yet';
    }
  }

  // ---------- the rest of today's timetable ----------
  async function loadToday() {
    timetableAt = T.now();
    const grid = A.$('#b-todaygrid', root);
    const route = A.settings.get('route');
    try {
      const cols = await Promise.all(A.settings.get('stops').map(async (code, i) => {
        const list = await A.buses.today(code, route);
        const b = A.state.boards.find((x) => x.code === code);
        return { code, i, list, head: (b && b.headsign) || (list[0] && list[0].headsign) || code };
      }));
      grid.innerHTML = cols.map(({ i, list, head }) => {
        let lastHour = -1;
        const cells = list.map((d) => {
          const p = T.parts(d.scheduled * 1000);
          const hr = p.h;
          const mark = hr !== lastHour ? `<em>${hr % 12 || 12}${hr < 12 ? 'am' : 'pm'}</em>` : '';
          lastHour = hr;
          return `${mark}<span>${T.clock(d.scheduled).replace(/ (am|pm)$/, '')}</span>`;
        }).join('');
        return `<div class="today-col"><h3><i style="background:${DIR[i % 2]}"></i>to ${esc(head)}<small>${list.length} left today</small></h3>` +
               `<div class="today-times">${cells || '<div class="empty">No more buses today</div>'}</div></div>`;
      }).join('');
    } catch (e) {
      grid.innerHTML = `<div class="empty err">${esc(e.message)}</div>`;
      timetableAt = 0;
    }
  }

  (A.views = A.views || {}).buses = V;
})(window.AKL);
