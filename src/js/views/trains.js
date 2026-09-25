// Trains: the live network diagram (or every train on a real map), with the
// network at a glance, a train's run, or a station's departures beside it.
(function (A) {
  'use strict';
  const esc = A.esc, T = A.time, NET = A.NET;
  const V = {};
  let root, tm, real, mode = 'diagram', selTrain = null, selStation = null, stationDeps = null, trip = null;
  let stationTimer = null;

  V.mount = function (el) {
    root = el;
    root.innerHTML = `
      <div class="page page-full">
        <header class="page-head">
          <div><h1>Ngā Tereina</h1><div class="sub">Auckland trains, live, on the post-CRL network</div></div>
          <div class="head-right"><div class="line-filters" id="t-filters"></div><span id="t-live"></span></div>
        </header>
        <div class="split">
          <div class="card map-host">
            <canvas id="t-canvas" class="train-canvas"></canvas>
            <div id="t-real" class="real-map" hidden></div>
            <div class="map-tools">
              <div class="seg" id="t-mode"><button data-m="diagram">Diagram</button><button data-m="satellite">Satellite</button><button data-m="streets">Map</button></div>
            </div>
            <div class="zoom-tools" id="t-zoom">
              <button class="icon-btn" data-z="in" title="Zoom in">${A.icon('zoomIn')}</button>
              <button class="icon-btn" data-z="out" title="Zoom out">${A.icon('zoomOut')}</button>
              <button class="icon-btn" data-z="fit" title="Whole network">${A.icon('fit')}</button>
            </div>
            <div class="tip" id="t-tip" hidden></div>
          </div>
          <aside class="card side" id="t-side"></aside>
        </div>
      </div>`;
    tm = new A.TrainMap(A.$('#t-canvas', root), {
      onTrain: (id) => pickTrain(id),
      onStation: (i) => pickStation(i),
      onNothing: () => clear(),
      onHover: (hit, x, y) => showTip(hit, x, y),
    });
    tm.setFilter(A.settings.get('trainLines'));
    A.$$('#t-mode button', root).forEach((b) => { b.onclick = () => setMode(b.dataset.m); b.classList.toggle('on', b.dataset.m === 'diagram'); });
    A.$('#t-zoom', root).onclick = (e) => {
      const b = e.target.closest('[data-z]');
      if (!b) return;
      if (mode !== 'diagram') { if (b.dataset.z === 'fit') real.fit(NET.stations.map((s) => [s.lon, s.lat]), 40); else real.map[b.dataset.z === 'in' ? 'zoomIn' : 'zoomOut'](); return; }
      if (b.dataset.z === 'fit') tm.reset(); else tm.zoomBy(b.dataset.z === 'in' ? 1.6 : 1 / 1.6);
    };
    A.on('trains', render);
    A.on('tick', (now) => { A.$('#t-live', root).innerHTML = A.liveBadge(A.state.trains.updated, now); });
    render();
  };

  V.show = function () {
    A.need('trains', true);
    if (mode === 'diagram') tm.start(); else setTimeout(() => real && real.resize(), 30);
  };
  V.hide = function () { A.need('trains', false); tm.stop(); };
  V.key = function (e) {
    if (e.key === 'Escape') clear();
    if (mode === 'diagram' && (e.key === '+' || e.key === '=')) tm.zoomBy(1.6);
    if (mode === 'diagram' && e.key === '-') tm.zoomBy(1 / 1.6);
  };

  function filter() { return new Set(A.settings.get('trainLines')); }

  function setMode(m) {
    mode = m;
    A.$$('#t-mode button', root).forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    const canvas = A.$('#t-canvas', root), host = A.$('#t-real', root);
    if (m === 'diagram') { host.hidden = true; canvas.hidden = false; tm.start(); return; }
    tm.stop(); canvas.hidden = true; host.hidden = false;
    if (!real) {
      real = new A.MapView(host, {
        basemap: m,
        onPick: (p) => { if (p.kind === 'vehicle') pickTrain(p.id); else if (p.kind === 'stop') pickStation(+p.id); },
        onBackground: () => clear(),
        onHover: (f, pt) => showTip(f && f.layer !== 'akl-stops' ? { kind: 'train', id: f.props.id, x: pt.x, y: pt.y }
                                     : f && f.props.id ? { kind: 'station', id: +f.props.id, x: pt.x, y: pt.y } : null),
      });
      real.fit(NET.stations.map((s) => [s.lon, s.lat]), 40);
    } else real.setBasemap(m);
    setTimeout(() => real.resize(), 30);
    renderReal();
  }

  function renderReal() {
    if (!real) return;
    const f = filter();
    real.setLines([0, 2, 1].filter((li) => f.has(li)).map((li) => ({
      coords: NET.segs.filter((s) => s.line === li).map((s) => [[s.lon0, s.lat0], [s.lon1, s.lat1]]),
      color: NET.lineColors[li], width: 3.5, offset: (li - 1) * 3,
    })));
    real.setStops(NET.stations.map((s, i) => {
      const li = [0, 1, 2].find((k) => s.lines & (1 << k)) || 0;
      const inter = s.pts.length > 2 || s.crl;
      return { lon: s.lon, lat: s.lat, color: inter ? A.pal.navy : NET.lineColors[li], id: String(i), label: s.priority === 0 ? s.name : undefined };
    }));
    // every train at its real GPS position (the feed's, not the diagram's)
    real.setCrowd(A.state.trains.list.filter((t) => f.has(t.line)).map((t) => ({
      id: t.v.id, lon: t.v.lon, lat: t.v.lat, bearing: t.v.bearing, color: NET.lineColors[t.line], kind: 'train',
      label: NET.lineIds[t.line],
    })));
    real.select(selTrain);
  }

  function render() {
    const st = A.state.trains;
    tm.setData(st);
    const f = filter();
    tm.setFilter(f);
    const counts = [0, 0, 0];
    st.list.forEach((t) => counts[t.line]++);
    A.$('#t-filters', root).innerHTML = NET.lineIds.map((id, li) =>
      `<button class="line-chip${f.has(li) ? ' on' : ''}" data-li="${li}" style="--c:${NET.lineColors[li]}"><i></i>${id}<b>${counts[li]}</b></button>`).join('');
    A.$$('#t-filters button', root).forEach((b) => {
      b.onclick = () => {
        const li = +b.dataset.li;
        const cur = new Set(A.settings.get('trainLines'));
        if (cur.has(li) && cur.size > 1) cur.delete(li); else cur.add(li);
        A.settings.set('trainLines', Array.from(cur).sort());
        render();
      };
    });
    if (mode !== 'diagram') renderReal();
    renderSide();
  }

  // ---------- selection ----------
  function pickTrain(id) {
    selTrain = id; selStation = null; stationDeps = null; trip = null;
    clearInterval(stationTimer);
    tm.select(id, null);
    if (real) real.select(id);
    const t = A.state.trains.list.find((x) => x.v.id === id);
    if (t && t.v.tripId) {
      A.trains.trip(t.v.tripId, t.v.startDate).then((d) => { if (selTrain === id) { trip = d; renderSide(); } }).catch(() => {});
    }
    renderSide();
  }
  function pickStation(i) {
    selStation = i; selTrain = null; trip = null; stationDeps = null;
    tm.select(null, i);
    if (real) real.select(null);
    const load = () => A.trains.departures(i).then((d) => { if (selStation === i) { stationDeps = d; renderSide(); } })
      .catch((e) => { if (selStation === i) { stationDeps = { error: e.message }; renderSide(); } });
    load();
    clearInterval(stationTimer);
    stationTimer = setInterval(load, 30000);
    renderSide();
  }
  function clear() {
    selTrain = null; selStation = null; trip = null; stationDeps = null;
    clearInterval(stationTimer);
    tm.select(null, null);
    if (real) real.select(null);
    renderSide();
  }

  function showTip(hit, x, y) {
    const tip = A.$('#t-tip', root);
    if (!hit) { tip.hidden = true; return; }
    let html = '';
    if (hit.kind === 'station') {
      const s = NET.stations[hit.id];
      html = `<b>${esc(s.name)}</b>` + [0, 1, 2].filter((k) => s.lines & (1 << k)).map((k) => A.linePill(k)).join('');
    } else {
      const t = A.state.trains.list.find((q) => q.v.id === hit.id);
      if (!t) { tip.hidden = true; return; }
      const p = A.punctuality(t.delay);
      html = `${A.linePill(t.line)}<b>${esc(t.v.label || 'Train')}</b><span class="${p.cls}">${p.text}</span>` +
             (t.v.speedKmh != null ? `<span>${t.v.speedKmh < 2 ? 'Stopped' : Math.round(t.v.speedKmh) + ' km/h'}</span>` : '');
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const x0 = hit.x != null ? hit.x : x, y0 = hit.y != null ? hit.y : y;
    tip.style.left = Math.round(x0 + 16) + 'px';
    tip.style.top = Math.round(y0 - 12) + 'px';
  }

  // ---------- the side panel ----------
  function renderSide() {
    const side = A.$('#t-side', root);
    const st = A.state.trains;
    const now = T.now();
    if (selTrain) {
      const t = st.list.find((x) => x.v.id === selTrain);
      if (!t) { side.innerHTML = `<div class="empty">That train has left the network.</div>`; return; }
      const p = A.punctuality(t.delay);
      const occ = A.occupancy(t.v.occupancy);
      let h = `<button class="close-btn" title="Close">${A.icon('close')}</button>
        <div class="side-head">${A.linePill(t.line, true)}<div><h2>${trip ? 'to ' + esc(trip.headsign) : NET.lineNames[t.line]}</h2>
        <div class="sub">${esc(NET.lineNames[t.line])} line${t.v.label ? ' · ' + esc(t.v.label) : ''}</div></div></div>
        <div class="chips">${A.chip(p.text, p.cls)}${A.chip(t.v.speedKmh == null ? 'Speed unknown' : t.v.speedKmh < 2 ? 'Stopped' : Math.round(t.v.speedKmh) + ' km/h', 'blue')}${occ ? A.chip(occ, 'sched') : ''}</div>`;
      if (!trip) h += `<div class="empty">Loading its stops…</div>`;
      else {
        const ahead = trip.stops.filter((s) => t.stopSeq == null || s.seq >= t.stopSeq);
        h += `<div class="list-head">Next stops</div><div class="stops-list">` + ahead.slice(0, 14).map((s, k) => {
          const exp = s.scheduled + (t.delay || 0);
          return `<div class="stop-row${k === 0 ? ' first' : ''}"><i style="--c:${NET.lineColors[t.line]}"></i>` +
                 `<span class="${s.station != null ? 'link' : ''}" ${s.station != null ? `data-station="${s.station}"` : ''}>${esc(s.name)}</span>` +
                 `<b>${T.clock(exp)}</b><em data-exp="${exp}">${A.countdown(exp - now)}</em></div>`;
        }).join('') + `</div>`;
      }
      side.innerHTML = h;
    } else if (selStation != null) {
      const s = NET.stations[selStation];
      let h = `<button class="close-btn" title="Close">${A.icon('close')}</button>
        <div class="side-head"><div class="roundel">🚆</div><div><h2>${esc(s.name)}</h2>
        <div class="sub">${[0, 1, 2].filter((k) => s.lines & (1 << k)).map((k) => A.linePill(k)).join(' ')} · ${Object.keys(s.platforms).length} platforms</div></div></div>`;
      if (!stationDeps) h += `<div class="empty">Loading departures…</div>`;
      else if (stationDeps.error) h += `<div class="empty err">${esc(stationDeps.error)}</div>`;
      else if (!stationDeps.length) h += `<div class="empty">No trains in the next two hours.</div>`;
      else {
        h += `<div class="list-head">Departures</div><div class="deps">` + stationDeps.map((d) => {
          const p = A.punctuality(d.delay);
          return `<div class="dep-row">${A.linePill(d.line)}<div class="dep-main"><b>${esc(d.headsign)}</b>` +
                 `<small>Platform ${esc(d.platform)} · <span class="${p.cls}">${p.text}</span></small></div>` +
                 `<div class="dep-time"><em data-exp="${d.expected}">${A.countdown(d.expected - now)}</em><small>${T.clock(d.expected)}</small></div></div>`;
        }).join('') + `</div>`;
      }
      side.innerHTML = h;
    } else {
      const counts = [0, 0, 0], late = [0, 0, 0], sum = [0, 0, 0], n = [0, 0, 0];
      for (const t of st.list) {
        counts[t.line]++;
        if (t.delay != null) { sum[t.line] += t.delay; n[t.line]++; if (t.delay >= 120) late[t.line]++; }
      }
      const total = st.list.length;
      side.innerHTML = `<h2 class="big-num">${total}<small>trains running</small></h2>` +
        (st.error ? `<div class="empty err">${esc(st.error)}</div>` : '') +
        NET.lineIds.map((id, li) => {
          const avg = n[li] ? Math.round(sum[li] / n[li] / 60) : null;
          return `<div class="line-row">${A.linePill(li, true)}<div><b>${esc(NET.lineNames[li])}</b>` +
                 `<small>${late[li]} running late · ${avg == null ? 'no timing yet' : avg <= 0 ? 'average on time' : `average ${avg} min late`}</small></div>` +
                 `<span class="count">${counts[li]}</span></div>`;
        }).join('') +
        `<p class="help">Click a train for where it's going, its speed and its next stops. Click a station for live departures from every platform. Scroll to zoom, drag to pan, double-click to zoom in. Switch to Satellite to see every train where it really is.</p>`;
    }
    A.$$('[data-station]', side).forEach((e) => { e.onclick = () => pickStation(+e.dataset.station); });
    const cb = A.$('.close-btn', side);
    if (cb) cb.onclick = clear;
    A.tick();
  }

  (A.views = A.views || {}).trains = V;
})(window.AKL);
