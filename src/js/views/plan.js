// Directions: plan a journey on any bus, train and ferry (our own planner over
// AT's timetable), with live delays, where your bus is and what it is, walking
// turns, alerts, and a reminder when it's time to leave.
(function (A) {
  'use strict';
  const esc = A.esc, T = A.time;
  const V = {};
  let root, map, from = null, to = null, when = { mode: 'now', time: null }, results = null, sel = -1, hover = 0;
  let live = {}, liveTimer = null, walks = {}, picking = null, planSeq = 0, ctxPopup = null;
  const reminders = new Map();

  const MODE_ICON = { walk: '🚶', bus: '🚌', train: '🚆', ferry: '⛴' };
  const opts = () => Object.assign({ maxWalk: 900, walkSpeed: 1.3, bus: true, train: true, ferry: true, maxRides: 4 }, A.settings.get('planOpts') || {});
  const dur = (s) => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
  const dist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
  const placeIcon = (p) => ({ home: '🏠', work: '💼', stop: p.modes & 2 ? '🚆' : p.modes & 4 ? '⛴' : '🚏', recent: '🕘', pin: '📍', place: '📍' }[p.type] || '📍');

  // ======================= a place search box (also used in Settings) =======================
  /** Wires an <input> to search saved places, stops and addresses. onPick(place). */
  A.placeInput = function (input, box, onPick, o) {
    o = o || {};
    let items = [], active = -1, timer = null, token = 0;
    const show = (list) => {
      items = list; active = list.length ? 0 : -1;
      box.innerHTML = list.map((p, i) => `<button class="sg${i === active ? ' on' : ''}" data-i="${i}"><span class="sg-i">${p.icon || placeIcon(p)}</span>` +
        `<span class="sg-t"><b>${esc(p.name)}</b><small>${esc(p.sub || '')}</small></span>${p.hint ? `<em>${esc(p.hint)}</em>` : ''}</button>`).join('') ||
        (input.value.trim().length > 2 ? '<div class="sg-empty">No matches</div>' : '');
      box.hidden = !box.innerHTML;
      A.$$('.sg', box).forEach((b) => { b.onmousedown = (e) => { e.preventDefault(); choose(+b.dataset.i); }; });
    };
    const choose = (i) => {
      const p = items[i];
      if (!p) return;
      box.hidden = true;
      if (p.action) { p.action(); return; }
      input.value = p.name;
      onPick(p);
    };
    const saved = () => {
      const out = [];
      const h = A.places.home(); if (h) out.push(Object.assign({}, h, { type: 'home', hint: 'Home' }));
      const w = A.places.work(); if (w) out.push(Object.assign({}, w, { type: 'work', hint: 'Work' }));
      return out;
    };
    const suggest = async () => {
      const q = input.value.trim();
      const my = ++token;
      if (!q) {
        const base = saved();
        if (o.pick) base.push({ name: 'Choose on the map', sub: 'Click anywhere on the map', icon: '🗺️', action: o.pick });
        show(base.concat(A.places.recents().map((r) => Object.assign({}, r, { type: r.type === 'stop' ? 'stop' : 'recent' }))));
        return;
      }
      const ql = q.toLowerCase();
      const first = saved().filter((p) => p.hint.toLowerCase().startsWith(ql) || p.name.toLowerCase().includes(ql));
      const stops = (await A.gtfs.searchStops(q, 6).catch(() => [])).map((s) => ({
        name: s.name, sub: `${s.station ? 'Station' : 'Stop ' + s.code}${s.routes && s.routes.length ? ' · ' + s.routes.slice(0, 6).join(', ') : ''}`,
        lat: s.lat, lon: s.lon, type: 'stop', code: s.code, id: s.id, modes: s.modes,
      }));
      if (my !== token) return;
      show(first.concat(stops));
      const places = await A.places.search(q).catch(() => []);
      if (my !== token) return;
      show(first.concat(stops.slice(0, 4), places.slice(0, 6), stops.slice(4)));
    };
    input.addEventListener('focus', () => { input.select(); suggest(); });
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(suggest, 200); });
    input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 120));
    input.addEventListener('keydown', (e) => {
      if (box.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length);
        A.$$('.sg', box).forEach((b, i) => b.classList.toggle('on', i === active));
      } else if (e.key === 'Enter') { e.preventDefault(); choose(Math.max(0, active)); input.blur(); }
      else if (e.key === 'Escape') { box.hidden = true; input.blur(); }
    });
  };

  // ======================= the screen =======================
  V.mount = function (el) {
    root = el;
    root.innerHTML = `
      <div class="page-map">
        <div id="p-map" class="full-map"></div>
        <aside class="float-panel plan-panel">
          <div class="fp-head"><h1>Directions</h1><div class="sub" id="p-status"></div></div>
          <div class="od card-inset">
            <div class="od-row"><i class="od-dot a"></i><input id="p-from" placeholder="Starting from" autocomplete="off" spellcheck="false"></div>
            <div class="od-row"><i class="od-dot b"></i><input id="p-to" placeholder="Where to?" autocomplete="off" spellcheck="false"></div>
            <i class="od-line"></i>
            <button class="swap icon-btn small" id="p-swap" title="Swap">⇅</button>
            <div class="suggest" id="p-sug-from" hidden></div>
            <div class="suggest" id="p-sug-to" hidden></div>
          </div>
          <div class="when-row">
            <div class="seg" id="p-when"><button data-w="now" class="on">Leave now</button><button data-w="depart">Depart at</button><button data-w="arrive">Arrive by</button></div>
            <select id="p-day" hidden><option value="0">Today</option><option value="1">Tomorrow</option></select>
            <input type="time" id="p-time" hidden>
            <button class="icon-btn small" id="p-opts-btn" title="Options">${A.icon('settings', 18)}</button>
          </div>
          <div class="opts" id="p-opts" hidden></div>
          <div class="pick-hint" id="p-pick" hidden></div>
          <div class="results" id="p-results"></div>
        </aside>
        <div class="map-tools right"><div class="seg" id="p-basemap"><button data-b="satellite">Satellite</button><button data-b="streets">Map</button></div></div>
      </div>`;
    A.placeInput(A.$('#p-from', root), A.$('#p-sug-from', root), (p) => setPlace('from', p), { pick: () => startPick('from') });
    A.placeInput(A.$('#p-to', root), A.$('#p-sug-to', root), (p) => setPlace('to', p), { pick: () => startPick('to') });
    A.$('#p-swap', root).onclick = () => { [from, to] = [to, from]; syncInputs(); run(); };
    A.$$('#p-when button', root).forEach((b) => { b.onclick = () => setWhen(b.dataset.w); });
    A.$('#p-time', root).onchange = () => { when.time = timeFromInput(); run(); };
    A.$('#p-day', root).onchange = () => { when.time = timeFromInput(); run(); };
    A.$('#p-opts-btn', root).onclick = () => { const o = A.$('#p-opts', root); o.hidden = !o.hidden; renderOpts(); };
    A.$$('#p-basemap button', root).forEach((b) => { b.onclick = () => A.settings.set('basemap', b.dataset.b); });
    A.on('settings', (k) => { if (k === 'basemap' || k === '*') syncBasemap(); });
    A.on('gtfs', status);
    A.on('alerts', () => { if (results) render(); });
    A.on('tick', () => { if (results) updateTimes(); });
    from = A.places.home();
    syncInputs();
    status();
    render();
  };

  V.show = function () {
    if (!map) {
      map = new A.MapView(A.$('#p-map', root), {
        allStops: true, journeyPad: { top: 70, bottom: 70, left: 470, right: 80 },
        onPick: (p) => { if (p.kind === 'anystop') stopPopup(p); },
        onBackground: (ll) => { if (picking && ll) pickAt(ll); else closeCtx(); },
        onContext: (ll) => contextMenu(ll),
      });
      map.fit([A.AKL_BOUNDS[0], A.AKL_BOUNDS[1]], { top: 40, bottom: 40, left: 440, right: 40 });
      if (results) drawJourney(true);
    }
    syncBasemap();
    setTimeout(() => map.resize(), 30);
    if (!from || !to) setTimeout(() => A.$(from ? '#p-to' : '#p-from', root).focus(), 60);
    startLive();
  };
  V.hide = function () { clearInterval(liveTimer); };
  V.key = function (e) { if (e.key === 'Escape') { if (sel >= 0) { sel = -1; render(); drawJourney(true); } else if (picking) stopPick(); } };

  /** Plan to (or from) somewhere, from elsewhere in the app. */
  V.goTo = function (place, asFrom) {
    if (asFrom) from = place; else { to = place; if (!from) from = A.places.home(); }
    syncInputs();
    run();
  };

  function syncBasemap() {
    const b = A.settings.get('basemap');
    A.$$('#p-basemap button', root).forEach((x) => x.classList.toggle('on', x.dataset.b === b));
    if (map) map.setBasemap(b);
  }
  function syncInputs() {
    A.$('#p-from', root).value = from ? from.name : '';
    A.$('#p-to', root).value = to ? to.name : '';
  }
  function setPlace(which, p) {
    if (which === 'from') from = p; else to = p;
    A.places.remember(p);
    syncInputs();
    if (from && to) run(); else A.$(which === 'from' ? '#p-to' : '#p-from', root).focus();
  }
  function setWhen(mode) {
    when.mode = mode;
    A.$$('#p-when button', root).forEach((b) => b.classList.toggle('on', b.dataset.w === mode));
    const input = A.$('#p-time', root);
    input.hidden = mode === 'now';
    A.$('#p-day', root).hidden = mode === 'now';
    if (mode !== 'now' && !input.value) {
      const p = T.parts((T.now() + (mode === 'arrive' ? 3600 : 900)) * 1000);
      input.value = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
    }
    when.time = mode === 'now' ? null : timeFromInput();
    run();
  }
  function timeFromInput() {
    const v = A.$('#p-time', root).value || '00:00';
    return T.serviceEpoch(T.date(null, +A.$('#p-day', root).value || 0), v + ':00');
  }
  /** Plan for tomorrow morning (from the "services have finished" note). */
  function tomorrowAt(hm) {
    setWhen('depart');
    A.$('#p-day', root).value = '1';
    A.$('#p-time', root).value = hm;
    when.time = timeFromInput();
    run();
  }

  function status() {
    const g = A.gtfsState;
    const el = A.$('#p-status', root);
    if (!el) return;
    el.innerHTML = g.ready ? `Every bus, train and ferry · ${g.stats.trips.toLocaleString()} trips today`
      : g.error ? `<span class="err">${esc(g.error)}</span>`
      : `<span class="loading-bar"><i style="width:${g.pct || 3}%"></i></span>${esc(g.text)}`;
    if (g.ready && from && to && !results) run();
  }

  function renderOpts() {
    const o = opts();
    const chip = (key, val, label, cur) => `<button class="fchip${cur === val ? ' on' : ''}" data-k="${key}" data-v="${val}">${label}</button>`;
    const tog = (key, label) => `<button class="fchip${o[key] ? ' on' : ''}" data-t="${key}">${label}</button>`;
    A.$('#p-opts', root).innerHTML = `
      <div class="opt-row"><span>Walk at most</span>${[500, 900, 1400].map((m) => chip('maxWalk', m, dist(m), o.maxWalk)).join('')}</div>
      <div class="opt-row"><span>Walking pace</span>${[[1.0, 'Easy'], [1.3, 'Normal'], [1.6, 'Brisk']].map(([v, l]) => chip('walkSpeed', v, l, o.walkSpeed)).join('')}</div>
      <div class="opt-row"><span>Changes</span>${[[1, 'None'], [2, '1'], [3, '2'], [4, 'Any']].map(([v, l]) => chip('maxRides', v, l, o.maxRides)).join('')}</div>
      <div class="opt-row"><span>Travel by</span>${tog('bus', '🚌 Bus')}${tog('train', '🚆 Train')}${tog('ferry', '⛴ Ferry')}</div>`;
    A.$$('#p-opts [data-k]', root).forEach((b) => { b.onclick = () => { const x = opts(); x[b.dataset.k] = +b.dataset.v; A.settings.set('planOpts', x); renderOpts(); run(); }; });
    A.$$('#p-opts [data-t]', root).forEach((b) => { b.onclick = () => { const x = opts(); x[b.dataset.t] = !x[b.dataset.t]; A.settings.set('planOpts', x); renderOpts(); run(); }; });
  }

  // ---------- choosing on the map ----------
  function startPick(which) {
    picking = which;
    const h = A.$('#p-pick', root);
    h.hidden = false;
    h.innerHTML = `Click the map to choose ${which === 'from' ? 'where you start' : 'where you\'re going'} <button class="btn small" id="p-pick-x">Cancel</button>`;
    A.$('#p-pick-x', root).onclick = stopPick;
  }
  function stopPick() { picking = null; A.$('#p-pick', root).hidden = true; }
  async function pickAt(ll) {
    const which = picking;
    stopPick();
    const p = await A.places.reverse(ll.lat, ll.lng);
    p.type = 'pin';
    setPlace(which, p);
  }
  function closeCtx() { if (ctxPopup) { ctxPopup.remove(); ctxPopup = null; } }
  function contextMenu(ll) {
    closeCtx();
    const el = A.el(`<div class="ctx"><button data-a="from">Directions from here</button><button data-a="to">Directions to here</button><button data-a="near">Stops near here</button></div>`);
    ctxPopup = new maplibregl.Popup({ closeButton: false, offset: 6, className: 'ctx-pop' }).setLngLat(ll).setDOMContent(el).addTo(map.map);
    el.onclick = async (e) => {
      const a = e.target.dataset.a;
      if (!a) return;
      closeCtx();
      if (a === 'near') { A.show('stops'); A.views.stops.near(ll.lat, ll.lng); return; }
      const p = await A.places.reverse(ll.lat, ll.lng);
      p.type = 'pin';
      setPlace(a, p);
    };
  }
  function stopPopup(p) {
    closeCtx();
    const el = A.el(`<div class="ctx"><div class="ctx-title">${esc(p.name)} <small>${esc(p.code)}</small></div>` +
      `<button data-a="to">Directions to this stop</button><button data-a="from">Directions from this stop</button><button data-a="deps">Live departures</button></div>`);
    ctxPopup = new maplibregl.Popup({ closeButton: false, offset: 10, className: 'ctx-pop' });
    A.gtfs.stop(p.id).then((s) => {
      if (!s) return;
      ctxPopup.setLngLat([s.lon, s.lat]).setDOMContent(el).addTo(map.map);
      el.onclick = (e) => {
        const a = e.target.dataset.a;
        if (!a) return;
        closeCtx();
        const place = { name: s.name, sub: `Stop ${s.code}`, lat: s.lat, lon: s.lon, type: 'stop', code: s.code, id: s.id, modes: s.modes };
        if (a === 'deps') { A.show('stops'); A.views.stops.open(s.id); } else setPlace(a, place);
      };
    });
  }

  // ---------- planning ----------
  async function run() {
    if (!from || !to) { results = null; render(); return; }
    const my = ++planSeq;
    sel = -1; hover = 0; live = {}; walks = {};
    results = { loading: true };
    render();
    const time = when.mode === 'now' ? T.now() : (when.time || T.now());
    try {
      const r = await A.gtfs.plan({ lat: from.lat, lon: from.lon, name: from.name }, { lat: to.lat, lon: to.lon, name: to.name }, time, opts(), when.mode === 'arrive');
      if (my !== planSeq) return;
      results = r;
      tag(r.itineraries);
    } catch (e) {
      if (my !== planSeq) return;
      results = { error: e.message };
    }
    render();
    drawJourney(true);
    refreshLive();
  }

  /** "Fastest", "Least walking", "Fewest changes" */
  function tag(list) {
    if (!list || list.length < 2) return;
    const best = (f) => list.reduce((a, b) => (f(b) < f(a) ? b : a));
    best((i) => i.end).tags = ['Fastest'];
    const w = best((i) => i.walk); (w.tags = w.tags || []).push('Least walking');
    const c = best((i) => i.transfers * 1e6 + i.end); if (c.transfers < list[0].transfers) (c.tags = c.tags || []).push('Fewest changes');
  }

  // ---------- live: where each ride's bus is, and how late ----------
  function rides(it) { return it.legs.filter((l) => l.mode !== 'walk'); }
  async function refreshLive() {
    if (!results || !results.itineraries || !results.itineraries.length) return;
    const trips = Array.from(new Set(results.itineraries.flatMap((it) => rides(it).map((l) => l.tripId))));
    try {
      const [ups, vehs] = await Promise.all([A.tripUpdates(trips), vehiclesFor(trips)]);
      for (const id of trips) live[id] = { u: ups[id] || null, v: vehs[id] || null };
    } catch (e) { /* keep what we had */ }
    render(true);
    drawJourney(false);
  }
  async function vehiclesFor(ids) {
    const out = {};
    for (let i = 0; i < ids.length; i += 30) {
      const j = await A.api.get('/realtime/legacy/vehiclelocations?tripid=' + ids.slice(i, i + 30).join(','));
      for (const e of (j && j.response && j.response.entity) || []) { const v = A.parseVehicle(e); if (v && v.tripId) out[v.tripId] = v; }
    }
    return out;
  }
  function startLive() {
    clearInterval(liveTimer);
    liveTimer = setInterval(() => { if (!document.hidden && A.settings.get('view') === 'plan') refreshLive(); }, 30000);
  }
  /** Live facts for a ride: expected times at your stops, where the vehicle is. */
  function liveFor(l) {
    const x = live[l.tripId];
    if (!x) return null;
    const u = x.u, v = x.v;
    let delay = null, away = null, passed = false, cancelled = false;
    if (u) {
      cancelled = u.cancelled;
      delay = u.seq === l.from.seq && u.time ? u.time - l.from.dep : u.delay;
      if (u.seq != null && l.from.seq != null) { away = l.from.seq - u.seq; passed = away < 0 && T.now() > l.from.dep - 60; }
    }
    return { delay, away, passed, cancelled, v, info: v && A.fleet.info(v.label) };
  }

  // ---------- drawing the results ----------
  function legChips(it) {
    return it.legs.map((l) => l.mode === 'walk'
      ? `<span class="lc walk">🚶<small>${Math.max(1, Math.round((l.end - l.start) / 60))}</small></span>`
      : `<span class="lc ride" style="--c:${A.legColor(l)}">${MODE_ICON[l.mode]}<b>${esc(l.route.short)}</b></span>`).join('<i class="lc-sep">›</i>');
  }
  function liveChip(it) {
    const first = rides(it)[0];
    const x = first && liveFor(first);
    if (!x) return '<span class="sched">Scheduled</span>';
    if (x.cancelled) return `<span class="late">● ${esc(first.route.short)} cancelled</span>`;
    if (x.passed) return `<span class="late">● ${esc(first.route.short)} has already gone</span>`;
    const p = A.punctuality(x.delay);
    return `<span class="${p.cls}">● ${esc(first.route.short)} ${p.text.toLowerCase()}${x.away != null && x.away >= 0 ? ` · ${x.away === 0 ? 'at your stop' : x.away + ' stop' + (x.away === 1 ? '' : 's') + ' away'}` : ''}</span>`;
  }
  function leaveIn(it) {
    const first = it.legs[0];
    const x = rides(it)[0] && liveFor(rides(it)[0]);
    const leave = first.start + ((x && x.delay > 0 && first.mode === 'walk') ? x.delay : 0);
    const s = leave - T.now();
    return s < -60 ? '' : s < 60 ? '<b class="ok">Leave now</b>' : `Leave in <b data-exp="${leave}">${A.countdown(s)}</b>`;
  }

  function render(quiet) {
    const box = A.$('#p-results', root);
    if (!box) return;
    if (!results) {
      box.innerHTML = `<div class="plan-empty"><div class="pe-art">🗺️</div><b>Where to?</b>
        <p class="help">Plan any trip across Auckland on buses, trains and ferries, with live times. Search a place, an address or a stop number, or right-click the map.</p>
        ${quickTargets()}</div>`;
      A.$$('.qt', box).forEach((b) => { b.onclick = () => { const q = JSON.parse(b.dataset.p); setPlace('to', q); }; });
      return;
    }
    if (results.loading) { box.innerHTML = `<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`; return; }
    if (results.error) { box.innerHTML = `<div class="empty err">${esc(results.error)}</div>`; return; }
    const list = results.itineraries || [];
    if (sel >= 0 && list[sel]) { renderDetail(box, list[sel], quiet); return; }
    let h = '';
    const late = T.parts(Date.now()).h >= 22 || T.parts(Date.now()).h < 4;
    if (!list.length) {
      h += `<div class="empty">${esc(results.note || (late && when.mode === 'now' ? 'Services have finished for tonight.' : 'No way there found for that time. Try a later time, or allow more walking.'))}` +
        `${late ? '<div class="quick"><button class="qt" data-tm="06:30">Tomorrow 6:30 am</button><button class="qt" data-tm="08:00">Tomorrow 8:00 am</button></div>' : ''}</div>`;
    }
    if (results.walkOnly && results.direct < 1500) {
      h += `<div class="itin walk-only"><div class="it-top"><b>🚶 Walk it</b><span class="dur">${dur(results.walkOnly)}</span></div><div class="it-meta">${dist(results.direct)} as the crow flies</div></div>`;
    }
    h += list.map((it, i) => {
      const alerts = alertsFor(it);
      return `<button class="itin${i === hover ? ' hov' : ''}" data-i="${i}">
        <div class="it-top"><b>${T.clock(it.start)} – ${T.clock(it.end)}</b><span class="dur">${dur(it.end - it.start)}</span></div>
        <div class="it-legs">${legChips(it)}</div>
        <div class="it-meta">${leaveIn(it)}<span>${it.transfers ? it.transfers + ' change' + (it.transfers > 1 ? 's' : '') : 'Direct'}</span><span>${dist(it.walk)} walk</span></div>
        <div class="it-live">${liveChip(it)}${alerts.length ? `<span class="warn">⚠ ${alerts.length} alert${alerts.length > 1 ? 's' : ''}</span>` : ''}</div>
        ${(it.tags || []).length ? `<div class="it-tags">${it.tags.map((t) => `<span>${t}</span>`).join('')}</div>` : ''}
      </button>`;
    }).join('');
    box.innerHTML = h;
    A.$$('[data-tm]', box).forEach((b) => { b.onclick = () => tomorrowAt(b.dataset.tm); });
    A.$$('.itin[data-i]', box).forEach((b) => {
      b.onclick = () => { sel = +b.dataset.i; render(); drawJourney(true); loadWalks(list[sel]); box.scrollTop = 0; };
      b.onmouseenter = () => { if (hover !== +b.dataset.i) { hover = +b.dataset.i; drawJourney(true); A.$$('.itin', box).forEach((x) => x.classList.toggle('hov', x === b)); } };
    });
    A.tick();
  }

  function quickTargets() {
    const list = [
      { name: 'Britomart', sub: 'Waitematā Station, city centre', lat: -36.8445, lon: 174.7689 },
      { name: 'Sky Tower', sub: 'Victoria Street, city centre', lat: -36.8484, lon: 174.7622 },
      { name: 'Auckland Airport', sub: 'International terminal', lat: -37.0048, lon: 174.7788 },
      { name: 'Newmarket', sub: 'Broadway', lat: -36.8697, lon: 174.7778 },
      { name: 'Sylvia Park', sub: 'Shopping centre', lat: -36.9163, lon: 174.8411 },
      { name: 'Takapuna Beach', sub: 'North Shore', lat: -36.7873, lon: 174.7727 },
    ].map((p) => Object.assign(p, { type: 'place' }));
    const w = A.places.work();
    if (w) list.unshift(Object.assign({}, w, { type: 'work' }));
    return `<div class="quick">${list.map((p) => `<button class="qt" data-p='${esc(JSON.stringify(p))}'><span>${placeIcon(p)}</span>${esc(p.name)}</button>`).join('')}</div>`;
  }

  function alertsFor(it) {
    const routes = rides(it).map((l) => l.route.short);
    const stops = rides(it).flatMap((l) => [l.from.id, l.to.id]);
    return A.alerts.matching(routes, stops).filter((a) => a.active || (a.next && a.next.start < it.end));
  }

  function renderDetail(box, it, quiet) {
    const openMids = quiet ? A.$$('details.mids[open]', box).map((d) => d.dataset.k) : [];
    const openWalks = quiet ? A.$$('details.turns[open]', box).map((d) => d.dataset.k) : [];
    const scroll = box.scrollTop;
    let h = `<button class="back-link" id="p-back">${A.icon('back', 16)} All options</button>
      <div class="it-sum"><b>${T.clock(it.start)} – ${T.clock(it.end)}</b><span>${dur(it.end - it.start)} · ${it.transfers ? it.transfers + ' change' + (it.transfers > 1 ? 's' : '') : 'direct'} · ${dist(it.walk)} walk</span>
        <div class="it-legs">${legChips(it)}</div><div class="it-meta">${leaveIn(it)}</div></div>`;
    const alerts = alertsFor(it);
    if (alerts.length) {
      h += `<div class="alert-box">${alerts.slice(0, 3).map((a) => `<div><span class="chip ${a.cls}">${esc(a.label)}</span> <b>${esc(a.header)}</b><small>${esc(A.alerts.when(a))}</small></div>`).join('')}</div>`;
    }
    h += '<ol class="steps">';
    it.legs.forEach((l, i) => {
      if (i === 0) h += step('place start', l.start, from.name, from.sub || '', '🟢');
      if (l.mode === 'walk') {
        const w = walks[i];
        const d = w && w.dist ? w.dist : l.dist;
        h += `<li class="step walk"><div class="st-body"><b>Walk ${dist(d)}</b> <span class="muted">· ${dur(l.end - l.start)}</span>
          <small>to ${esc(l.to.name)}${l.to.code ? ' · stop ' + esc(l.to.code) : ''}</small>
          ${w && w.steps && w.steps.length > 1 ? `<details class="turns" data-k="${i}" ${openWalks.includes(String(i)) ? 'open' : ''}><summary>Turn by turn</summary><ol>${w.steps.map((s) => `<li>${esc(s.text)}${s.dist > 5 ? ` <small>${dist(s.dist)}</small>` : ''}</li>`).join('')}</ol></details>` : ''}
          </div></li>`;
      } else {
        const x = liveFor(l);
        const c = A.legColor(l);
        const delay = x && x.delay != null && !x.cancelled ? x.delay : null;
        h += step('stop board', l.start, l.from.name, `${l.from.code ? 'Stop ' + l.from.code : ''}${l.from.platform ? ' · Platform ' + l.from.platform : ''} · get on`, '', delay, c);
        const mids = l.stops.slice(1, -1);
        const liveBits = [];
        if (x) {
          if (x.cancelled) liveBits.push(A.chip('Cancelled', 'late'));
          else if (x.passed) liveBits.push(A.chip('Already left your stop', 'late'));
          else {
            const p = A.punctuality(x.delay);
            liveBits.push(A.chip(p.text, p.cls));
            if (x.v) liveBits.push(A.chip('● Live GPS', 'ok'));
            if (x.away != null && x.away >= 0) liveBits.push(A.chip(x.away === 0 ? 'At your stop' : `${x.away} stop${x.away === 1 ? '' : 's'} away`, 'blue'));
          }
          if (x.v && x.v.occupancy != null && A.occupancy(x.v.occupancy)) liveBits.push(A.chip(A.occupancy(x.v.occupancy), 'sched'));
        } else liveBits.push(A.chip('Scheduled', 'sched'));
        h += `<li class="step ride" style="--c:${c}"><div class="st-body">
          <div class="ride-head">${A.routeBadge(l.route.short, c, true)}<div><b>${MODE_ICON[l.mode]} to ${esc(A.cleanHeadsign(l.headsign))}</b><small>${esc(l.route.long && l.route.long !== l.route.short ? l.route.long : '')}</small></div></div>
          <div class="chips">${liveBits.join('')}</div>
          ${x && x.v && l.mode === 'bus' ? A.vehicleRow(x.v) : ''}
          ${x && x.v && l.mode === 'train' ? `<div class="facts">Train ${esc(x.v.label)}${x.v.speedKmh != null ? ' · ' + Math.round(x.v.speedKmh) + ' km/h' : ''}</div>` : ''}
          <details class="mids" data-k="${i}" ${openMids.includes(String(i)) ? 'open' : ''}><summary>${mids.length ? mids.length + ' stop' + (mids.length > 1 ? 's' : '') + ' · ' : ''}${dur(l.end - l.start)}</summary>
            <ol>${mids.map((s) => `<li><time>${T.clock(s.dep + (delay || 0))}</time>${esc(s.name)}</li>`).join('')}</ol></details>
        </div></li>`;
        h += step('stop alight', l.end, l.to.name, `${l.to.code ? 'Stop ' + l.to.code : ''}${l.to.platform ? ' · Platform ' + l.to.platform : ''} · get off`, '', delay, c);
      }
      if (i === it.legs.length - 1) h += step('place end', l.end, to.name, to.sub || '', '🏁');
    });
    h += '</ol>';
    const first = rides(it)[0];
    h += `<div class="it-actions">
      <button class="btn primary" id="p-remind">${A.icon('bell', 16)} ${reminders.has(key(it)) ? 'Reminder set' : 'Remind me to leave'}</button>
      ${first && live[first.tripId] && live[first.tripId].v ? `<button class="btn" id="p-track">${A.icon('follow', 16)} Track my ${first.mode}</button>` : ''}
      <button class="btn" id="p-copy">Copy directions</button></div>`;
    box.innerHTML = h;
    box.scrollTop = scroll;
    A.$('#p-back', box).onclick = () => { sel = -1; render(); drawJourney(true); };
    A.$('#p-remind', box).onclick = () => remind(it);
    A.$('#p-copy', box).onclick = () => copy(it);
    const tr = A.$('#p-track', box);
    if (tr) tr.onclick = () => { const v = live[first.tripId].v; map.flyTo(v.lon, v.lat, 15.5); map.select(first.tripId); };
    A.paintPortraits(box);
    A.tick();
  }

  function step(cls, t, name, sub, icon, delay, color) {
    const live = delay != null && Math.abs(delay) >= 60;
    return `<li class="step ${cls}"${color ? ` style="--c:${color}"` : ''}><time>${live ? `<b class="${delay > 0 ? 'late' : 'ok'}">${T.clock(t + delay)}</b><s>${T.clock(t)}</s>` : T.clock(t)}</time>` +
      `<i class="st-dot">${icon || ''}</i><div class="st-body"><b>${esc(name)}</b><small>${esc(sub)}</small></div></li>`;
  }

  function updateTimes() {
    // countdowns tick on their own (data-exp); refresh "leave in" once a minute
    if (T.now() % 60 === 0) render(true);
  }

  // ---------- map ----------
  function drawJourney(fit) {
    if (!map) return;
    const list = (results && results.itineraries) || [];
    const it = list[sel >= 0 ? sel : hover] || null;
    map.setJourney(it, it ? walksFor(it) : null, fit);
    // the vehicles for its rides, with how far off they are
    const marks = [];
    if (it) {
      for (const l of rides(it)) {
        const x = liveFor(l);
        if (!x || !x.v) continue;
        const p = A.punctuality(x.delay);
        marks.push({ id: l.tripId, lon: x.v.lon, lat: x.v.lat, bearing: x.v.bearing, color: A.legColor(l), kind: l.mode,
                     tag: `${esc(l.route.short)} · ${x.passed ? 'gone' : x.away != null && x.away > 0 ? x.away + ' stops away' : p.text.toLowerCase()}` });
      }
    }
    map.setMarkers(marks);
  }
  function walksFor(it) {
    const out = {};
    it.legs.forEach((l, i) => { if (l.mode === 'walk' && walks[i] && walks[i].coords) out[i] = walks[i].coords; });
    return out;
  }
  async function loadWalks(it) {
    await Promise.all(it.legs.map(async (l, i) => {
      if (l.mode !== 'walk' || l.dist < 30) return;
      walks[i] = await A.places.walk(l.from, l.to);
    }));
    const list = (results && results.itineraries) || [];
    if (list[sel] === it) { render(true); drawJourney(false); }
  }

  // ---------- reminders and sharing ----------
  const key = (it) => rides(it).map((l) => l.tripId).join('|');
  function remind(it) {
    const k = key(it);
    if (reminders.has(k)) { clearTimeout(reminders.get(k)); reminders.delete(k); A.toast('Reminder cancelled'); render(true); return; }
    const first = rides(it)[0];
    const x = liveFor(first);
    const leave = it.legs[0].start + (x && x.delay > 0 ? x.delay : 0) - 60;
    const wait = (leave - T.now()) * 1000;
    if (wait < 0) { A.toast('It\'s time to go now!'); return; }
    reminders.set(k, setTimeout(() => {
      reminders.delete(k);
      const title = `Time to leave for the ${first.route.short}`;
      const body = `It leaves ${first.from.name} at ${T.clock(first.start + (x && x.delay ? x.delay : 0))} to ${A.cleanHeadsign(first.headsign)}.`;
      if (A.desktop) A.desktop.notify(title, body); else if (window.Notification && Notification.permission === 'granted') new Notification(title, { body });
    }, wait));
    A.toast(`I'll remind you at ${T.clock(leave)}`);
    render(true);
  }
  function copy(it) {
    const lines = [`${from.name} → ${to.name}: ${T.clock(it.start)} – ${T.clock(it.end)} (${dur(it.end - it.start)})`];
    for (const l of it.legs) {
      if (l.mode === 'walk') lines.push(`• Walk ${dist(l.dist)} to ${l.to.name}`);
      else lines.push(`• ${T.clock(l.start)} ${l.mode} ${l.route.short} to ${A.cleanHeadsign(l.headsign)} from ${l.from.name}${l.from.code ? ' (stop ' + l.from.code + ')' : ''}, get off at ${l.to.name} ${T.clock(l.end)}`);
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => A.toast('Directions copied'), () => A.toast('Couldn\'t copy'));
  }

  (A.views = A.views || {}).plan = V;
})(window.AKL);
