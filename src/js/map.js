// Real maps (MapLibre GL) in full detail: Esri or LINZ aerials with streets,
// place names and 3D buildings over them (or OpenFreeMap's street map), 3D
// terrain with a sky, every stop in Auckland, journeys, routes, and a crowd of
// a thousand live vehicles that glide between GPS fixes.
(function (A) {
  'use strict';
  const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
  const FONT = ['Noto Sans Bold'], FONT_R = ['Noto Sans Regular'];
  const CROWD_MS = 4000, MARK_MS = 10000;
  const TERRAIN = { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                    encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: 'Terrain: Mapzen / AWS Open Data' };
  A.AKL_BOUNDS = [[174.56, -37.08], [174.98, -36.62]];
  A.MODE_COLOR = { bus: '#1E88E5', train: '#2E3A59', ferry: '#0A8F8F', walk: '#8E9AAF' };

  const nameExpr = ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name']];

  /** Aerial photos with the streets drawn in: roads, names, places, and buildings in 3D. */
  function satellite(dark) {
    const linz = (A.settings.get('linzKey') || '').trim();
    const tiles = linz
      ? 'https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/{z}/{x}/{y}.webp?api=' + encodeURIComponent(linz)
      : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    const halo = 'rgba(8,14,26,0.85)';
    return {
      version: 8, glyphs: GLYPHS,
      sources: {
        imagery: { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom: linz ? 21 : 19,
          attribution: linz ? '© Toitū Te Whenua LINZ, CC BY 4.0' : 'Powered by Esri · Esri, Maxar, Earthstar Geographics' },
        omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenMapTiles © OpenStreetMap contributors' },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0B1628' } },
        { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-brightness-max': dark ? 0.8 : 1, 'raster-saturation': -0.1, 'raster-contrast': 0.05 } },
        { id: 'hy-roads-major', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 10,
          filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], true, false],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': 'rgba(255,226,150,0.5)', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 14, 2.2, 18, 7] } },
        { id: 'hy-roads-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 14,
          filter: ['match', ['get', 'class'], ['secondary', 'tertiary', 'minor', 'service'], true, false],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': 'rgba(255,255,255,0.28)', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 18, 4] } },
        { id: 'hy-buildings', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14.5,
          paint: { 'fill-extrusion-color': dark ? '#9fb1cc' : '#e8eef6', 'fill-extrusion-opacity': 0.55,
                   'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0] } },
        { id: 'hy-water-names', type: 'symbol', source: 'omt', 'source-layer': 'water_name', minzoom: 11,
          layout: { 'text-field': nameExpr, 'text-font': FONT_R, 'text-size': 12, 'text-letter-spacing': 0.1 },
          paint: { 'text-color': '#bfe3ff', 'text-halo-color': halo, 'text-halo-width': 1.4 } },
        { id: 'hy-road-names', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14,
          layout: { 'symbol-placement': 'line', 'text-field': nameExpr, 'text-font': FONT_R, 'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10.5, 18, 14],
                    'text-max-angle': 30, 'text-padding': 4 },
          paint: { 'text-color': '#ffffff', 'text-halo-color': halo, 'text-halo-width': 1.5 } },
        { id: 'hy-poi', type: 'symbol', source: 'omt', 'source-layer': 'poi', minzoom: 16,
          filter: ['<=', ['coalesce', ['get', 'rank'], 30], 40],
          layout: { 'text-field': nameExpr, 'text-font': FONT_R, 'text-size': 11, 'text-optional': true, 'text-padding': 6, 'text-max-width': 8 },
          paint: { 'text-color': '#ffe7b3', 'text-halo-color': halo, 'text-halo-width': 1.4 } },
        { id: 'hy-places', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 9,
          filter: ['match', ['get', 'class'], ['city', 'town', 'suburb', 'neighbourhood', 'village', 'quarter'], true, false],
          layout: { 'text-field': nameExpr, 'text-font': FONT,
                    'text-size': ['match', ['get', 'class'], 'city', 16, 'town', 14, 'suburb', 13, 12],
                    'text-transform': ['match', ['get', 'class'], ['suburb', 'neighbourhood', 'quarter'], 'uppercase', 'none'],
                    'text-letter-spacing': ['match', ['get', 'class'], ['suburb', 'neighbourhood', 'quarter'], 0.08, 0], 'text-max-width': 8 },
          paint: { 'text-color': '#ffffff', 'text-halo-color': halo, 'text-halo-width': 1.6 } },
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
  const arrowImg = () => image(40, 40, (ctx) => {
    ctx.beginPath(); ctx.moveTo(20, 4); ctx.lineTo(25, 10.5); ctx.lineTo(15, 10.5); ctx.closePath();
    ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.strokeStyle = '#0B1628'; ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; ctx.stroke();
  });
  /** A bus from above, facing north, in an operator's colour. */
  const busImg = (col) => image(22, 44, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.roundRect(3, 4, 17, 38, 5); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.roundRect(1, 1, 20, 40, 6); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(3, 3, 16, 36, 4.5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.beginPath(); ctx.roundRect(4.5, 4.5, 13, 5, 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(7, 14, 8, 4); ctx.fillRect(7, 24, 8, 4);
  });
  /** A train from above: long, with a nose. */
  const trainImg = (col) => image(20, 60, (ctx) => {
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.roundRect(1, 1, 18, 58, [9, 9, 4, 4]); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(3, 3, 14, 54, [7, 7, 3, 3]); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.roundRect(5, 6, 10, 5, 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(3, 29, 14, 1.5);
  });
  /** A stop sign from above: an AT roundel. */
  const stopImg = (col) => image(22, 22, (ctx) => {
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(11, 11, 10, 0, 7); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(11, 11, 8, 0, 7); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.roundRect(6.5, 7, 9, 6.5, 1.5); ctx.fill();
    ctx.fillStyle = col; ctx.fillRect(7.7, 8.2, 6.6, 2.2);
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(8.3, 15.2, 1.1, 0, 7); ctx.arc(13.7, 15.2, 1.1, 0, 7); ctx.fill();
  });

  /** A little toolbar on the map: 3D and follow-me. */
  class Tools {
    constructor(view) { this.view = view; }
    onAdd() {
      const el = document.createElement('div');
      el.className = 'maplibregl-ctrl maplibregl-ctrl-group map-3d';
      el.innerHTML = '<button type="button" title="Tilt into 3D (with terrain)" class="t3d">3D</button>';
      el.querySelector('.t3d').onclick = () => this.view.toggle3d();
      this.el = el;
      return el;
    }
    onRemove() { this.el.remove(); }
  }

  const empty = () => ({ type: 'FeatureCollection', features: [] });

  A.MapView = class {
    constructor(el, o) {
      this.o = o || {};
      this.basemap = this.o.basemap || A.settings.get('basemap');
      this.data = { lines: [], stops: [], crowd: [], journey: null, allStops: null };
      this.glides = new Map();
      this.crowdStart = 0;
      this.marks = new Map();
      this.pins = [];
      this.sel = null;
      this.ready = false;
      this.is3d = false;
      const interactive = this.o.interactive !== false;
      this.map = new maplibregl.Map({
        container: el, style: styleFor(this.basemap), center: [174.76, -36.88], zoom: 10.6,
        minZoom: 8, maxZoom: 19.5, maxPitch: 78, attributionControl: { compact: true }, fadeDuration: 120,
        interactive, cooperativeGestures: !!this.o.cooperativeGestures,
      });
      if (interactive) {
        this.map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
        this.map.addControl(new Tools(this), 'bottom-right');
        this.map.addControl(new maplibregl.ScaleControl({ maxWidth: 110 }), 'bottom-right');
      }
      this.map.on('style.load', () => this._install());
      (A.maps = A.maps || []).push(this);
      this.map.on('error', (e) => console.warn('map:', e && e.error ? e.error.message : e));
      this._events();
      this._tick = this._tick.bind(this);
      this._stopTheme = A.on('theme', () => this.setBasemap(this.basemap, true));
      if (this.o.allStops) this._loadAllStops();
    }

    setBasemap(b, force) {
      if (b === this.basemap && !force) return;
      this.basemap = b;
      this.ready = false;
      this.map.setStyle(styleFor(b), { diff: false });
    }
    resize() {
      this.map.resize();
      if (this._pendingFit && this.map.getContainer().clientWidth) this.fit(...this._pendingFit);
    }

    /** Tilt into 3D with the terrain raised, or back to flat. */
    toggle3d(on) {
      this.is3d = on == null ? !this.is3d : on;
      this._terrain();
      this.map.easeTo({ pitch: this.is3d ? 62 : 0, bearing: this.is3d ? this.map.getBearing() || -18 : 0, duration: 900 });
      const b = this.map.getContainer().querySelector('.t3d');
      if (b) b.classList.toggle('on', this.is3d);
    }
    _terrain() {
      if (!this.ready) return;
      try {
        if (this.is3d) this.map.setTerrain({ source: 'akl-terrain', exaggeration: 1.4 });
        else this.map.setTerrain(null);
      } catch (e) { /* style still settling */ }
    }

    _install() {
      const m = this.map;
      const dark = A.isDark();
      if (!m.hasImage('akl-arrow')) m.addImage('akl-arrow', arrowImg(), { pixelRatio: 2 });
      for (const code of Object.keys(A.fleet.OPERATORS).concat(['XX'])) {
        if (!m.hasImage('bus-' + code)) m.addImage('bus-' + code, busImg(A.fleet.color(code)), { pixelRatio: 2 });
      }
      A.NET.lineColors.forEach((c, i) => { if (!m.hasImage('train-' + i)) m.addImage('train-' + i, trainImg(c), { pixelRatio: 2 }); });
      if (!m.hasImage('train-x')) m.addImage('train-x', trainImg('#56647E'), { pixelRatio: 2 });
      for (const [k, c] of [['bus', '#235EA8'], ['train', '#1A2744'], ['ferry', '#0A8F8F']]) if (!m.hasImage('stop-' + k)) m.addImage('stop-' + k, stopImg(c), { pixelRatio: 2 });
      if (!m.getSource('akl-terrain')) m.addSource('akl-terrain', TERRAIN);
      // streets style: its own 3D buildings are there; add a soft hillshade from the terrain
      if (this.basemap === 'streets' && !m.getLayer('akl-hillshade')) {
        const before = (m.getStyle().layers.find((l) => l.type === 'symbol') || {}).id;
        m.addLayer({ id: 'akl-hillshade', type: 'hillshade', source: 'akl-terrain',
          paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': dark ? '#000000' : '#5a6b7f', 'hillshade-highlight-color': dark ? '#2a3a55' : '#ffffff' } }, before);
      }
      try {
        if (m.setSky) m.setSky(dark
          ? { 'sky-color': '#0b1a33', 'horizon-color': '#1f3558', 'fog-color': '#0b1628', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.4, 'atmosphere-blend': 0.6 }
          : { 'sky-color': '#7fb4ef', 'horizon-color': '#e4f1ff', 'fog-color': '#dfeaf7', 'sky-horizon-blend': 0.55, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.35, 'atmosphere-blend': 0.8 });
      } catch (e) { /* older MapLibre */ }

      for (const id of ['akl-lines', 'akl-stops', 'crowd', 'jny', 'akl-allstops']) if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: empty() });
      const zoom = ['zoom'];
      // every stop in Auckland (off until a screen wants them)
      m.addLayer({ id: 'allstops', type: 'symbol', source: 'akl-allstops', minzoom: 14.2,
        layout: { 'icon-image': ['match', ['get', 'k'], 'train', 'stop-train', 'ferry', 'stop-ferry', 'stop-bus'],
                  'icon-size': ['interpolate', ['linear'], zoom, 14.2, 0.55, 17, 0.9], 'icon-allow-overlap': true,
                  'text-field': ['step', zoom, '', 16.2, ['concat', ['get', 'code'], ' ', ['get', 'name']]], 'text-font': FONT_R, 'text-size': 11,
                  'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 9 },
        paint: { 'text-color': this.basemap === 'streets' && !dark ? '#1A2744' : '#ffffff', 'text-halo-color': this.basemap === 'streets' && !dark ? 'rgba(255,255,255,0.9)' : 'rgba(8,14,26,0.85)', 'text-halo-width': 1.4 } });

      // routes and their stops
      m.addLayer({ id: 'akl-lines-case', type: 'line', source: 'akl-lines', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0B1628', 'line-opacity': 0.55, 'line-width': ['+', ['get', 'width'], 3], 'line-offset': ['get', 'offset'] } });
      m.addLayer({ id: 'akl-lines', type: 'line', source: 'akl-lines', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-offset': ['get', 'offset'] } });
      m.addLayer({ id: 'akl-stops', type: 'circle', source: 'akl-stops',
        paint: { 'circle-color': '#FFFFFF', 'circle-stroke-color': ['get', 'color'],
                 'circle-radius': ['interpolate', ['linear'], zoom, 10, ['case', ['get', 'big'], 7, 2.6], 14, ['case', ['get', 'big'], 8, 4.4]],
                 'circle-stroke-width': ['case', ['get', 'big'], 4, 2] } });
      m.addLayer({ id: 'akl-stop-labels', type: 'symbol', source: 'akl-stops', filter: ['has', 'label'],
        layout: { 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 12, 'text-anchor': 'left', 'text-offset': [0.9, 0], 'text-optional': true },
        paint: { 'text-color': '#1A2744', 'text-halo-color': 'rgba(255,255,255,0.92)', 'text-halo-width': 2.2 } });

      // a journey: walks dotted, rides bold along the real route
      m.addLayer({ id: 'jny-walk', type: 'line', source: 'jny', filter: ['==', ['get', 'k'], 'walk'], layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], zoom, 11, 3, 16, 6], 'line-dasharray': [0.1, 1.9] } });
      m.addLayer({ id: 'jny-ride-case', type: 'line', source: 'jny', filter: ['==', ['get', 'k'], 'ride'], layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0B1628', 'line-opacity': 0.7, 'line-width': ['interpolate', ['linear'], zoom, 10, 7, 16, 14] } });
      m.addLayer({ id: 'jny-ride', type: 'line', source: 'jny', filter: ['==', ['get', 'k'], 'ride'], layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'c'], 'line-width': ['interpolate', ['linear'], zoom, 10, 4.5, 16, 9] } });
      m.addLayer({ id: 'jny-mid', type: 'circle', source: 'jny', filter: ['==', ['get', 'k'], 'mid'], minzoom: 12.5,
        paint: { 'circle-radius': 3.2, 'circle-color': '#ffffff', 'circle-stroke-color': ['get', 'c'], 'circle-stroke-width': 1.6 } });
      m.addLayer({ id: 'jny-stop', type: 'circle', source: 'jny', filter: ['==', ['get', 'k'], 'stop'],
        paint: { 'circle-radius': 7.5, 'circle-color': '#ffffff', 'circle-stroke-color': ['get', 'c'], 'circle-stroke-width': 4 } });
      m.addLayer({ id: 'jny-stop-label', type: 'symbol', source: 'jny', filter: ['==', ['get', 'k'], 'stop'],
        layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 12.5, 'text-anchor': 'left', 'text-offset': [1.1, 0], 'text-optional': true, 'text-max-width': 12 },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(8,14,26,0.9)', 'text-halo-width': 2 } });

      // the crowd of vehicles
      const big = ['==', ['get', 'k'], 'train'];
      const iconic = ['match', ['get', 'k'], ['bus', 'train'], true, false];
      m.addLayer({ id: 'crowd-sel', type: 'circle', source: 'crowd', filter: ['==', ['get', 'id'], ''],
        paint: { 'circle-color': ['get', 'c'], 'circle-opacity': 0.3, 'circle-radius': 18 } });
      m.addLayer({ id: 'crowd-dots', type: 'circle', source: 'crowd',
        paint: {
          'circle-color': ['get', 'c'],
          'circle-radius': ['interpolate', ['linear'], zoom, 9, ['case', big, 4, 2.4], 11, ['case', big, 5, 3.4], 13, ['case', big, 7, 5], 15, ['case', big, 9, 7.5]],
          'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': ['interpolate', ['linear'], zoom, 9, 0.6, 13, 1.6],
          'circle-opacity': ['step', zoom, 1, 14.6, ['case', iconic, 0, 1]],
          'circle-stroke-opacity': ['step', zoom, 1, 14.6, ['case', iconic, 0, 1]],
        } });
      m.addLayer({ id: 'crowd-arrows', type: 'symbol', source: 'crowd', minzoom: 12, filter: ['has', 'b'],
        layout: { 'icon-image': 'akl-arrow', 'icon-rotate': ['get', 'b'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
                  'icon-size': ['interpolate', ['linear'], zoom, 12, 0.6, 15, ['case', big, 1.2, 1]] },
        paint: { 'icon-opacity': ['step', zoom, 1, 14.6, ['case', iconic, 0, 1]] } });
      m.addLayer({ id: 'crowd-icons', type: 'symbol', source: 'crowd', minzoom: 14.6, filter: iconic,
        layout: { 'icon-image': ['case', big, ['concat', 'train-', ['coalesce', ['get', 'li'], 'x']], ['concat', 'bus-', ['get', 'op']]],
                  'icon-rotate': ['coalesce', ['get', 'b'], 0], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
                  'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], zoom, 14.6, 0.75, 18, 1.6] } });
      m.addLayer({ id: 'crowd-labels', type: 'symbol', source: 'crowd', minzoom: 13.2, filter: ['has', 'r'],
        layout: { 'text-field': ['get', 'r'], 'text-font': FONT, 'text-size': 11.5, 'text-anchor': 'bottom', 'text-offset': [0, -1.1], 'text-optional': true, 'text-padding': 1 },
        paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#0B1628', 'text-halo-width': 1.8 } });

      this.ready = true;
      this._terrain();
      this.setLines(this.data.lines);
      this.setStops(this.data.stops);
      this._pushAllStops();
      this._pushJourney();
      this._pushCrowd(performance.now());
      this._applySel();
      if (this.o.onReady) this.o.onReady(this);
    }

    // ---------- every stop ----------
    async _loadAllStops() {
      if (!A._allStopsP) A._allStopsP = A.gtfs.allStops();
      const list = await A._allStopsP;
      this.data.allStops = { type: 'FeatureCollection', features: (list || []).filter((s) => s[6] === 0 || s[5] & 6).map((s) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [s[4], s[3]] },
        properties: { id: s[0], code: s[1], name: s[2], k: s[5] & 2 ? 'train' : s[5] & 4 ? 'ferry' : 'bus' },
      })) };
      this._pushAllStops();
    }
    _pushAllStops() {
      const src = this.ready && this.data.allStops && this.map.getSource('akl-allstops');
      if (src) src.setData(this.data.allStops);
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

    /**
     * A journey (from the planner): its walks, rides, stops, and start/end pins.
     * walks: optional { legIndex: [[lon, lat], ...] } real walking paths.
     */
    setJourney(it, walks, fit) {
      this.data.journey = it ? { it, walks: walks || {} } : null;
      this._pushJourney();
      this.pins.forEach((p) => p.remove());
      this.pins = [];
      if (!it) return;
      const first = it.legs[0].from, last = it.legs[it.legs.length - 1].to;
      for (const [p, cls, text] of [[first, 'start', 'A'], [last, 'end', 'B']]) {
        const el = A.el(`<div class="pin ${cls}"><b>${text}</b></div>`);
        this.pins.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(this.map));
      }
      if (fit !== false) {
        const pts = [];
        it.legs.forEach((l, i) => (l.mode === 'walk' ? (walks && walks[i]) || [[l.from.lon, l.from.lat], [l.to.lon, l.to.lat]] : l.shape).forEach((c) => pts.push(c)));
        this.fit(pts, this.o.journeyPad || 70, 16);
      }
    }
    _pushJourney() {
      const src = this.ready && this.map.getSource('jny');
      if (!src) return;
      const j = this.data.journey;
      if (!j) { src.setData(empty()); return; }
      const f = [];
      j.it.legs.forEach((l, i) => {
        if (l.mode === 'walk') {
          f.push({ type: 'Feature', properties: { k: 'walk' }, geometry: { type: 'LineString', coordinates: j.walks[i] || [[l.from.lon, l.from.lat], [l.to.lon, l.to.lat]] } });
          return;
        }
        const c = A.legColor(l);
        f.push({ type: 'Feature', properties: { k: 'ride', c }, geometry: { type: 'LineString', coordinates: l.shape } });
        l.stops.forEach((s, k) => {
          const end = k === 0 || k === l.stops.length - 1;
          f.push({ type: 'Feature', properties: { k: end ? 'stop' : 'mid', c, name: end ? `${s.name}${s.code ? ' · ' + s.code : ''}` : '' },
                   geometry: { type: 'Point', coordinates: [s.lon, s.lat] } });
        });
      });
      src.setData({ type: 'FeatureCollection', features: f });
    }

    /** The crowd: [{ id, lon, lat, bearing, color, op, kind: bus|train|ferry, label, li }]. Glides to new fixes. */
    setCrowd(list) {
      const now = performance.now();
      const seen = new Set();
      for (const d of list) {
        seen.add(d.id);
        const g = this.glides.get(d.id);
        if (!g) { this.glides.set(d.id, { fx: d.lon, fy: d.lat, tx: d.lon, ty: d.lat }); continue; }
        if (g.tx === d.lon && g.ty === d.lat) continue;
        const [cx, cy] = this._at(g, now);
        const far = Math.hypot(cx - d.lon, (cy - d.lat) * 1.25) > 0.02;
        g.fx = far ? d.lon : cx; g.fy = far ? d.lat : cy; g.tx = d.lon; g.ty = d.lat;
      }
      for (const id of Array.from(this.glides.keys())) if (!seen.has(id)) this.glides.delete(id);
      this.data.crowd = list;
      this.crowdStart = now;
      this._pushCrowd(now);
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
        if (d.li != null && d.li >= 0) p.li = String(d.li);
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: p };
      }) });
    }

    /** A few special vehicles as HTML markers with a tag: [{ id, lon, lat, bearing, color, tag, kind }] */
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
        m.el.classList.toggle('train', d.kind === 'train');
        m.el.querySelector('.vbus').style.transform = `rotate(${d.bearing || 0}deg)`;
        const tag = m.el.querySelector('.vtag');
        tag.innerHTML = d.tag || '';
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
    posOf(id) {
      const g = this.glides.get(id);
      if (g) return this._at(g, performance.now());
      const m = this.marks.get(id);
      return m ? this._markAt(m, performance.now()) : null;
    }

    _kick() { if (!this._running) { this._running = true; requestAnimationFrame(this._tick); } }
    _tick() {
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
      // a hidden map has no size to fit into: do it when it's shown (see resize)
      if (!this.map.getContainer().clientWidth) { this._pendingFit = [points, pad, maxZoom]; return; }
      this._pendingFit = null;
      const b = new maplibregl.LngLatBounds(points[0], points[0]);
      points.forEach((p) => b.extend(p));
      const opts = { padding: pad == null ? 48 : pad, maxZoom: maxZoom || 15.5, duration: this._fitted ? 800 : 0 };
      try {
        this.map.fitBounds(b, Object.assign({ bearing: this.map.getBearing(), pitch: this.map.getPitch() }, opts));
      } catch (e) {
        try { this.map.fitBounds(b, opts); } catch (e2) { this.map.jumpTo({ center: b.getCenter(), zoom: 12 }); }
      }
      this._fitted = true;
    }
    flyTo(lon, lat, zoom) { this.map.flyTo({ center: [lon, lat], zoom: Math.max(this.map.getZoom(), zoom || 14.5), speed: 1.6 }); }

    _events() {
      const m = this.map;
      const pickable = () => ['crowd-icons', 'crowd-dots', 'akl-stops', 'allstops', 'jny-stop'].filter((l) => m.getLayer(l));
      const nearest = (pt) => {
        const r = 10;
        const hits = this.ready ? m.queryRenderedFeatures([[pt.x - r, pt.y - r], [pt.x + r, pt.y + r]], { layers: pickable() }) : [];
        let best = null, bd = Infinity;
        for (const f of hits) {
          if (f.layer.id === 'allstops' && m.getZoom() < 14.2) continue;
          const c = m.project(f.geometry.coordinates);
          const pri = f.layer.id.startsWith('crowd') ? 0 : f.layer.id === 'akl-stops' || f.layer.id === 'jny-stop' ? 4 : 8;
          const d = Math.hypot(c.x - pt.x, c.y - pt.y) + pri;
          if (d < bd) { bd = d; best = f; }
        }
        return best;
      };
      m.on('click', (e) => {
        const f = nearest(e.point);
        const pick = (p) => this.o.onPick && this.o.onPick(p);
        if (!f) { if (this.o.onBackground) this.o.onBackground(e.lngLat); return; }
        if (f.layer.id === 'akl-stops') { if (f.properties.id) pick({ kind: 'stop', id: f.properties.id }); }
        else if (f.layer.id === 'allstops') pick({ kind: 'anystop', id: f.properties.id, code: f.properties.code, name: f.properties.name });
        else if (f.layer.id === 'jny-stop') pick({ kind: 'jstop', name: f.properties.name });
        else pick({ kind: 'vehicle', id: f.properties.id });
      });
      m.on('contextmenu', (e) => { if (this.o.onContext) this.o.onContext(e.lngLat, e.point); });
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
      m.on('dragstart', () => { if (this.follow) { this.follow = false; if (this.o.onUnfollow) this.o.onUnfollow(); } });
    }

    destroy() { this._stopTheme(); this.pins.forEach((p) => p.remove()); this.map.remove(); }
  };

  /** A ride's colour: train line colours, ferry teal, buses by direction of travel on AT blue. */
  A.legColor = function (l) {
    if (l.mode === 'train') {
      const code = (l.route && l.route.id) ? l.route.id.slice(0, l.route.id.lastIndexOf('-')) : '';
      const li = A.NET.lineIds.indexOf(code);
      return li >= 0 ? A.NET.lineColors[li] : A.MODE_COLOR.train;
    }
    if (l.mode === 'ferry') return A.MODE_COLOR.ferry;
    return A.MODE_COLOR.bus;
  };
})(window.AKL);
