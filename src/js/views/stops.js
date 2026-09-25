// Stops: find any stop or station in Auckland and see everything leaving it,
// live, with the vehicles on the way, alerts, and directions there.
(function (A) {
  'use strict';
  const esc = A.esc, T = A.time;
  const V = {};
  let root, map, cur = null, deps = null, timer = null, nearList = null, nearAt = null, seq = 0;

  const favs = () => A.settings.get('favStops') || [];
  const isFav = (id) => favs().some((f) => f.id === id);
  const modeIcon = (m) => (m & 2 ? '🚆' : m & 4 ? '⛴' : '🚏');

  V.mount = function (el) {
    root = el;
    root.innerHTML = `
      <div class="page-map">
        <div id="s-map" class="full-map"></div>
        <aside class="float-panel stops-panel">
          <div class="fp-head"><h1>Stops</h1><div class="sub">Live departures from any stop, station or wharf</div></div>
          <label class="search">${A.icon('search', 18)}<input id="s-q" placeholder="Stop name or number" autocomplete="off" spellcheck="false"></label>
          <div class="results" id="s-body"></div>
        </aside>
        <div class="map-tools right"><div class="seg" id="s-basemap"><button data-b="satellite">Satellite</button><button data-b="streets">Map</button></div></div>
      </div>`;
    let t = null;
    const q = A.$('#s-q', root);
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => search(q.value), 150); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { q.value = ''; search(''); } });
    A.$$('#s-basemap button', root).forEach((b) => { b.onclick = () => A.settings.set('basemap', b.dataset.b); });
    A.on('settings', (k) => { if (k === 'basemap' || k === '*') syncBasemap(); if (k === 'favStops' && !cur) home(); });
    A.on('gtfs', () => { if (A.gtfsState.ready && !cur && !A.$('#s-q', root).value) home(); });
    A.on('alerts', () => { if (cur) renderStop(); });
    home();
  };
  V.show = function () {
    if (!map) {
      map = new A.MapView(A.$('#s-map', root), {
        allStops: true, journeyPad: 60,
        onPick: (p) => { if (p.kind === 'anystop') V.open(p.id); else if (p.kind === 'marker') { /* a bus coming */ } },
        onContext: (ll) => V.near(ll.lat, ll.lng),
      });
      const h = A.places.home();
      if (h) map.map.jumpTo({ center: [h.lon, h.lat], zoom: 15 });
    }
    syncBasemap();
    setTimeout(() => map.resize(), 30);
    clearInterval(timer);
    timer = setInterval(() => { if (cur && !document.hidden && A.settings.get('view') === 'stops') loadDeps(); }, 30000);
  };
  V.hide = function () { clearInterval(timer); };
  V.key = function (e) { if (e.key === 'Escape' && cur) { cur = null; home(); } };

  function syncBasemap() {
    const b = A.settings.get('basemap');
    A.$$('#s-basemap button', root).forEach((x) => x.classList.toggle('on', x.dataset.b === b));
    if (map) map.setBasemap(b);
  }

  // ---------- lists ----------
  function row(s, extra) {
    return `<button class="stop-row2" data-id="${esc(s.id)}"><span class="sr-i">${modeIcon(s.modes)}</span>
      <span class="sr-t"><b>${esc(s.name)}</b><small>${s.station ? 'Station' : 'Stop ' + esc(s.code)}${s.platform ? ' · Platform ' + esc(s.platform) : ''}${extra ? ' · ' + extra : ''}</small>
      ${s.routes && s.routes.length ? `<span class="sr-routes">${s.routes.slice(0, 10).map((r) => `<em>${esc(r.short || r)}</em>`).join('')}</span>` : ''}</span>
      ${isFav(s.id) ? '<span class="star on">★</span>' : ''}</button>`;
  }
  function wire(box) { A.$$('.stop-row2', box).forEach((b) => { b.onclick = () => V.open(b.dataset.id); }); }

  async function home() {
    cur = null;
    const my = ++seq;                 // a stop opened meanwhile wins
    const box = A.$('#s-body', root);
    if (!box) return;
    if (!A.gtfsState.ready) { box.innerHTML = `<div class="empty"><span class="loading-bar"><i style="width:${A.gtfsState.pct || 3}%"></i></span>${esc(A.gtfsState.text)}</div>`; return; }
    const h = A.places.home();
    const at = nearAt || (h ? [h.lat, h.lon] : null);
    if (at && !nearList) nearList = await A.gtfs.nearby(at[0], at[1], 700, 10);
    if (my !== seq) return;
    const f = favs();
    box.innerHTML = (f.length ? `<div class="list-head">★ Favourites</div>` + f.map((s) => row(s)).join('') : '') +
      (nearList ? `<div class="list-head">${nearAt ? 'Near where you clicked' : 'Near ' + esc((h && h.name) || 'home')}</div>` +
        nearList.map((s) => row(s, `${s.dist} m`)).join('') : '') +
      `<p class="help">Click any stop on the map (zoom in to see them), right-click for the stops near a spot, or search by name or the number on the sign.</p>`;
    wire(box);
  }
  async function search(q) {
    const box = A.$('#s-body', root);
    if (!q.trim()) { home(); return; }
    const my = ++seq;
    cur = null;
    const list = await A.gtfs.searchStops(q, 25);
    if (my !== seq) return;
    box.innerHTML = list.length ? list.map((s) => row(s)).join('') : '<div class="empty">No stops match that.</div>';
    wire(box);
  }
  /** The stops around a point (right-click on any map). */
  V.near = async function (lat, lon) {
    nearAt = [lat, lon];
    nearList = await A.gtfs.nearby(lat, lon, 600, 12);
    cur = null;
    if (map) map.flyTo(lon, lat, 16);
    home();
  };

  // ---------- one stop ----------
  V.open = async function (id) {
    const my = ++seq;
    const s = await A.gtfs.stop(id);
    if (!s || my !== seq) return;
    cur = s; deps = null;
    A.settings.set('view', 'stops');
    renderStop();
    if (map) {
      map.flyTo(s.lon, s.lat, 16.5);
      map.setStops([{ lon: s.lon, lat: s.lat, color: s.modes & 2 ? A.pal.navy : A.pal.atBlue, big: true, label: s.name }]);
    }
    loadDeps();
  };

  async function loadDeps() {
    if (!cur) return;
    const my = seq, s = cur;
    const codes = s.station ? s.platforms.map((p) => p.code).filter(Boolean) : [s.code];
    try {
      const boards = await Promise.all(codes.map((c) => A.buses.board(c, '').catch(() => null)));
      if (my !== seq) return;
      const all = [];
      boards.forEach((b, i) => { if (b) b.departures.forEach((d) => all.push(Object.assign({ platform: s.station ? s.platforms[i].platform : '' }, d))); });
      all.sort((a, b) => a.expected - b.expected);
      deps = all.slice(0, 40);
    } catch (e) { deps = { error: e.message }; }
    renderStop();
    // the vehicles on their way here
    if (map && Array.isArray(deps)) {
      map.setMarkers(deps.filter((d) => d.vehicle && !d.cancelled).slice(0, 12).map((d) => ({
        id: d.tripId, lon: d.vehicle.lon, lat: d.vehicle.lat, bearing: d.vehicle.bearing, color: A.pal.atBlue,
        tag: `${esc(d.route)} · ${A.countdown(d.expected - T.now())}`,
      })));
    }
  }

  function renderStop() {
    const box = A.$('#s-body', root);
    const s = cur;
    if (!box || !s) return;
    const now = T.now();
    const alerts = A.alerts.matching(s.routes.map((r) => r.short), [s.id, s.code].concat(s.platforms.map((p) => p.id))).filter((a) => a.active);
    let h = `<button class="back-link" id="s-back">${A.icon('back', 16)} Stops</button>
      <div class="stop-head"><div class="roundel big">${modeIcon(s.modes)}</div><div><h2>${esc(s.name)}</h2>
        <div class="sub">${s.station ? `Station · ${s.platforms.length} platforms` : `Stop ${esc(s.code)}${s.platform ? ' · Platform ' + esc(s.platform) : ''}`}${s.parent ? ' · ' + esc(s.parent) : ''}</div></div>
        <button class="star-btn${isFav(s.id) ? ' on' : ''}" id="s-fav" title="Favourite">★</button></div>
      <div class="stop-actions"><button class="btn" data-a="to">Directions here</button><button class="btn" data-a="from">From here</button>
        ${!s.station ? `<button class="btn" data-a="board">Add to Buses</button>` : ''}</div>
      <div class="route-chips">${s.routes.map((r) => `<span class="rc" data-type="${r.type}">${esc(r.short)}</span>`).join('')}</div>`;
    if (alerts.length) h += `<div class="alert-box">${alerts.map((a) => `<div><span class="chip ${a.cls}">${esc(a.label)}</span> <b>${esc(a.header)}</b><small>${esc(A.alerts.when(a))}</small></div>`).join('')}</div>`;
    h += `<div class="list-head">Departures <span class="lh-live" id="s-live"></span></div>`;
    if (!deps) h += `<div class="skeleton"></div><div class="skeleton"></div>`;
    else if (deps.error) h += `<div class="empty err">${esc(deps.error)}</div>`;
    else if (!deps.length) h += `<div class="empty">Nothing leaving here in the next few hours.</div>`;
    else {
      h += `<div class="deps2">` + deps.map((d) => {
        const p = A.punctuality(d.live ? d.delay : null);
        const info = d.vehicle && A.fleet.info(d.vehicle.label);
        return `<div class="dep2${d.cancelled ? ' cancelled' : ''}">${A.routeBadge(d.route, routeColor(d.route))}
          <div class="d2-main"><b>${esc(d.headsign)}</b><small><span class="${d.cancelled ? 'late' : p.cls}">${d.cancelled ? 'Cancelled' : p.text}</span>` +
          `${d.platform ? ' · Platform ' + esc(d.platform) : ''}${d.stopsAway != null ? ` · ${d.stopsAway} stops away` : ''}${info && info.model ? ' · ' + esc(info.model.short) : ''}` +
          `${d.vehicle && A.occupancy(d.vehicle.occupancy) ? ' · ' + A.occupancy(d.vehicle.occupancy) : ''}</small></div>
          <div class="d2-time"><em data-exp="${d.expected}">${A.countdown(d.expected - now)}</em><small>${T.clock(d.expected)}${d.live ? ' <i class="dot-live"></i>' : ''}</small></div></div>`;
      }).join('') + `</div>`;
    }
    box.innerHTML = h;
    A.$('#s-back', box).onclick = () => { cur = null; if (map) { map.setStops([]); map.setMarkers([]); } home(); };
    A.$('#s-fav', box).onclick = () => {
      const f = favs().filter((x) => x.id !== s.id);
      if (!isFav(s.id)) f.unshift({ id: s.id, code: s.code, name: s.name, modes: s.modes, station: s.station, lat: s.lat, lon: s.lon });
      A.settings.set('favStops', f);
      renderStop();
    };
    A.$$('.stop-actions [data-a]', box).forEach((b) => {
      b.onclick = () => {
        const place = { name: s.name, sub: s.station ? 'Station' : `Stop ${s.code}`, lat: s.lat, lon: s.lon, type: 'stop', code: s.code, id: s.id, modes: s.modes };
        if (b.dataset.a === 'board') {
          const stops = A.settings.get('stops').filter((c) => c !== s.code).concat([s.code]).slice(-4);
          A.settings.set('stops', stops);
          if (!s.routes.some((r) => r.short === A.settings.get('route'))) A.settings.set('route', '');
          A.toast(`Stop ${s.code} added to the Buses screen`);
          return;
        }
        A.show('plan');
        A.views.plan.goTo(place, b.dataset.a === 'from');
      };
    });
    const live = A.$('#s-live', box);
    if (live && Array.isArray(deps)) live.innerHTML = A.liveBadge(now, now);
    A.tick();
  }
  function routeColor(short) {
    const li = A.NET.lineIds.indexOf(short);
    return li >= 0 ? A.NET.lineColors[li] : A.pal.atBlue;
  }

  (A.views = A.views || {}).stops = V;
})(window.AKL);
