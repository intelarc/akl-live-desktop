// The post-CRL network diagram, drawn live: scroll to zoom, drag to pan,
// hover for names, click a train or a station.
(function (A) {
  'use strict';
  const NET = A.NET;
  const MID_X = 160, MID_Y = 130;

  const LIGHT = {
    water: '#CDE1F3', land: '#FAFBFD', cone: '#E6EBF2', text: '#1A2744', minor: '#46546E',
    halo: 'rgba(250,251,253,0.88)', fill: '#FFFFFF', ring: '#1A2744', crl: 'rgba(255,206,102,0.4)', rim: '#14203A',
  };
  const DARK = {
    water: '#0B1628', land: '#16233A', cone: '#1E2E4A', text: '#E6ECF7', minor: '#AAB7CD',
    halo: 'rgba(22,35,58,0.82)', fill: '#E9EEF6', ring: '#0B1628', crl: 'rgba(255,209,102,0.18)', rim: '#050A14',
  };

  function trace(ctx, pts, close) {
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    if (close) ctx.closePath();
  }
  function stationCentre(s) {
    let x = 0, y = 0;
    for (let i = 0; i < s.pts.length; i += 2) { x += s.pts[i]; y += s.pts[i + 1]; }
    return [x / (s.pts.length / 2), y / (s.pts.length / 2)];
  }
  const CENTRES = NET.stations.map(stationCentre);

  A.TrainMap = class {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.opts = opts || {};
      this.zoom = 1; this.pan = { x: 0, y: 0 };
      this.filter = new Set([0, 1, 2]);
      this.data = { list: [], before: {}, heading: {}, movedAt: 0 };
      this.selTrain = null; this.selStation = null; this.hover = null;
      this.active = false;
      this.t0 = performance.now();
      this._bind();
    }

    setData(d) { this.data = d; }
    setFilter(set) { this.filter = new Set(set); }
    select(train, station) { this.selTrain = train; this.selStation = station; }

    start() { if (!this.active) { this.active = true; this._frame(); } }
    stop() { this.active = false; }

    /** Map units -> screen pixels for the current zoom and pan. */
    _view() {
      const { w, h } = this.size || { w: 1, h: 1 };
      const base = Math.min(w / 330, h / 228);
      const s = base * this.zoom;
      const cx = w / 2 + this.pan.x, cy = h / 2 + this.pan.y;
      return { s, ox: cx - MID_X * s, oy: cy - MID_Y * s, pt: (x, y) => [cx + (x - MID_X) * s, cy + (y - MID_Y) * s] };
    }

    trainPos(t, g) {
      const b = this.data.before[t.v.id];
      return b ? [b[0] + (t.x - b[0]) * g, b[1] + (t.y - b[1]) * g] : [t.x, t.y];
    }

    _zoomAt(px, py, k) {
      const { w, h } = this.size;
      const nz = Math.min(12, Math.max(1, this.zoom * k));
      k = nz / this.zoom;
      const c0x = w / 2, c0y = h / 2;
      this.pan.x = (px - c0x) - (px - c0x - this.pan.x) * k;
      this.pan.y = (py - c0y) - (py - c0y - this.pan.y) * k;
      this.zoom = nz;
      this._clamp();
    }
    _clamp() {
      const { w, h } = this.size;
      const lx = w * this.zoom / 2, ly = h * this.zoom / 2;
      this.pan.x = Math.min(lx, Math.max(-lx, this.pan.x));
      this.pan.y = Math.min(ly, Math.max(-ly, this.pan.y));
      if (this.zoom === 1) { this.pan.x = 0; this.pan.y = 0; }
    }
    reset() { this.zoom = 1; this.pan = { x: 0, y: 0 }; }
    zoomBy(k) { this._zoomAt(this.size.w / 2, this.size.h / 2, k); }
    /** Centre the map on a station or train position (map units). */
    focus(x, y, zoom) {
      this.zoom = zoom || Math.max(this.zoom, 3);
      const s = Math.min(this.size.w / 330, this.size.h / 228) * this.zoom;
      this.pan = { x: -(x - MID_X) * s, y: -(y - MID_Y) * s };
      this._clamp();
    }

    _hit(px, py) {
      const v = this._view();
      const g = A.glide(this.data.movedAt, performance.now());
      let best = null, bd = 22;
      for (const t of this.data.list) {
        if (!this.filter.has(t.line)) continue;
        const [mx, my] = this.trainPos(t, g);
        const [sx, sy] = v.pt(mx, my);
        const d = Math.hypot(sx - px, sy - py);
        if (d < bd) { bd = d; best = { kind: 'train', id: t.v.id, x: sx, y: sy }; }
      }
      if (best) return best;
      bd = 16;
      NET.stations.forEach((s, i) => {
        const [sx, sy] = v.pt(CENTRES[i][0], CENTRES[i][1]);
        const d = Math.hypot(sx - px, sy - py);
        if (d < bd) { bd = d; best = { kind: 'station', id: i, x: sx, y: sy }; }
      });
      return best;
    }

    _bind() {
      const c = this.canvas;
      let drag = null, moved = false;
      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        this._zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0018));
      }, { passive: false });
      c.addEventListener('pointerdown', (e) => {
        drag = { x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y };
        moved = false;
        c.setPointerCapture(e.pointerId);
      });
      c.addEventListener('pointermove', (e) => {
        const r = c.getBoundingClientRect();
        if (drag) {
          const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
          if (moved && this.zoom > 1) {
            this.pan.x = drag.px + dx; this.pan.y = drag.py + dy; this._clamp();
            c.style.cursor = 'grabbing';
          }
          return;
        }
        const hit = this._hit(e.clientX - r.left, e.clientY - r.top);
        this.hover = hit;
        c.style.cursor = hit ? 'pointer' : (this.zoom > 1 ? 'grab' : 'default');
        if (this.opts.onHover) this.opts.onHover(hit, e.clientX - r.left, e.clientY - r.top);
      });
      c.addEventListener('pointerup', (e) => {
        const wasDrag = moved;
        drag = null;
        c.style.cursor = this.zoom > 1 ? 'grab' : 'default';
        if (wasDrag) return;
        const r = c.getBoundingClientRect();
        const hit = this._hit(e.clientX - r.left, e.clientY - r.top);
        if (hit && hit.kind === 'train' && this.opts.onTrain) this.opts.onTrain(hit.id);
        else if (hit && hit.kind === 'station' && this.opts.onStation) this.opts.onStation(hit.id);
        else if (this.opts.onNothing) this.opts.onNothing();
      });
      c.addEventListener('pointerleave', () => { this.hover = null; if (this.opts.onHover) this.opts.onHover(null); });
      c.addEventListener('dblclick', (e) => {
        const r = c.getBoundingClientRect();
        if (this.zoom >= 11) this.reset(); else this._zoomAt(e.clientX - r.left, e.clientY - r.top, e.shiftKey ? 0.5 : 2);
      });
    }

    _frame() {
      if (!this.active) return;
      this.draw();
      requestAnimationFrame(() => this._frame());
    }

    draw() {
      const { ctx, w, h } = A.fitCanvas(this.canvas);
      if (w < 2 || h < 2) return;
      this.size = { w, h };
      const pal = A.isDark() ? DARK : LIGHT;
      const now = (performance.now() - this.t0) / 1000;
      const v = this._view();

      ctx.fillStyle = pal.water; ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(v.ox, v.oy); ctx.scale(v.s, v.s);
      ctx.fillStyle = pal.land;
      for (const p of NET.land) { ctx.beginPath(); trace(ctx, p, true); ctx.fill(); }
      const r = NET.landRound;
      ctx.beginPath(); ctx.roundRect(r[0], r[1], r[2] - r[0], r[3] - r[1], r[4]); ctx.fill();
      ctx.fillStyle = pal.water;
      for (const p of NET.water) { ctx.beginPath(); trace(ctx, p, true); ctx.fill(); }
      ctx.fillStyle = pal.cone;
      const cones = NET.cones;
      for (let i = 0; i < cones.length; i += 3) { ctx.beginPath(); ctx.arc(cones[i], cones[i + 1], cones[i + 2], 0, 7); ctx.fill(); }
      // the City Rail Link tunnels glow
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = pal.crl; ctx.lineWidth = 11;
      ctx.beginPath(); trace(ctx, NET.crlLoop); ctx.stroke();
      // lines: E-W, O-W, then S-C on top (as on AT's map); filtered-out lines fade
      for (const li of [0, 2, 1]) {
        ctx.globalAlpha = this.filter.has(li) ? 1 : 0.16;
        ctx.strokeStyle = NET.lineColors[li]; ctx.lineWidth = 3.6;
        ctx.beginPath(); trace(ctx, NET.lineDraw[li]); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // stations: white pills across interchanges, rings elsewhere
      for (const s of NET.stations) {
        if (s.pts.length > 2 || s.crl) {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (let i = 0; i < s.pts.length; i += 2) {
            x0 = Math.min(x0, s.pts[i]); x1 = Math.max(x1, s.pts[i]);
            y0 = Math.min(y0, s.pts[i + 1]); y1 = Math.max(y1, s.pts[i + 1]);
          }
          const rr = 2.9;
          ctx.beginPath(); ctx.roundRect(x0 - rr, y0 - rr, x1 - x0 + 2 * rr, y1 - y0 + 2 * rr, rr);
          ctx.fillStyle = pal.fill; ctx.fill(); ctx.strokeStyle = pal.ring; ctx.lineWidth = 0.9; ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(s.pts[0], s.pts[1], 1.9, 0, 7);
          ctx.fillStyle = pal.fill; ctx.fill(); ctx.strokeStyle = pal.ring; ctx.lineWidth = 0.7; ctx.stroke();
        }
      }
      ctx.restore();

      // a selected or hovered station gets a pulsing ring
      const ring = (i, strong) => {
        const [x, y] = v.pt(CENTRES[i][0], CENTRES[i][1]);
        const p = 0.5 + 0.5 * Math.sin(now * 4);
        if (strong) {
          ctx.fillStyle = `rgba(35,94,168,${0.22 + 0.22 * p})`;
          ctx.beginPath(); ctx.arc(x, y, 14 + 6 * p, 0, 7); ctx.fill();
        }
        ctx.strokeStyle = A.pal.atBlue; ctx.lineWidth = strong ? 2.5 : 2;
        ctx.beginPath(); ctx.arc(x, y, strong ? 11 : 9, 0, 7); ctx.stroke();
      };
      if (this.hover && this.hover.kind === 'station' && this.hover.id !== this.selStation) ring(this.hover.id, false);
      if (this.selStation != null) ring(this.selStation, true);

      this._labels(ctx, v, pal, w, h);

      // trains
      const g = A.glide(this.data.movedAt, performance.now());
      const list = this.data.list.filter((t) => this.filter.has(t.line))
        .sort((a, b) => (a.v.id === this.selTrain) - (b.v.id === this.selTrain) || (a.line === 1) - (b.line === 1));
      for (const t of list) {
        const [mx, my] = this.trainPos(t, g);
        const [x, y] = v.pt(mx, my);
        if (x < -30 || y < -30 || x > w + 30 || y > h + 30) continue;
        const col = NET.lineColors[t.line];
        const sel = t.v.id === this.selTrain;
        const hov = this.hover && this.hover.kind === 'train' && this.hover.id === t.v.id;
        const rad = sel ? 11 : hov ? 9.5 : 8;
        if (sel) {
          const p = 0.5 + 0.5 * Math.sin(now * 4);
          ctx.globalAlpha = 0.18 + 0.2 * p; ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(x, y, rad + 8 + 6 * p, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
        }
        const hd = this.data.heading[t.v.id];
        if (hd != null) {
          ctx.save(); ctx.translate(x, y); ctx.rotate(hd); ctx.translate(rad - 1, 0);
          ctx.beginPath(); ctx.moveTo(0, -4.5); ctx.lineTo(6.5, 0); ctx.lineTo(0, 4.5); ctx.closePath();
          ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = pal.rim; ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; ctx.stroke();
          ctx.restore();
        }
        ctx.fillStyle = pal.rim; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
        ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(x, y, rad - 1.6, 0, 7); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, rad - 3.6, 0, 7); ctx.fill();
        const d = t.delay || 0;
        if (d >= 120) {                                   // running late: a warning dot
          const qx = x + rad * 0.72, qy = y - rad * 0.72;
          ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(qx, qy, 3.8, 0, 7); ctx.fill();
          ctx.fillStyle = d >= 300 ? A.pal.late : A.pal.warn; ctx.beginPath(); ctx.arc(qx, qy, 2.8, 0, 7); ctx.fill();
        }
      }
    }

    /** Station names at constant size, most important first, never overlapping. */
    _labels(ctx, v, pal, w, h) {
      const placed = [];
      const order = NET.stations.map((_, i) => i).sort((a, b) =>
        (NET.stations[a].priority - NET.stations[b].priority) || ((NET.stations[b].crl ? 1 : 0) - (NET.stations[a].crl ? 1 : 0)));
      ctx.textBaseline = 'middle';
      for (const i of order) {
        const s = NET.stations[i];
        if (s.priority === 2 && this.zoom < 1.8 && this.selStation !== i) continue;
        if (s.priority === 1 && this.zoom < 1.25 && this.selStation !== i) continue;
        const size = s.priority === 2 ? 11 : 12.5;
        ctx.font = `${s.crl ? 700 : s.priority === 0 ? 600 : 400} ${size}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`;
        const tw = ctx.measureText(s.name).width, th = size + 3;
        const [px, py] = v.pt(CENTRES[i][0], CENTRES[i][1]);
        const dx = s.dx * 1.15, dy = s.dy * 1.15;
        let x, y;
        switch (s.anchor) {
          case 'l': x = px + dx; y = py + dy - th / 2; break;
          case 'r': x = px + dx - tw; y = py + dy - th / 2; break;
          case 't': x = px + dx - tw / 2; y = py + dy; break;
          default: x = px + dx - tw / 2; y = py + dy - th;
        }
        const box = [x - 4, y - 1, x + tw + 4, y + th + 1];
        if (box[2] < 0 || box[0] > w || box[3] < 0 || box[1] > h) continue;
        if (placed.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) continue;
        placed.push(box);
        ctx.fillStyle = pal.halo; ctx.beginPath(); ctx.roundRect(box[0], box[1], box[2] - box[0], box[3] - box[1], 5); ctx.fill();
        ctx.fillStyle = s.priority === 2 ? pal.minor : pal.text;
        ctx.fillText(s.name, x, y + th / 2 + 0.5);
      }
    }
  };
})(window.AKL);
