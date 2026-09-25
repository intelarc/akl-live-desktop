// Live: every bus in Auckland on one map (and the trains and ferries, if you
// like), searchable, filterable, with a card for whatever you click.
(function (A) {
  'use strict';
  const esc = A.esc, T = A.time, NET = A.NET;
  const V = {};
  let root, map, filter = 'all', query = '', selected = null, trip = null, fitTimer = null;

  V.mount = function (el) {
    root = el;
    root.innerHTML = `
      <div class="page-map">
        <div id="l-map" class="full-map"></div>
        <aside class="float-panel">
          <div class="fp-head"><h1>Every bus</h1><div class="sub" id="l-count">Finding every bus in Auckland…</div></div>
          <label class="search">${A.icon('search', 18)}<input id="l-q" placeholder="Route, fleet number or model" spellcheck="false" autocomplete="off">
            <button class="icon-btn small" id="l-clear" title="Clear" hidden>${A.icon('close', 16)}</button></label>
          <div class="filters" id="l-filters"></div>
          <div class="op-list" id="l-ops"></div>
          <div class="results" id="l-results"></div>
        </aside>
        <div class="map-tools right">
          <div class="seg" id="l-basemap"><button data-b="satellite">Satellite</button><button data-b="streets">Map</button></div>
        </div>
        <div class="vehicle-card card" id="l-card" hidden></div>
        <div class="tip" id="l-tip" hidden></div>
      </div>`;
    const q = A.$('#l-q', root);
    q.addEventListener('input', () => { query = q.value; A.$('#l-clear', root).hidden = !query; render(); scheduleFit(); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { q.value = ''; query = ''; A.$('#l-clear', root).hidden = true; render(); scheduleFit(); q.blur(); }
      if (e.key === 'Enter') { const first = shown()[0]; if (first) pick(first.v.id, true); }
    });
    A.$('#l-clear', root).onclick = () => { q.value = ''; query = ''; A.$('#l-clear', root).hidden = true; render(); scheduleFit(); };
    A.$$('#l-basemap button', root).forEach((b) => { b.onclick = () => A.settings.set('basemap', b.dataset.b); });
    A.on('live', () => { render(); if (selected) renderCard(); });
    A.on('settings', (k) => { if (k === 'basemap' || k === '*') syncBasemap(); if (k === 'liveTrains') render(); });
    A.on('tick', () => { if (selected) updateCardTimes(); });
  };

  V.show = function () {
    A.need('live', true);
    if (!map) {
      map = new A.MapView(A.$('#l-map', root), {
        onPick: (p) => { if (p.kind === 'vehicle') pick(p.id); },
        onBackground: () => pick(null),
        onHover: hover,
        onUnfollow: () => renderCard(),
      });
      map.fit([A.AKL_BOUNDS[0], A.AKL_BOUNDS[1]], { top: 40, bottom: 40, left: 400, right: 40 });
      render();
    }
    syncBasemap();
    setTimeout(() => map.resize(), 30);
  };
  V.hide = function () { A.need('live', false); };
  V.key = function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); A.$('#l-q', root).focus(); A.$('#l-q', root).select(); }
    else if (e.key === 'Escape' && document.activeElement !== A.$('#l-q', root)) pick(null);
  };
  /** Show one vehicle (from elsewhere in the app). */
  V.focus = function (id) { pick(id, true); };

  function syncBasemap() {
    const b = A.settings.get('basemap');
    A.$$('#l-basemap button', root).forEach((x) => x.classList.toggle('on', x.dataset.b === b));
    if (map) map.setBasemap(b);
  }

  // ---------- what's shown ----------
  function passes(b) {
    if (filter === 'electric') return !!(b.info.model && b.info.model.electric);
    if (filter === 'double') return !!(b.info.model && b.info.model.doubleDeck);
    if (filter === 'unknown') return !b.info.model;
    if (filter.startsWith('op:')) return b.info.code === filter.slice(3);
    return true;
  }
  function matches(b, q) {
    if (!q) return true;
    const s = q.trim().replace(/\s+/g, '').toLowerCase();
    return (b.route && b.route.toLowerCase().startsWith(s)) || b.info.fleetNo.toLowerCase().includes(s) ||
           (b.info.model && b.info.model.name.replace(/\s+/g, '').toLowerCase().includes(s));
  }
  const shown = () => A.state.live.buses.filter((b) => passes(b) && matches(b, query));
  const withTrains = () => A.settings.get('liveTrains') && filter === 'all';

  function render() {
    const L = A.state.live;
    const list = shown();
    const buses = L.buses;
    const elec = buses.filter((b) => b.info.model && b.info.model.electric).length;
    A.$('#l-count', root).innerHTML = L.loading ? 'Finding every bus in Auckland…'
      : L.error && !buses.length ? `<span class="err">${esc(L.error)}</span>`
      : `<b>${buses.length.toLocaleString()}</b> buses on the road · ${Math.round(elec * 100 / Math.max(1, buses.length))}% electric` +
        ` · <span data-since="${L.updated}"></span>`;

    // filter chips
    const chip = (key, label, n) => `<button class="fchip${filter === key ? ' on' : ''}" data-f="${key}">${label}<b>${n}</b></button>`;
    A.$('#l-filters', root).innerHTML =
      chip('all', 'All', buses.length) +
      chip('electric', '⚡ Electric', elec) +
      chip('double', 'Double-deckers', buses.filter((b) => b.info.model && b.info.model.doubleDeck).length) +
      `<button class="fchip toggle${A.settings.get('liveTrains') ? ' on' : ''}" data-t="1">🚆 Trains &amp; ferries<b>${L.trains.length + L.ferries.length}</b></button>`;
    A.$$('#l-filters [data-f]', root).forEach((b) => { b.onclick = () => { filter = b.dataset.f; render(); scheduleFit(); }; });
    A.$('#l-filters [data-t]', root).onclick = () => A.settings.set('liveTrains', !A.settings.get('liveTrains'));

    // operators, with a bar for their share
    const byOp = {};
    buses.forEach((b) => { byOp[b.info.code] = (byOp[b.info.code] || 0) + 1; });
    const max = Math.max(1, ...Object.values(byOp));
    A.$('#l-ops', root).innerHTML = Object.keys(A.fleet.OPERATORS).filter((c) => byOp[c]).sort((a, b) => byOp[b] - byOp[a]).map((c) =>
      `<button class="op-row${filter === 'op:' + c ? ' on' : ''}" data-op="${c}"><i style="background:${A.fleet.color(c)}"></i>` +
      `<span>${esc(A.fleet.OPERATORS[c])}</span><b>${byOp[c]}</b><em><s style="width:${Math.round(byOp[c] * 100 / max)}%;background:${A.fleet.color(c)}"></s></em></button>`).join('');
    A.$$('#l-ops [data-op]', root).forEach((b) => {
      b.onclick = () => { filter = filter === 'op:' + b.dataset.op ? 'all' : 'op:' + b.dataset.op; render(); scheduleFit(); };
    });

    // search results
    const res = A.$('#l-results', root);
    if (query.trim() || filter !== 'all') {
      const sorted = list.slice().sort((a, b) => (a.route || 'zzz').localeCompare(b.route || 'zzz', undefined, { numeric: true }) || a.info.fleetNo.localeCompare(b.info.fleetNo));
      res.innerHTML = `<div class="list-head">${list.length} shown</div>` + sorted.slice(0, 80).map((b) =>
        `<button class="res-row${b.v.id === selected ? ' on' : ''}" data-id="${esc(b.v.id)}">${A.routeBadge(b.route || '—', A.fleet.color(b.info.code))}` +
        `<span class="rr-text"><b>${esc(b.info.fleetNo)}</b><small>${esc(b.info.model ? b.info.model.short : b.info.operator)}</small></span>` +
        `<em>${b.v.speedKmh == null ? '' : b.v.speedKmh < 2 ? 'Stopped' : Math.round(b.v.speedKmh) + ' km/h'}</em></button>`).join('') +
        (list.length > 80 ? `<div class="empty">…and ${list.length - 80} more. Narrow the search.</div>` : '');
      A.$$('.res-row', res).forEach((b) => { b.onclick = () => pick(b.dataset.id, true); });
    } else {
      res.innerHTML = `<p class="help">Every dot is a bus, coloured by operator; zoom in for routes and headings. ` +
        `Search a route (<kbd>27</kbd> finds the 27H, 27W and 27T), a fleet number (<kbd>NB5075</kbd>) or a model (<kbd>eT12</kbd>). ` +
        `<kbd>Ctrl</kbd>+<kbd>F</kbd> jumps here.</p>`;
    }

    if (!map) return;
    const crowd = list.map((b) => ({ id: b.v.id, lon: b.v.lon, lat: b.v.lat, bearing: b.v.bearing, color: A.fleet.color(b.info.code),
                                      op: b.info.code, kind: 'bus', label: b.route }));
    if (withTrains()) {
      L.trains.filter((t) => t.line >= 0).forEach((t) => crowd.push({ id: t.v.id, lon: t.v.lon, lat: t.v.lat, bearing: t.v.bearing,
        color: NET.lineColors[t.line], kind: 'train', label: NET.lineIds[t.line] }));
      L.ferries.forEach((f) => crowd.push({ id: f.v.id, lon: f.v.lon, lat: f.v.lat, bearing: f.v.bearing, color: '#FFFFFF', kind: 'ferry', label: f.name }));
    }
    map.setCrowd(crowd);
  }

  /** A new search or filter frames what it found (once, not on every refresh). */
  function scheduleFit() {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      if (!map) return;
      const list = shown();
      const pad = { top: 60, bottom: 60, left: 400, right: 60 };
      if ((!query.trim() && filter === 'all') || !list.length) map.fit([A.AKL_BOUNDS[0], A.AKL_BOUNDS[1]], pad);
      else if (list.length === 1) map.flyTo(list[0].v.lon, list[0].v.lat, 15);
      else map.fit(list.map((b) => [b.v.lon, b.v.lat]), pad, 15);
    }, 450);
  }

  // ---------- the selected vehicle ----------
  function find(id) {
    const L = A.state.live;
    const b = L.buses.find((x) => x.v.id === id);
    if (b) return { kind: 'bus', b, v: b.v };
    const t = L.trains.find((x) => x.v.id === id);
    if (t) return { kind: 'train', t, v: t.v };
    const f = L.ferries.find((x) => x.v.id === id);
    return f ? { kind: 'ferry', f, v: f.v } : null;
  }

  function pick(id, fly) {
    selected = id;
    trip = null;
    if (map) { map.select(id); map.follow = false; }
    const x = id && find(id);
    if (x && fly && map) map.flyTo(x.v.lon, x.v.lat, 15);
    if (x && x.v.tripId) {
      A.live.trip(x.v.tripId).then((d) => { if (selected === id) { trip = d; renderCard(); } }).catch(() => {});
    }
    A.$$('.res-row', root).forEach((r) => r.classList.toggle('on', r.dataset.id === id));
    renderCard();
  }

  function renderCard() {
    const card = A.$('#l-card', root);
    const x = selected && find(selected);
    if (!x) { card.hidden = true; return; }
    const v = x.v, now = T.now();
    const color = x.kind === 'bus' ? A.fleet.color(x.b.info.code) : x.kind === 'train' ? NET.lineColors[x.t.line] : '#0B6FB8';
    const route = x.kind === 'bus' ? x.b.route : x.kind === 'train' ? NET.lineIds[x.t.line] : x.f.route;
    const p = A.punctuality(trip ? trip.delay : null);
    const occ = A.occupancy(v.occupancy);
    card.innerHTML = `
      <div class="vc-head">${A.routeBadge(route || '—', color, true)}
        <div class="vc-title"><b>${!v.tripId ? 'Not in service' : trip && trip.headsign ? 'to ' + esc(trip.headsign) : '…'}</b>
        <small>${x.kind === 'bus' ? esc(x.b.info.operator) + ' · ' + esc(x.b.info.fleetNo) : x.kind === 'train' ? 'Train · ' + esc(v.label) : 'Ferry · ' + esc(x.f.name)}</small></div>
        <button class="icon-btn small" id="vc-close" title="Close (Esc)">${A.icon('close', 18)}</button></div>
      ${x.kind === 'bus' ? A.vehicleRow(v, { big: true }) : ''}
      <div class="chips">${v.tripId ? A.chip(trip && trip.delay != null ? p.text : 'Timing unknown', trip && trip.delay != null ? p.cls : 'sched') : ''}
        ${A.chip(v.speedKmh == null ? 'Speed unknown' : v.speedKmh < 2 ? 'Stopped' : Math.round(v.speedKmh) + ' km/h', 'blue')}
        ${occ ? A.chip(occ, 'sched') : ''}<span class="seen">seen <span data-since="${v.timestamp}">${A.ago(now - v.timestamp)}</span></span></div>
      <div class="vc-tools"><button class="btn${map && map.follow ? ' on' : ''}" id="vc-follow">${A.icon('follow', 16)} ${map && map.follow ? 'Following' : 'Follow'}</button>
        <button class="btn" id="vc-zoom">Zoom to it</button></div>`;
    card.hidden = false;
    A.paintPortraits(card);
    A.$('#vc-close', card).onclick = () => pick(null);
    A.$('#vc-zoom', card).onclick = () => { const at = map.posOf(selected) || [v.lon, v.lat]; map.flyTo(at[0], at[1], 16); };
    A.$('#vc-follow', card).onclick = () => {
      map.follow = !map.follow;
      if (map.follow) { const at = map.posOf(selected) || [v.lon, v.lat]; map.flyTo(at[0], at[1], 15.5); map._kick(); }
      renderCard();
    };
  }
  function updateCardTimes() { /* data-since ticks on its own */ }

  function hover(f, pt) {
    const tip = A.$('#l-tip', root);
    if (!f || f.layer === 'akl-stops') { tip.hidden = true; return; }
    const x = find(f.props.id);
    if (!x) { tip.hidden = true; return; }
    if (x.kind === 'bus') {
      const m = x.b.info.model;
      tip.innerHTML = `${A.routeBadge(x.b.route || '—', A.fleet.color(x.b.info.code))}<b>${esc(x.b.info.fleetNo)}</b><span>${esc(m ? m.short : x.b.info.operator)}</span>`;
    } else if (x.kind === 'train') tip.innerHTML = `${A.linePill(Math.max(0, x.t.line))}<b>${esc(x.v.label)}</b>`;
    else tip.innerHTML = `<b>⛴ ${esc(x.f.name)}</b><span>${esc(x.f.route)}</span>`;
    tip.hidden = false;
    tip.style.left = Math.round(pt.x + 14) + 'px';
    tip.style.top = Math.round(pt.y - 10) + 'px';
  }

  (A.views = A.views || {}).live = V;
})(window.AKL);
