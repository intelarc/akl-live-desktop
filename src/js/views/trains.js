// Trains: Auckland's whole rail network drawn along the real tracks in AT's
// line colours, with every train live where its GPS puts it (or over satellite
// photos or a street map), and the network at a glance, a train's run, or a
// station's departures beside it.
(function (A) {
  'use strict';
  const esc = A.esc, T = A.time, NET = A.NET;
  const V = {};
  const MODES = [['diagram', 'Diagram'], ['satellite', 'Satellite'], ['streets', 'Map']];
  const LINE_W = 4.2, HUIA_W = 3, GAP = 1.2;     // px at zoom 12; they grow as you zoom in
  const KX = Math.cos(36.9 * Math.PI / 180), M = 111320;

  // Te Huia, Hamilton to Auckland (Waikato Regional Council, not AT): from The
  // Strand it shares AT's tracks out along the eastern line to Pukekohe, then
  // runs on south. It's line 3 here, after E-W, S-C and O-W.
  const HUIA = 3;
  const HUIA_COLOR = () => (A.isDark() ? '#B9C2CF' : '#2B3140');   // AT's feed says black
  const HUIA_STOPS = [
    { name: 'The Strand', lat: -36.84853, lon: 174.77934, priority: 1 },
    { name: 'Huntly', lat: -37.55787, lon: 175.15971, priority: 1 },
    { name: 'Hamilton Rotokauri', lat: -37.74904, lon: 175.23015, priority: 2 },
    { name: 'Hamilton Frankton', lat: -37.79121, lon: 175.26538, priority: 0 },
  ];
  const HUIA_PATH = ['Ōrākei', 'Meadowbank', 'Glen Innes', 'Panmure', 'Sylvia Park', 'Ōtāhuhu', 'Middlemore', 'Papatoetoe', 'Puhinui',
                     'Homai', 'Manurewa', 'Te Māhia', 'Takaanini', 'Papakura', 'Drury', 'Paerātā', 'Pukekohe'];
  const STATIONS = NET.stations.concat(HUIA_STOPS.map((s) => Object.assign({ lines: 1 << HUIA, extra: true }, s)));
  const idx = (name) => STATIONS.findIndex((s) => s.name === name);
  const STRAND = idx('The Strand');

  let root, real, mode = 'diagram', selTrain = null, selStation = null, stationDeps = null, trip = null;
  let stationTimer = null, geo = null, geoBusy = false;
  const heading = new Map();              // train id -> { at, b } for trains that don't send a bearing

  V.mount = function (el) {
    root = el;
    mode = A.settings.get('trainView');
    if (!MODES.some(([m]) => m === mode)) mode = 'diagram';
    root.innerHTML = `
      <div class="page page-full">
        <header class="page-head">
          <div><h1>Ngā Tereina</h1><div class="sub">Auckland's trains, live, on the post-CRL network</div></div>
          <div class="head-right"><div class="line-filters" id="t-filters"></div><span id="t-live"></span></div>
        </header>
        <div class="split">
          <div class="card map-host">
            <div id="t-real" class="real-map"></div>
            <div class="map-tools">
              <div class="seg" id="t-mode">${MODES.map(([m, name]) => `<button data-m="${m}">${name}</button>`).join('')}</div>
            </div>
            <div class="zoom-tools" id="t-zoom">
              <button class="icon-btn" data-z="fit" title="Whole network">${A.icon('fit')}</button>
            </div>
            <div class="t-legend" id="t-legend">
              <span><i class="lg-train"></i>Train, pointing the way it's going</span>
              <span><i class="lg-dot" style="--c:#EFA20E"></i>2–4 min late</span>
              <span><i class="lg-dot" style="--c:#E0412F"></i>5+ min late</span>
              <span><i class="lg-ix"></i>Change here</span>
              <span><i class="lg-line" id="t-huia-key"></i>Te Huia to Hamilton</span>
            </div>
            <div class="tip" id="t-tip" hidden></div>
          </div>
          <aside class="card side" id="t-side"></aside>
        </div>
      </div>`;
    A.$$('#t-mode button', root).forEach((b) => { b.onclick = () => setMode(b.dataset.m); });
    A.$('#t-zoom', root).onclick = (e) => { if (e.target.closest('[data-z]') && real) fitNetwork(); };
    A.on('trains', render);
    A.on('tick', (now) => { A.$('#t-live', root).innerHTML = A.liveBadge(A.state.trains.updated, now); });
    A.on('gtfs', () => { if (A.gtfsState.ready && (!geo || !geo.real)) loadTrack(); });
    A.on('theme', () => renderReal());
    syncModeButtons();
    render();
  };

  V.show = function () {
    A.need('trains', true);
    setMode(mode);
  };
  V.hide = function () { A.need('trains', false); showTip(null); };
  V.key = function (e) {
    if (e.key === 'Escape') clear();
    if (!real) return;
    if (e.key === '+' || e.key === '=') real.map.zoomIn();
    if (e.key === '-') real.map.zoomOut();
  };

  function filter() { return new Set(A.settings.get('trainLines')); }
  function syncModeButtons() {
    A.$$('#t-mode button', root).forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
    A.$('#t-legend', root).hidden = mode !== 'diagram';
  }

  function setMode(m) {
    if (m !== mode) { mode = m; A.settings.set('trainView', m); }
    syncModeButtons();
    if (!real) {
      real = new A.MapView(A.$('#t-real', root), {
        basemap: m,
        onPick: (p) => { if (p.kind === 'vehicle') pickTrain(p.id); else if (p.kind === 'stop') pickStation(+p.id); },
        onBackground: () => clear(),
        onHover: (f, pt) => showTip(f && f.layer !== 'akl-stops' ? { kind: 'train', id: f.props.id, x: pt.x, y: pt.y }
                                     : f && f.props.id ? { kind: 'station', id: +f.props.id, x: pt.x, y: pt.y } : null),
      });
      fitNetwork();
    } else real.setBasemap(m);
    setTimeout(() => real.resize(), 30);
    if (!geo || !geo.real) loadTrack();
    renderReal();
  }
  function fitNetwork() {
    const f = filter();
    real.fit(NET.stations.filter((s) => [0, 1, 2].some((k) => f.has(k) && s.lines & (1 << k))).map((s) => [s.lon, s.lat]), 36);
  }

  // ---------- the track ----------
  // Every line is drawn along its own real track, cut from the shapes its
  // trains run today (each stretch in the line's direction of travel). Where
  // lines are on the same rails, wherever that is, they're drawn side by side
  // along one track; where they use different tracks (the CRL and the western
  // line at Maungawhau) each keeps to its own, and a station with platforms on
  // both gets a bar joining them, as on AT's map.
  const HUIA_CALLS = new Set(['The Strand', 'Puhinui', 'Pukekohe', 'Huntly', 'Hamilton Rotokauri', 'Hamilton Frankton'].map(idx));
  const IN_M = 25, OUT_M = 40;             // rails this close and parallel are drawn as one track (until they're this far apart)
  const STEP_M = 20;
  let drawnFor = '', drawn = null;

  /** The real track between each pair of stations, from AT's timetable. Straight lines stand in until it has loaded. */
  async function loadTrack() {
    if (!geo) geo = buildTrack(null);
    if (geoBusy || geo.real || !A.gtfsState.ready) return;
    geoBusy = true;
    try {
      const piece = (line, a, b) => ({ line, lon0: STATIONS[a].lon, lat0: STATIONS[a].lat, lon1: STATIONS[b].lon, lat1: STATIONS[b].lat });
      const cut = await A.gtfs.railTrack(NET.segs.map((s) => piece(NET.lineIds[s.line], s.from, s.to)).concat(
        [['Pukekohe', 'Huntly'], ['Huntly', 'Hamilton Rotokauri'], ['Hamilton Rotokauri', 'Hamilton Frankton']].map(([a, b]) => piece('HUIA', idx(a), idx(b)))));
      if (cut && cut.some(Boolean)) { geo = buildTrack(cut); drawnFor = ''; renderReal(); }
    } catch (e) { console.warn('train track:', e); }
    geoBusy = false;
  }

  /** Where a line's stretches meet at a station, pull ends within `m` metres to one point. */
  function meet(pieces, lines, m) {
    for (let n = 0; n < STATIONS.length; n++) {
      for (const li of lines) {
        const groups = [];
        for (const g of pieces) {
          if (g.line !== li) continue;
          for (const i of [g.a === n ? 0 : -1, g.b === n ? g.coords.length - 1 : -1]) {
            if (i < 0) continue;
            const p = g.coords[i], q = groups.find((x) => metres(x.at, p) < m);
            if (q) { q.ends.push({ g, i }); q.at = [(q.at[0] * (q.ends.length - 1) + p[0]) / q.ends.length, (q.at[1] * (q.ends.length - 1) + p[1]) / q.ends.length]; }
            else groups.push({ at: p.slice(), ends: [{ g, i }] });
          }
        }
        for (const q of groups) for (const e of q.ends) { e.g.coords = e.g.coords.slice(); e.g.coords[e.i] = q.at; }
      }
    }
  }

  function buildTrack(cut) {
    const P = (n) => [STATIONS[n].lon, STATIONS[n].lat];
    const pieces = NET.segs.map((s, i) => ({ line: s.line, a: s.from, b: s.to, coords: (cut && cut[i]) || [P(s.from), P(s.to)] }));
    meet(pieces, [0, 1, 2], 25);
    // Te Huia: The Strand is a short branch off the eastern line; from there it runs on AT's rails to Pukekohe
    const onRails = (a, b) => {
      const r = pieces.filter((g) => (g.a === a && g.b === b) || (g.a === b && g.b === a)).sort((x, y) => x.line - y.line)[0];
      return r ? (r.a === a ? r.coords : r.coords.slice().reverse()) : [P(a), P(b)];
    };
    const stops = HUIA_PATH.map(idx);
    const wo = pieces.find((g) => g.line === 0 && STATIONS[g.a].name === 'Waitematā' && STATIONS[g.b].name === 'Ōrākei');
    let spur = [P(STRAND), P(stops[0])];
    if (wo && wo.coords.length > 2) {
      let k = 1, kd = Infinity;
      wo.coords.forEach((c, i) => { const d = metres(c, P(STRAND)); if (i && i < wo.coords.length - 1 && d < kd) { kd = d; k = i; } });
      spur = [P(STRAND)].concat(wo.coords.slice(k));
    }
    pieces.push({ line: HUIA, a: STRAND, b: stops[0], coords: spur });
    for (let i = 0; i + 1 < stops.length; i++) pieces.push({ line: HUIA, a: stops[i], b: stops[i + 1], coords: onRails(stops[i], stops[i + 1]) });
    ['Pukekohe', 'Huntly', 'Hamilton Rotokauri', 'Hamilton Frankton'].map(idx).forEach((a, i, arr) => {
      if (i + 1 < arr.length) pieces.push({ line: HUIA, a, b: arr[i + 1], coords: (cut && cut[NET.segs.length + i]) || [P(a), P(arr[i + 1])] });
    });
    meet(pieces, [HUIA], 25);
    // each line as one continuous route (in its direction of travel), and where its stations fall along it
    const routes = [0, 1, 2, HUIA].map((line) => {
      const pts = [], stops = [];
      for (const g of pieces.filter((x) => x.line === line)) {
        const d = densify(g.coords, STEP_M);
        if (pts.length && metres(pts[pts.length - 1], d[0]) < 0.5) pts.push(...d.slice(1));
        else { stops.push({ st: g.a, k: pts.length }); pts.push(...d); }      // a gap: another platform
        stops.push({ st: g.b, k: pts.length - 1 });
      }
      return { line, pts, stops };
    });
    // junctions (three ways out) and stations where one AT line ends but another carries on
    const nb = STATIONS.map(() => new Set()), lineEnds = STATIONS.map(() => 0);
    for (const g of NET.segs) { nb[g.from].add(g.to); nb[g.to].add(g.from); }
    [0, 1, 2].forEach((li) => {
      const deg = new Map();
      for (const g of NET.segs) if (g.line === li) { deg.set(g.from, (deg.get(g.from) || 0) + 1); deg.set(g.to, (deg.get(g.to) || 0) + 1); }
      for (const [st, d] of deg) if (d === 1) lineEnds[st]++;
    });
    const nLines = (s) => [0, 1, 2].filter((k) => s.lines & (1 << k)).length;
    const junction = STATIONS.map((s, i) => nb[i].size >= 3 || (lineEnds[i] > 0 && nLines(s) > 1));
    const terminus = STATIONS.map((s, i) => nb[i].size === 1);
    return { real: !!(cut && cut.some(Boolean)), routes, junction, terminus };
  }

  /** Points no more than `step` metres apart along a line. */
  function densify(c, step) {
    const out = [c[0]];
    for (let i = 1; i < c.length; i++) {
      const n = Math.ceil(metres(c[i - 1], c[i]) / step);
      for (let k = 1; k <= n; k++) out.push([c[i - 1][0] + (c[i][0] - c[i - 1][0]) * k / n, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * k / n]);
    }
    return out;
  }

  /**
   * Works out, all along every line, which other lines are on the same rails,
   * and cuts the lines into runs: in each run a line sits in its slot beside
   * the others (E-W, S-C, O-W, then Te Huia), drawn along the first one's track.
   * Returns the pieces to draw and each line's track (for trains), for the lines showing.
   */
  function share(f) {
    const shown = geo.routes.filter((g) => g.line === HUIA || f.has(g.line));
    // every little segment of track, in a grid, so finding the rails near a point is quick
    const CELL = 0.0015, grid = new Map();
    const cellKey = (x, y) => Math.floor(x / CELL) + ':' + Math.floor(y / CELL);
    shown.forEach((g, gi) => {
      for (let i = 0; i + 1 < g.pts.length; i++) {
        for (const p of [g.pts[i], g.pts[i + 1]]) {
          const k = cellKey(p[0], p[1]);
          if (!grid.has(k)) grid.set(k, []);
          const list = grid.get(k);
          if (list[list.length - 1] !== gi * 1e6 + i) list.push(gi * 1e6 + i);
        }
      }
    });
    const unit = (a, b) => { const x = (b[0] - a[0]) * KX, y = b[1] - a[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

    // 1. at every point of every line: which other lines are on the same rails, and where
    const infos = shown.map((g) => {
      const pts = g.pts, n = pts.length;
      const inside = new Map();                // hysteresis: join under IN_M, part over OUT_M
      const info = pts.map((v, k) => {
        const dir = unit(pts[Math.max(0, k - 1)], pts[Math.min(n - 1, k + 1)]);
        const near = new Map();
        const cx = Math.floor(v[0] / CELL), cy = Math.floor(v[1] / CELL);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          for (const code of grid.get((cx + dx) + ':' + (cy + dy)) || []) {
            const gi = Math.floor(code / 1e6), i = code % 1e6, o = shown[gi];
            if (o.line === g.line) continue;
            const a = o.pts[i], b = o.pts[i + 1];
            const ax = (b[0] - a[0]) * KX, ay = b[1] - a[1], l2 = ax * ax + ay * ay;
            const t = l2 ? Math.min(1, Math.max(0, (((v[0] - a[0]) * KX) * ax + (v[1] - a[1]) * ay) / l2)) : 0;
            const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            const d = metres(q, v);
            if (d > OUT_M) continue;
            const od = unit(a, b);
            if (Math.abs(od[0] * dir[0] + od[1] * dir[1]) < 0.85) continue;      // crossing, not sharing
            const cur = near.get(o.line);
            if (!cur || d < cur.d) near.set(o.line, { d, q, dir: od, gi, i: t < 0.5 ? i : i + 1 });
          }
        }
        const all = new Map(near);
        for (const li of [0, 1, 2, HUIA]) {
          const x = near.get(li);
          const on = x && (inside.get(li) ? x.d <= OUT_M : x.d <= IN_M);
          inside.set(li, !!on);
          if (!on) near.delete(li);
        }
        // how far to the right of this line each other line is (m)
        const lat = new Map();
        for (const [li, x] of near) lat.set(li, (dir[1] * (x.q[0] - v[0]) * KX - dir[0] * (x.q[1] - v[1])) * M);
        const set = [g.line].concat(Array.from(near.keys())).sort((x, y) => x - y);
        return { set, key: set.join(','), all, near, lat, dir };
      });
      // lines parting and meeting can flicker in and out for a few points: smooth that over
      for (let k = 1; k < n; k++) {
        if (info[k].key === info[k - 1].key) continue;
        let e = k;
        while (e < n && info[e].key === info[k].key) e++;
        if (e - k < 8 && e < n && info[e].key === info[k - 1].key) {
          for (let j = k; j < e; j++) info[j] = Object.assign({}, info[j], { set: info[k - 1].set, key: info[k - 1].key });
        }
      }
      // runs of the same company
      const runs = [];
      let s = 0;
      for (let k = 1; k <= n; k++) if (k === n || info[k].key !== info[s].key) { runs.push([s, k - 1]); s = k; }
      return { g, info, runs };
    });

    // 2. each shared run is laid out by its first line (the reference): the others sit
    //    to its left or right in the order they really are, so lines meet and part without crossing
    const orderAt = infos.map((x) => new Array(x.info.length).fill(null));
    infos.forEach(({ g, info, runs }, gi) => {
      for (const [a, b] of runs) {
        const set = info[a].set;
        if (set[0] !== g.line) continue;
        // which side each line comes in from and goes out to: the first and last 160 m of the run
        const side = new Map(set.map((li) => [li, 0]));
        for (let k = a; k <= b; k++) {
          if (k - a >= 8 && b - k >= 8) continue;
          for (const [li, d] of info[k].lat) if (side.has(li)) side.set(li, side.get(li) + Math.max(-30, Math.min(30, d)));
        }
        const order = set.slice().sort((x, y) => side.get(x) - side.get(y) || x - y);
        for (let k = a; k <= b; k++) orderAt[gi][k] = order;
      }
    });

    // 3. draw: every run of every line in its slot, along the reference line's track
    const out = [], track = [[], [], []], ends = STATIONS.map(() => []);
    infos.forEach(({ g, info, runs }, gi) => {
      const at = info.map((x, k) => { const r = x.set[0] === g.line ? null : x.all.get(x.set[0]); return r ? r.q : g.pts[k]; });
      for (const [a, b] of runs) {
        const set = info[a].set, mid = Math.floor((a + b) / 2), m = info[mid];
        let order = set;
        let same = true;
        if (set[0] === g.line) order = orderAt[gi][mid] || set;
        else {
          const r = m.all.get(set[0]);
          const o = r && orderAt[r.gi][Math.min(r.i, orderAt[r.gi].length - 1)];
          if (o && o.slice().sort((x, y) => x - y).join(',') === m.key) order = o;
          if (r) same = r.dir[0] * m.dir[0] + r.dir[1] * m.dir[1] >= 0;
        }
        const w = order.map((li) => (li === HUIA ? HUIA_W : LINE_W));
        const total = w.reduce((t, x) => t + x, 0) + GAP * (order.length - 1);
        const slot = order.indexOf(g.line);
        const off = -total / 2 + w.slice(0, slot).reduce((t, x) => t + x + GAP, 0) + w[slot] / 2;
        const run = at.slice(a, Math.min(at.length, b + 2));
        if (run.length > 1) out.push({ coords: run, color: g.line === HUIA ? HUIA_COLOR() : NET.lineColors[g.line], width: w[slot], offset: same ? off : -off, z: true });
      }
      if (g.line !== HUIA) track[g.line].push({ xs: at.map((c) => c[0] * KX), ys: at.map((c) => c[1]) });
      for (const x of g.stops) ends[x.st].push({ line: g.line, p: at[x.k] });
    });
    return { lines: out, track, ends };
  }
  function layout(f) {
    const key = Array.from(f).sort().join(',') + (A.isDark() ? 'd' : 'l') + (geo.real ? 'r' : '');
    if (drawnFor !== key) { drawn = share(f); drawnFor = key; }
    return drawn;
  }

  /**
   * Where a station's dot (or dots) go: its platforms on the lines showing. A
   * line's own ends there count once; lines on the same track share a dot.
   * Several dots means the lines use different tracks there, and a bar joins them.
   */
  function stationPoints(i, f) {
    const byLine = new Map();
    for (const e of drawn.ends[i]) {
      if (e.line === HUIA ? !HUIA_CALLS.has(i) : !f.has(e.line)) continue;
      const list = byLine.get(e.line) || [];
      const q = list.find((x) => metres(x.at, e.p) < 45);
      if (q) { q.n++; q.at = [(q.at[0] * (q.n - 1) + e.p[0]) / q.n, (q.at[1] * (q.n - 1) + e.p[1]) / q.n]; }
      else list.push({ at: e.p.slice(), n: 1 });
      byLine.set(e.line, list);
    }
    const pts = [];
    for (const list of byLine.values()) for (const e of list) {
      const q = pts.find((x) => metres(x.at, e.at) < 12);
      if (q) { q.n++; q.at = [(q.at[0] * (q.n - 1) + e.at[0]) / q.n, (q.at[1] * (q.n - 1) + e.at[1]) / q.n]; }
      else pts.push({ at: e.at.slice(), n: 1 });
    }
    if (pts.length < 3) return pts.map((q) => q.at);
    // three or more: in order along the bar
    let a = 0, b = 1, far = 0;
    pts.forEach((p, x) => pts.forEach((q, y) => { const d = metres(p.at, q.at); if (d > far) { far = d; a = x; b = y; } }));
    const o = pts[a].at, dir = [(pts[b].at[0] - o[0]) * KX, pts[b].at[1] - o[1]];
    const along = (p) => (p[0] - o[0]) * KX * dir[0] + (p[1] - o[1]) * dir[1];
    return pts.map((q) => q.at).sort((p, q) => along(p) - along(q));
  }

  /** The closest point on a line's track to a GPS fix. */
  function snap(li, lon, lat) {
    const px = lon * KX;
    let best = null, bd = Infinity;
    for (const { xs, ys } of drawn.track[li] || []) {
      for (let i = 0; i < xs.length - 1; i++) {
        const dx = xs[i + 1] - xs[i], dy = ys[i + 1] - ys[i], l2 = dx * dx + dy * dy;
        const t = l2 ? Math.min(1, Math.max(0, ((px - xs[i]) * dx + (lat - ys[i]) * dy) / l2)) : 0;
        const ex = xs[i] + t * dx - px, ey = ys[i] + t * dy - lat, d = ex * ex + ey * ey;
        if (d < bd) { bd = d; best = { x: xs[i] + t * dx, y: ys[i] + t * dy }; }
      }
    }
    if (!best || Math.sqrt(bd) * M > 250) return null;       // off the line: a yard or a depot
    return [best.x / KX, best.y];
  }
  const bearing = (a, b) => (Math.atan2((b[0] - a[0]) * KX, b[1] - a[1]) * 180 / Math.PI + 360) % 360;
  const metres = (a, b) => Math.hypot((b[0] - a[0]) * KX, b[1] - a[1]) * M;

  function renderReal() {
    if (!real) return;
    if (!geo) geo = buildTrack(null);
    const f = filter();
    const dg = mode === 'diagram';
    const key = A.$('#t-huia-key', root);
    if (key) key.style.setProperty('--c', HUIA_COLOR());
    real.setLines(layout(f).lines);
    const sel = selStation, stops = [], links = [];
    STATIONS.forEach((s, i) => {
      const lines = [0, 1, 2].filter((k) => f.has(k) && s.lines & (1 << k));
      if (!s.extra && !lines.length) return;
      const pts = stationPoints(i, f);
      if (!pts.length) pts.push([s.lon, s.lat]);
      const r = s.extra ? 1.1 : geo.junction[i] ? 1.6 : lines.length > 1 ? 1.35 : geo.terminus[i] ? 1.2 : 1;
      const color = pts.length > 1 || (!s.extra && (lines.length > 1 || i === sel)) ? A.pal.navy : s.extra ? HUIA_COLOR() : NET.lineColors[lines[0]];
      if (pts.length > 1) links.push({ coords: pts, color });
      pts.forEach((p, k) => stops.push({ lon: p[0], lat: p[1], id: s.extra ? undefined : String(i), label: k === 0 ? s.name : undefined,
                                         rank: s.priority, r, big: i === sel, color }));
    });
    real.setLinks(links);
    real.setStops(stops);
    // every train where its GPS says, put on its own line's track
    const seen = new Set();
    real.setCrowd(A.state.trains.list.filter((t) => f.has(t.line)).map((t) => {
      const at = snap(t.line, t.v.lon, t.v.lat) || [t.v.lon, t.v.lat];
      seen.add(t.v.id);
      let b = t.v.bearing ? t.v.bearing : null;          // 0 comes through when a train doesn't know
      const h = heading.get(t.v.id);
      if (b == null && h) b = metres(h.at, at) > 25 ? bearing(h.at, at) : h.b;   // else the way it has moved
      if (!h || metres(h.at, at) > 25) heading.set(t.v.id, { at, b });
      else h.b = b;
      const late = t.delay != null && t.delay >= 120 ? Math.round(t.delay / 60) : 0;
      return { id: t.v.id, lon: at[0], lat: at[1], bearing: b, color: NET.lineColors[t.line], kind: 'train', li: t.line,
               pin: dg, late: dg ? late : 0, label: dg ? undefined : NET.lineIds[t.line] };
    }));
    for (const id of Array.from(heading.keys())) if (!seen.has(id)) heading.delete(id);
    real.select(selTrain);
  }

  function render() {
    const st = A.state.trains;
    const f = filter();
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
    renderReal();
    renderSide();
  }

  // ---------- selection ----------
  function pickTrain(id) {
    selTrain = id; selStation = null; stationDeps = null; trip = null;
    clearInterval(stationTimer);
    if (real) real.select(id);
    const t = A.state.trains.list.find((x) => x.v.id === id);
    if (t && t.v.tripId) {
      A.trains.trip(t.v.tripId, t.v.startDate).then((d) => { if (selTrain === id) { trip = d; renderSide(); } }).catch(() => {});
    }
    renderSide();
  }
  function pickStation(i) {
    selStation = i; selTrain = null; trip = null; stationDeps = null;
    renderReal();
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
    renderReal();
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
        `<p class="help">Click a train for where it's going, its speed and its next stops. Click a station for live departures from every platform. The diagram follows the real tracks, with every train where its GPS puts it, pointing the way it's heading. Satellite and Map show them over aerial photos or a street map. Scroll to zoom, drag to pan, right-drag to rotate.</p>`;
    }
    A.$$('[data-station]', side).forEach((e) => { e.onclick = () => pickStation(+e.dataset.station); });
    const cb = A.$('.close-btn', side);
    if (cb) cb.onclick = clear;
    A.tick();
  }

  (A.views = A.views || {}).trains = V;
})(window.AKL);
