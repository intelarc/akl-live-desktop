// Real maps (MapLibre GL): Esri or LINZ aerials, or OpenFreeMap streets, with
// routes, stops and vehicles on top. A crowd of a thousand buses is drawn by
// the map itself and glides between GPS fixes.
(function (A) {
  'use strict';
  const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
  const FONT = ['Noto Sans Bold'];
  const CROWD_MS = 4000, MARK_MS = 10000;
  A.AKL_BOUNDS = [[174.56, -37.08], [174.98, -36.62]];

  function satellite(dark) {
    const linz = (A.settings.get('linzKey') || '').trim();
    const tiles = linz
      ? 'https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/{z}/{x}/{y}.webp?api=' + encodeURIComponent(linz)
      : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    return {
      version: 8, glyphs: GLYPHS,
      sources: { imagery: { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom: linz ? 21 : 19,
        attribution: linz ? '© Toitū Te Whenua LINZ, CC BY 4.0' : 'Powered by Esri · Esri, Maxar, Earthstar Geographics' } },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0B1628' } },
        { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-brightness-max': dark ? 0.82 : 1, 'raster-saturation': -0.12 } },
      ],
    };
  }
  function styleFor(basemap) {
    return basemap === 'streets' ? 'https://tiles.openfreemap.org/styles/' + (A.isDark() ? 'dark' : 'liberty') : satellite(A.isDark());
  }

  // ---------- icons, drawn once ----------
  function image(w, h, draw) {
    const k = 2;
    const c = document.createElement('canvas');
    c.width = w * k; c.height = h * k;
    const ctx = c.getContext('2d');
    ctx.scale(k, k);
    draw(ctx);
    return { width: c.width, height: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
  }
  /** A white arrowhead just outside a dot, pointing north; the layer turns it to the heading. */
  const arrowImg = () => image(40, 40, (ctx) => {
    ctx.beginPath(); ctx.moveTo(20, 4); ctx.lineTo(25, 10.5); ctx.lineTo(15, 10.5); ctx.closePath();
    ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.strokeStyle = '#0B1628'; ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; ctx.stroke();
  });
  /** A bus from above, facing north, in an operator's colour. */
  const busImg = (col) => image(22, 44, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.roundRect(3, 4, 17, 38, 5); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.roundRect(1, 1, 20, 40, 6); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(3, 3, 16, 36, 4.5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.beginPath(); ctx.roundRect(4.5, 4.5, 13, 5, 2); ctx.fill();   // windscreen
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(7, 14, 8, 4); ctx.fillRect(7, 24, 8, 4);          // roof hatches
  });

  A.MapView = class {
    constructor(el, o) {
      this.o = o || {};
      this.basemap = this.o.basemap || A.settings.get('basemap');
      this.data = { lines: [], stops: [], crowd: [] };
      this.glides = new Map();
      this.crowdStart = 0;
      this.marks = new Map();
      this.sel = null;
      this.ready = false;
      this.map = new maplibregl.Map({
        container: el, style: styleFor(this.basemap), center: [174.76, -36.88], zoom: 10.6,
        minZoom: 8, maxZoom: 19.5, dragRotate: false, pitchWithRotate: false, maxPitch: 0,
        attributionControl: { compact: true }, fadeDuration: 120, interactive: this.o.interactive !== false,
        cooperativeGestures: !!this.o.cooperativeGestures,     // maps inside a scrolling page: Ctrl + scroll zooms
      });
      this.map.touchZoomRotate.disableRotation();
      this.map.keyboard.disableRotation();
      if (this.o.interactive !== false) {
        this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
        this.map.addControl(new maplibregl.ScaleControl({ maxWidth: 110 }), 'bottom-left');
      }
      this.map.on('style.load', () => this._install());
      (A.maps = A.maps || []).push(this);          // for poking at from the dev tools
      this.map.on('error', (e) => console.warn('map:', e && e.error ? e.error.message : e));
      this._events();
      this._tick = this._tick.bind(this);
      this._stopTheme = A.on('theme', () => this.setBasemap(this.basemap, true));   // dark or light tiles
    }

    setBasemap(b, force) {
      if (b === this.basemap && !force) return;
      this.basemap = b;
      this.ready = false;
      this.map.setStyle(styleFor(b), { diff: false });   // a full reload, so style.load re-adds our layers
    }

    resize() { this.map.resize(); }

    _install() {
      const m = this.map;
      if (!m.hasImage('akl-arrow')) m.addImage('akl-arrow', arrowImg(), { pixelRatio: 2 });
      for (const code of Object.keys(A.fleet.OPERATORS).concat(['XX'])) {
        if (!m.hasImage('bus-' + code)) m.addImage('bus-' + code, busImg(A.fleet.color(code)), { pixelRatio: 2 });
      }
      const empty = { type: 'FeatureCollection', features: [] };
      for (const id of ['akl-lines', 'akl-stops', 'crowd']) if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: empty });
      const zoom = ['zoom'];
      m.addLayer({ id: 'akl-lines-case', type: 'line', source: 'akl-lines', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0B1628', 'line-opacity': 0.55, 'line-width': ['+', ['get', 'width'], 3], 'line-offset': ['get', 'offset'] } });
      m.addLayer({ id: 'akl-lines', type: 'line', source: 'akl-lines', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-offset': ['get', 'offset'] } });
      m.addLayer({ id: 'akl-stops', type: 'circle', source: 'akl-stops',
        paint: { 'circle-color': '#FFFFFF', 'circle-stroke-color': ['get', 'color'],
                 'circle-radius': ['interpolate', ['linear'], zoom, 10, ['case', ['get', 'big'], 7, 2.6], 14, ['case', ['get', 'big'], 7, 4.2]],
                 'circle-stroke-width': ['case', ['get', 'big'], 4, 2] } });
      m.addLayer({ id: 'akl-stop-labels', type: 'symbol', source: 'akl-stops', filter: ['has', 'label'],
        layout: { 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 12, 'text-anchor': 'left', 'text-offset': [0.9, 0],
                  'text-optional': true },
        paint: { 'text-color': '#1A2744', 'text-halo-color': 'rgba(255,255,255,0.92)', 'text-halo-width': 2.2 } });
      m.addLayer({ id: 'crowd-sel', type: 'circle', source: 'crowd', filter: ['==', ['get', 'id'], ''],
        paint: { 'circle-color': ['get', 'c'], 'circle-opacity': 0.3, 'circle-radius': 18 } });
      const big = ['==', ['get', 'k'], 'train'];
      const isBus = ['==', ['get', 'k'], 'bus'];
      m.addLayer({ id: 'crowd-dots', type: 'circle', source: 'crowd',
        paint: {
          'circle-color': ['get', 'c'],
          'circle-radius': ['interpolate', ['linear'], zoom, 9, ['case', big, 4, 2.4], 11, ['case', big, 5, 3.4],
                            13, ['case', big, 7, 5], 15, ['case', big, 9, 7.5]],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': ['interpolate', ['linear'], zoom, 9, 0.6, 13, 1.6],
          'circle-opacity': ['step', zoom, 1, 14.6, ['case', isBus, 0, 1]],          // buses become icons up close
          'circle-stroke-opacity': ['step', zoom, 1, 14.6, ['case', isBus, 0, 1]],
        } });
      m.addLayer({ id: 'crowd-arrows', type: 'symbol', source: 'crowd', minzoom: 12, filter: ['has', 'b'],
        layout: { 'icon-image': 'akl-arrow', 'icon-rotate': ['get', 'b'], 'icon-rotation-alignment': 'map',
                  'icon-allow-overlap': true, 'icon-ignore-placement': true,
                  'icon-size': ['interpolate', ['linear'], zoom, 12, 0.6, 15, ['case', big, 1.2, 1]] },
        paint: { 'icon-opacity': ['step', zoom, 1, 14.6, ['case', isBus, 0, 1]] } });
      m.addLayer({ id: 'crowd-icons', type: 'symbol', source: 'crowd', minzoom: 14.6, filter: ['==', ['get', 'k'], 'bus'],
        layout: { 'icon-image': ['concat', 'bus-', ['get', 'op']], 'icon-rotate': ['coalesce', ['get', 'b'], 0],
                  'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
                  'icon-size': ['interpolate', ['linear'], zoom, 14.6, 0.75, 18, 1.5] } });
      m.addLayer({ id: 'crowd-labels', type: 'symbol', source: 'crowd', minzoom: 13.2, filter: ['has', 'r'],
        layout: { 'text-field': ['get', 'r'], 'text-font': FONT, 'text-size': 11.5, 'text-anchor': 'bottom',
                  'text-offset': [0, -1], 'text-optional': true, 'text-padding': 1 },
        paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#0B1628', 'text-halo-width': 1.8 } });
      this.ready = true;
      this.setLines(this.data.lines);
      this.setStops(this.data.stops);
      this._pushCrowd(performance.now(), true);
      this._applySel();
      if (this.o.onReady) this.o.onReady(this);
    }

    /** [{ coords: [[lon, lat], ...] | [[[lon, lat]...], ...], color, width, offset }] */
    setLines(lines) {
      this.data.lines = lines;
      const src = this.ready && this.map.getSource('akl-lines');
      if (!src) return;
      src.setData({ type: 'FeatureCollection', features: lines.map((l) => ({
        type: 'Feature',
        geometry: Array.isArray(l.coords[0][0]) ? { type: 'MultiLineString', coordinates: l.coords } : { type: 'LineString', coordinates: l.coords },
        properties: { color: l.color, width: l.width || 4, offset: l.offset || 0 },
      })) });
    }

    /** [{ lon, lat, color, big, label, id }] */
    setStops(stops) {
      this.data.stops = stops;
      const src = this.ready && this.map.getSource('akl-stops');
      if (!src) return;
      src.setData({ type: 'FeatureCollection', features: stops.map((s) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: Object.assign({ color: s.color, big: !!s.big, id: s.id != null ? String(s.id) : '' }, s.label ? { label: s.label } : {}),
      })) });
    }

    /** The crowd: [{ id, lon, lat, bearing, color, op, kind: bus|train|ferry, label }]. Glides to new fixes. */
    setCrowd(list) {
      const now = performance.now();
      const seen = new Set();
      for (const d of list) {
        seen.add(d.id);
        const g = this.glides.get(d.id);
        if (!g) { this.glides.set(d.id, { fx: d.lon, fy: d.lat, tx: d.lon, ty: d.lat }); continue; }
        if (g.tx === d.lon && g.ty === d.lat) continue;
        const [cx, cy] = this._at(g, now);
        const far = Math.hypot(cx - d.lon, (cy - d.lat) * 1.25) > 0.02;       // a new trip: jump, don't slide across town
        g.fx = far ? d.lon : cx; g.fy = far ? d.lat : cy; g.tx = d.lon; g.ty = d.lat;
      }
      for (const id of Array.from(this.glides.keys())) if (!seen.has(id)) this.glides.delete(id);
      this.data.crowd = list;
      this.crowdStart = now;
      this._pushCrowd(now, true);
      this._kick();
    }

    _at(g, now) {
      const t = Math.min(1, Math.max(0, (now - this.crowdStart) / CROWD_MS));
      const e = t * t * (3 - 2 * t);
      return [g.fx + (g.tx - g.fx) * e, g.fy + (g.ty - g.fy) * e];
    }

    _pushCrowd(now) {
      const src = this.ready && this.map.getSource('crowd');
      if (!src) return;
      src.setData({ type: 'FeatureCollection', features: this.data.crowd.map((d) => {
        const g = this.glides.get(d.id);
        const [x, y] = g ? this._at(g, now) : [d.lon, d.lat];
        const p = { id: d.id, c: d.color, k: d.kind || 'bus', op: d.op || 'XX' };
        if (d.bearing != null) p.b = d.bearing;
        if (d.label) p.r = d.label;
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: p };
      }) });
    }

    /**
     * A few special vehicles as HTML markers with a tag (the route map's buses):
     * [{ id, lon, lat, bearing, color, tag }]
     */
    setMarkers(list) {
      const now = performance.now();
      const seen = new Set();
      for (const d of list) {
        seen.add(d.id);
        let m = this.marks.get(d.id);
        if (!m) {
          const el = A.el('<div class="vmark"><div class="vtag"></div><div class="vbus"></div></div>');
          el.addEventListener('click', (e) => { e.stopPropagation(); if (this.o.onPick) this.o.onPick({ kind: 'marker', id: d.id }); });
          const mk = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([d.lon, d.lat]).addTo(this.map);
          m = { el, mk, fx: d.lon, fy: d.lat, tx: d.lon, ty: d.lat, start: now };
          this.marks.set(d.id, m);
        } else if (m.tx !== d.lon || m.ty !== d.lat) {
          const [cx, cy] = this._markAt(m, now);
          const far = Math.hypot(cx - d.lon, (cy - d.lat) * 1.25) > 0.02;
          m.fx = far ? d.lon : cx; m.fy = far ? d.lat : cy; m.tx = d.lon; m.ty = d.lat; m.start = now;
        }
        m.el.style.setProperty('--c', d.color);
        m.el.querySelector('.vbus').style.transform = `rotate(${d.bearing || 0}deg)`;
        const tag = m.el.querySelector('.vtag');
        tag.textContent = d.tag || '';
        tag.style.display = d.tag ? '' : 'none';
        m.el.classList.toggle('sel', d.id === this.sel);
      }
      for (const [id, m] of this.marks) if (!seen.has(id)) { m.mk.remove(); this.marks.delete(id); }
      this._kick();
    }
    _markAt(m, now) {
      const t = Math.min(1, Math.max(0, (now - m.start) / MARK_MS));
      const e = t * t * (3 - 2 * t);
      return [m.fx + (m.tx - m.fx) * e, m.fy + (m.ty - m.fy) * e];
    }

    select(id) {
      this.sel = id;
      this._applySel();
      for (const [mid, m] of this.marks) m.el.classList.toggle('sel', mid === id);
      this._kick();
    }
    _applySel() {
      if (this.ready && this.map.getLayer('crowd-sel')) this.map.setFilter('crowd-sel', ['==', ['get', 'id'], this.sel || '']);
    }
    /** Where a crowd vehicle is drawn right now. */
    posOf(id) {
      const g = this.glides.get(id);
      return g ? this._at(g, performance.now()) : null;
    }

    // one animation loop: crowd glides, marker glides, the selection's pulse
    _kick() { if (!this._running) { this._running = true; requestAnimationFrame(this._tick); } }
    _tick(ts) {
      const now = performance.now();
      let more = false;
      if (now - this.crowdStart < CROWD_MS + 100) {
        if (!this._lastPush || now - this._lastPush > 40) { this._pushCrowd(now); this._lastPush = now; }
        more = true;
      }
      for (const m of this.marks.values()) {
        if (now - m.start < MARK_MS + 100) { m.mk.setLngLat(this._markAt(m, now)); more = true; }
      }
      if (this.sel && this.ready && this.map.getLayer('crowd-sel')) {
        const p = 0.5 + 0.5 * Math.sin(now / 250);
        this.map.setPaintProperty('crowd-sel', 'circle-radius', 14 + 8 * p);
        this.map.setPaintProperty('crowd-sel', 'circle-opacity', 0.18 + 0.2 * p);
        if (this.follow) {
          const at = this.posOf(this.sel);
          if (at && !this.map.isMoving()) this.map.setCenter(at);
        }
        more = true;
      }
      if (more && !document.hidden) requestAnimationFrame(this._tick); else this._running = false;
    }

    fit(points, pad, maxZoom) {
      if (!points || !points.length) return;
      const b = new maplibregl.LngLatBounds(points[0], points[0]);
      points.forEach((p) => b.extend(p));
      this.map.fitBounds(b, { padding: pad == null ? 48 : pad, maxZoom: maxZoom || 15.5, duration: this._fitted ? 700 : 0 });
      this._fitted = true;
    }
    flyTo(lon, lat, zoom) { this.map.flyTo({ center: [lon, lat], zoom: Math.max(this.map.getZoom(), zoom || 14.5), speed: 1.6 }); }

    _events() {
      const m = this.map;
      const pickable = () => ['crowd-icons', 'crowd-dots', 'akl-stops'].filter((l) => m.getLayer(l));
      const nearest = (pt) => {
        const r = 10;
        const hits = this.ready ? m.queryRenderedFeatures([[pt.x - r, pt.y - r], [pt.x + r, pt.y + r]], { layers: pickable() }) : [];
        let best = null, bd = Infinity;
        for (const f of hits) {
          const c = m.project(f.geometry.coordinates);
          const d = Math.hypot(c.x - pt.x, c.y - pt.y) - (f.layer.id === 'akl-stops' ? -4 : 0);
          if (d < bd) { bd = d; best = f; }
        }
        return best;
      };
      m.on('click', (e) => {
        const f = nearest(e.point);
        if (f && f.layer.id === 'akl-stops') { if (f.properties.id && this.o.onPick) this.o.onPick({ kind: 'stop', id: f.properties.id }); }
        else if (f) { if (this.o.onPick) this.o.onPick({ kind: 'vehicle', id: f.properties.id }); }
        else if (this.o.onBackground) this.o.onBackground();
      });
      let pending = null;
      m.on('mousemove', (e) => {
        pending = e.point;
        if (this._hoverQueued) return;
        this._hoverQueued = true;
        requestAnimationFrame(() => {
          this._hoverQueued = false;
          const f = nearest(pending);
          m.getCanvas().style.cursor = f && (f.layer.id !== 'akl-stops' || f.properties.id) ? 'pointer' : '';
          if (this.o.onHover) this.o.onHover(f ? { layer: f.layer.id, props: f.properties } : null, pending);
        });
      });
      m.on('mouseout', () => { if (this.o.onHover) this.o.onHover(null); });
      m.on('dragstart', () => { this.follow = false; if (this.o.onUnfollow) this.o.onUnfollow(); });
    }

    destroy() { this._stopTheme(); this.map.remove(); }
  };
})(window.AKL);
