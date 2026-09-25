// The animated bus scenes and the bus drawings (the same art as the phone app).
(function (A) {
  'use strict';

  // ---------- colours ----------
  const C = (hex, a) => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16), a: a == null ? 1 : a });
  const mix = (x, y, f) => ({ r: x.r + (y.r - x.r) * f, g: x.g + (y.g - x.g) * f, b: x.b + (y.b - x.b) * f, a: x.a + (y.a - x.a) * f });
  const css = (c, a) => `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${a == null ? c.a : a})`;
  const WHITE = C('#FFFFFF'), BLACK = C('#000000');
  A.color = { C, mix, css };

  // seeded randomness, so each lane's scenery stays put
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** The fixed scenery for one lane: built once, drawn every frame. */
  A.Scenery = function (city, seed) {
    const r = rng(seed * 7919 + 17);
    this.city = city;
    this.stars = Array.from({ length: 90 }, () => [r(), r() * 0.62, r() * 6.28]);
    this.clouds = Array.from({ length: 6 }, () => [r(), 0.08 + r() * 0.28, 0.7 + r() * 0.6, 6 + r() * 10]);
    this.drops = Array.from({ length: 160 }, () => [r(), r(), r()]);
    this.buildings = []; this.houses = []; this.trees = [];
    let x = 0.01;
    if (city) {
      while (x < 0.8) {
        const w = 0.03 + r() * 0.045, h = 0.18 + r() * 0.34;
        const lit = Array.from({ length: 64 }, () => r() < 0.5);
        this.buildings.push({ x, w, h, lit });
        x += w + 0.004 + r() * 0.012;
      }
    } else {
      while (x < 0.8) {
        if (r() < 0.58) {
          const w = 0.04 + r() * 0.028;
          this.houses.push({ x, w, h: 0.09 + r() * 0.05, roof: 0.05 + r() * 0.03, lit: r() < 0.75 });
          x += w + 0.01 + r() * 0.025;
        } else {
          const rad = 0.016 + r() * 0.012;
          this.trees.push({ x: x + rad, r: rad, blossoms: Array.from({ length: 8 }, () => [r() * 6.28, r()]) });
          x += rad * 2 + 0.008 + r() * 0.02;
        }
      }
    }
  };

  // (hour, sky top, sky bottom, far hills, near scenery)
  const SKY = [
    [0, '#0A122C', '#1E2C54', '#1A2440', '#243050'],
    [5.3, '#141E46', '#464C78', '#283050', '#323C5C'],
    [6.6, '#6E96D2', '#FFC496', '#9696AA', '#78809C'],
    [8.5, '#5FA4EC', '#D2EAFC', '#9CC2A4', '#A0B0C8'],
    [16.8, '#5FA4EC', '#D6ECFC', '#9CC2A4', '#A0B0C8'],
    [18.4, '#5A6EBE', '#FFAA78', '#8C8296', '#6E6E8C'],
    [19.6, '#1E285A', '#6E5078', '#323454', '#3C3E60'],
    [21, '#0A122C', '#1E2C54', '#1A2440', '#243050'],
    [24, '#0A122C', '#1E2C54', '#1A2440', '#243050'],
  ].map(([h, a, b, c, d]) => ({ h, top: C(a), bottom: C(b), hills: C(c), near: C(d) }));

  function skyAt(hour) {
    const h = ((hour % 24) + 24) % 24;
    for (let i = 0; i < SKY.length - 1; i++) {
      const a = SKY[i], b = SKY[i + 1];
      if (h >= a.h && h <= b.h) {
        const f = (h - a.h) / (b.h - a.h);
        return { top: mix(a.top, b.top, f), bottom: mix(a.bottom, b.bottom, f), hills: mix(a.hills, b.hills, f), near: mix(a.near, b.near, f) };
      }
    }
    return SKY[0];
  }
  A.isNight = (hour) => hour < 6.3 || hour > 19.7;
  const LIT = C('#FFD98A');

  /**
   * One lane's live scene. progress 0..1 is how far along the bus is (0 = 20
   * minutes out, 1 = at the stop); null when no bus is coming soon.
   */
  A.drawScene = function (ctx, w, h, s, o) {
    const { hour, t, progress, moving, cancelled, dest, look, wx } = o;
    const dp = o.dp || 1;
    const ground = h * 0.74;
    const night = A.isNight(hour);
    // the real weather: cloud greys the sky, rain darkens it and hides the sun
    const cover = (wx ? wx.cloudCover : 30) / 100;
    const rain = wx ? wx.rain : 0;
    const gloom = Math.min(0.75, Math.min(1, Math.max(0, (cover - 0.5) / 0.5)) * 0.5 + rain * 0.2);
    const grey = C(night ? '#141922' : '#8C95A5');
    const clear = skyAt(hour);
    const sky = { top: mix(clear.top, grey, gloom), bottom: mix(clear.bottom, mix(grey, WHITE, 0.25), gloom),
                  hills: mix(clear.hills, grey, gloom * 0.5), near: mix(clear.near, grey, gloom * 0.4) };
    const sunShow = Math.min(1, Math.max(0, 1 - gloom * 1.7));

    let g = ctx.createLinearGradient(0, 0, 0, ground);
    g.addColorStop(0, css(sky.top)); g.addColorStop(1, css(sky.bottom));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, ground);

    // sun on its arc across the day, or moon and stars
    if (hour >= 6.4 && hour <= 19.6 && sunShow > 0) {
      const p = (hour - 6.4) / 13.2;
      const sx = w * (0.08 + 0.84 * p), sy = ground - Math.sin(p * Math.PI) * ground * 0.78;
      const sun = mix(C('#FFF4D6'), C('#FFB066'), 1 - Math.sin(p * Math.PI));
      g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 50 * dp);
      g.addColorStop(0, css(sun, 0.55 * sunShow)); g.addColorStop(1, css(sun, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, 50 * dp, 0, 7); ctx.fill();
      ctx.fillStyle = css(sun, sunShow); ctx.beginPath(); ctx.arc(sx, sy, 14 * dp, 0, 7); ctx.fill();
    }
    if (night && sunShow > 0) {
      s.stars.forEach(([x, y, ph], i) => {
        const a = (0.45 + 0.45 * Math.sin(t * (0.8 + (i % 5) * 0.3) + ph)) * Math.max(0, 1 - cover);
        ctx.fillStyle = css(WHITE, a); ctx.beginPath(); ctx.arc(x * w, y * ground, (i % 7 === 0 ? 1.4 : 0.9) * dp, 0, 7); ctx.fill();
      });
      const mx = w * 0.84, my = h * 0.2;
      g = ctx.createRadialGradient(mx, my, 0, mx, my, 34 * dp);
      g.addColorStop(0, css(C('#FFF3D0'), 0.3 * sunShow)); g.addColorStop(1, css(C('#FFF3D0'), 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx, my, 34 * dp, 0, 7); ctx.fill();
      ctx.fillStyle = css(C('#FBF3DA'), sunShow); ctx.beginPath(); ctx.arc(mx, my, 11 * dp, 0, 7); ctx.fill();
      ctx.fillStyle = css(sky.top); ctx.beginPath(); ctx.arc(mx + 5 * dp, my - 3 * dp, 10 * dp, 0, 7); ctx.fill();
    }

    // clouds drift by: as many as the real cover, grey when it's raining, dark at night
    const n = !wx ? (night ? 0 : 5) : Math.max(0, Math.min(6, Math.round(cover * 6.4)));
    const cloud = night ? css(C('#2A3246'), 0.85)
      : (rain > 0 || gloom > 0.3) ? css(mix(WHITE, C('#8E98A8'), 0.35 + gloom * 0.5), 0.95)
      : css(WHITE, hour < 7.5 || hour > 18 ? 0.7 : 0.92);
    ctx.fillStyle = cloud;
    for (const c of s.clouds.slice(0, n)) {
      const span = w + 180 * dp;
      const cx = ((c[0] * span + t * c[3] * dp) % span) - 90 * dp;
      const cy = c[1] * ground;
      const k = c[2] * dp * (1 + gloom * 0.6);
      ctx.beginPath();
      ctx.arc(cx, cy + 3 * k, 11 * k, 0, 7); ctx.arc(cx + 14 * k, cy - 2 * k, 15 * k, 0, 7); ctx.arc(cx + 30 * k, cy + 3 * k, 11 * k, 0, 7);
      ctx.fill();
      ctx.beginPath(); ctx.roundRect(cx - 4 * k, cy + 2 * k, 40 * k, 12 * k, 6 * k); ctx.fill();
    }

    // far hills (the Waitākeres, more or less)
    ctx.fillStyle = css(sky.hills);
    ctx.beginPath(); ctx.moveTo(0, ground);
    for (let x = 0; x <= w + 8; x += 6) {
      const f = x / w;
      ctx.lineTo(x, ground - h * (0.16 + 0.06 * Math.sin(f * 9.3 + 1.3) + 0.03 * Math.sin(f * 23)));
    }
    ctx.lineTo(w, ground); ctx.closePath(); ctx.fill();
    // a landmark: Rangitoto out past the city, Maungakiekie over the suburbs
    const haze = mix(sky.hills, sky.bottom, 0.18);
    if (s.city) rangitoto(ctx, haze, w, h, ground); else maungakiekie(ctx, haze, night, w, h, ground, dp);
    if (s.city) city(ctx, s, sky, night, t, w, h, ground, dp); else suburb(ctx, s, sky, night, w, h, ground, dp);

    if (wx && wx.foggy) {
      g = ctx.createLinearGradient(0, 0, 0, ground);
      g.addColorStop(0, css(WHITE, night ? 0.08 : 0.2)); g.addColorStop(1, css(WHITE, night ? 0.22 : 0.5));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, ground);
    }

    // road
    ctx.fillStyle = css(C('#8A919C'), night ? 0.5 : 1); ctx.fillRect(0, ground, w, 3 * dp);
    ctx.fillStyle = night ? '#22262F' : '#3B414D'; ctx.fillRect(0, ground + 3 * dp, w, h - ground - 3 * dp);
    ctx.fillStyle = night ? '#B8AC7A' : '#F0E3A8';
    const laneY = ground + (h - ground) * 0.62;
    for (let dx = 0; dx < w; dx += 34 * dp) ctx.fillRect(dx, laneY, 18 * dp, 2.2 * dp);

    const stopX = w - 42 * dp;
    busStop(ctx, stopX, ground, dp);

    if (progress != null) {
      const bh = h * 0.25, bl = bh * 2.75;
      const x0 = -bl * 0.5, x1 = stopX - bl - 8 * dp;
      const bx = x0 + (x1 - x0) * Math.min(1, Math.max(0, progress));
      A.drawBus(ctx, bx, ground + 2 * dp + (h - ground) * 0.12, bl, bh, { t, night, moving, cancelled, dest, dp, look });
    }

    // rain, falling on a slant
    if (rain > 0) {
      const count = [0, 50, 100, 160][rain];
      const len = (rain === 1 ? 6 : 11) * dp;
      ctx.strokeStyle = css(C('#D6E6FF'), rain === 1 ? 0.35 : 0.5);
      ctx.lineWidth = 1.1 * dp; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const d = s.drops[i];
        const y = ((d[1] + t * (1.1 + d[2] * 0.8)) % 1) * (h + len) - len;
        const x = d[0] * (w + 30 * dp) - y * 0.2;
        ctx.moveTo(x, y); ctx.lineTo(x - len * 0.2, y + len);
      }
      ctx.stroke();
    }
    if (wx && wx.thunder) {
      const ph = t % 9;
      if (ph < 0.1 || (ph > 0.22 && ph < 0.3)) { ctx.fillStyle = css(WHITE, 0.35); ctx.fillRect(0, 0, w, h); }
    }
  };

  function rangitoto(ctx, col, w, h, ground) {
    const base = ground - h * 0.11, rise = h * 0.2;
    const prof = [0.56, 0, 0.66, 0.3, 0.73, 0.66, 0.77, 0.9, 0.795, 1, 0.81, 0.96, 0.825, 1, 0.85, 0.9, 0.89, 0.66, 0.96, 0.3, 1.04, 0];
    ctx.fillStyle = css(col); ctx.beginPath(); ctx.moveTo(prof[0] * w, ground);
    for (let i = 0; i < prof.length; i += 2) ctx.lineTo(prof[i] * w, base - prof[i + 1] * rise);
    ctx.lineTo(prof[prof.length - 2] * w, ground); ctx.closePath(); ctx.fill();
  }

  function maungakiekie(ctx, col, night, w, h, ground, dp) {
    const cx = w * 0.36, top = ground - h * 0.33;
    ctx.fillStyle = css(col); ctx.beginPath();
    ctx.moveTo(cx - w * 0.24, ground);
    ctx.bezierCurveTo(cx - w * 0.14, ground - h * 0.12, cx - w * 0.09, top, cx, top);
    ctx.bezierCurveTo(cx + w * 0.07, top, cx + w * 0.12, ground - h * 0.16, cx + w * 0.26, ground);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(mix(col, night ? BLACK : WHITE, 0.25)); ctx.beginPath();
    ctx.moveTo(cx - 2.6 * dp, top + dp); ctx.lineTo(cx - dp, top - 22 * dp); ctx.lineTo(cx, top - 25 * dp);
    ctx.lineTo(cx + dp, top - 22 * dp); ctx.lineTo(cx + 2.6 * dp, top + dp); ctx.closePath(); ctx.fill();
  }

  function city(ctx, s, sky, night, t, w, h, ground, dp) {
    const body = css(sky.near), face = css(mix(sky.near, WHITE, 0.08));
    const unlit = css(mix(sky.near, sky.bottom, 0.35), night ? 0.6 : 0.7);
    for (const b of s.buildings) {
      const bx = b.x * w, bw = b.w * w, bh = b.h * h;
      ctx.fillStyle = body; ctx.fillRect(bx, ground - bh, bw, bh);
      ctx.fillStyle = face; ctx.fillRect(bx, ground - bh, bw * 0.35, bh);
      let i = 0;
      for (let wy = 0.06; wy < 0.92; wy += 0.12) {
        for (let wx = 0.18; wx < 0.82; wx += 0.28) {
          ctx.fillStyle = night && b.lit[i % 64] ? css(LIT) : unlit;
          ctx.fillRect(bx + wx * bw - 1.1 * dp, ground - bh + wy * bh, 2.2 * dp, 2.6 * dp);
          i++;
        }
      }
    }
    // the Sky Tower
    const tx = w * 0.43, top = ground - h * 0.66;
    ctx.fillStyle = body; ctx.beginPath();
    ctx.moveTo(tx - 5 * dp, ground); ctx.lineTo(tx - 2.2 * dp, top + 18 * dp); ctx.lineTo(tx + 2.2 * dp, top + 18 * dp); ctx.lineTo(tx + 5 * dp, ground);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.roundRect(tx - 9 * dp, top + 10 * dp, 18 * dp, 9 * dp, 4 * dp); ctx.fill();
    ctx.beginPath(); ctx.roundRect(tx - 5.5 * dp, top + 4 * dp, 11 * dp, 6 * dp, 3 * dp); ctx.fill();
    ctx.fillRect(tx - 0.9 * dp, top - 16 * dp, 1.8 * dp, 22 * dp);
    if (night) {
      ctx.fillStyle = css(LIT, 0.9); ctx.fillRect(tx - 8 * dp, top + 13.5 * dp, 16 * dp, 1.5 * dp);
      ctx.fillStyle = css(C('#FF4A4A'), Math.sin(t * 3) > 0 ? 1 : 0.25);
      ctx.beginPath(); ctx.arc(tx, top - 16 * dp, 1.8 * dp, 0, 7); ctx.fill();
    }
  }

  function suburb(ctx, s, sky, night, w, h, ground, dp) {
    const wall = mix(sky.near, WHITE, night ? 0.02 : 0.25);
    const roof = css(mix(sky.near, C('#7A2E2A'), night ? 0.2 : 0.45));
    for (const hs of s.houses) {
      const x = hs.x * w, hw = hs.w * w, hh = hs.h * h;
      ctx.fillStyle = css(wall); ctx.fillRect(x, ground - hh, hw, hh);
      ctx.fillStyle = roof; ctx.beginPath();
      ctx.moveTo(x - 2 * dp, ground - hh); ctx.lineTo(x + hw / 2, ground - hh - hs.roof * h); ctx.lineTo(x + hw + 2 * dp, ground - hh);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = night && hs.lit ? css(LIT) : css(mix(sky.bottom, WHITE, 0.3), 0.8);
      ctx.fillRect(x + hw * 0.18, ground - hh * 0.72, hw * 0.22, hh * 0.3);
      ctx.fillStyle = css(mix(wall, BLACK, 0.35)); ctx.fillRect(x + hw * 0.6, ground - hh * 0.6, hw * 0.2, hh * 0.6);
    }
    const leaf = css(mix(C('#3F7A48'), sky.near, night ? 0.75 : 0.3));
    const trunk = css(mix(C('#5A4030'), sky.near, night ? 0.7 : 0.2));
    for (const tr of s.trees) {            // pōhutukawa, in flower
      const x = tr.x * w, r = tr.r * w;
      ctx.fillStyle = trunk; ctx.fillRect(x - 1.4 * dp, ground - r * 1.2, 2.8 * dp, r * 1.2);
      ctx.fillStyle = leaf; ctx.beginPath();
      ctx.arc(x, ground - r * 1.5, r, 0, 7); ctx.arc(x - r * 0.7, ground - r * 1.1, r * 0.75, 0, 7); ctx.arc(x + r * 0.7, ground - r * 1.1, r * 0.75, 0, 7);
      ctx.fill();
      if (!night) {
        ctx.fillStyle = '#D7263D';
        for (const [a, d] of tr.blossoms) {
          ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * d * 0.9, ground - r * 1.4 + Math.sin(a) * r * d * 0.8, 1.3 * dp, 0, 7); ctx.fill();
        }
      }
    }
  }

  function busStop(ctx, x, ground, dp) {
    ctx.fillStyle = '#7E8794'; ctx.fillRect(x - 1.2 * dp, ground - 36 * dp, 2.4 * dp, 38 * dp);
    ctx.fillStyle = '#2A3346'; ctx.beginPath(); ctx.roundRect(x + 3 * dp, ground - 30 * dp, 9 * dp, 13 * dp, 1.5 * dp); ctx.fill();
    ctx.fillStyle = '#E9EEF5'; ctx.fillRect(x + 4.2 * dp, ground - 28.5 * dp, 6.6 * dp, 10 * dp);
    const cy = ground - 44 * dp;
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(x, cy, 11 * dp, 0, 7); ctx.fill();
    ctx.fillStyle = A.pal.atBlue; ctx.beginPath(); ctx.arc(x, cy, 9.2 * dp, 0, 7); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.roundRect(x - 5 * dp, cy - 4.5 * dp, 10 * dp, 7 * dp, 1.5 * dp); ctx.fill();
    ctx.fillStyle = A.pal.atBlue; ctx.fillRect(x - 3.8 * dp, cy - 3.3 * dp, 7.6 * dp, 2.6 * dp);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(x - 2.8 * dp, cy + 3.6 * dp, 1.3 * dp, 0, 7); ctx.arc(x + 2.8 * dp, cy + 3.6 * dp, 1.3 * dp, 0, 7); ctx.fill();
  }

  /** How to draw a model: single or double deck, diesel or electric, two axles or three. */
  A.lookOf = (m) => ({ doubleDeck: !!(m && m.doubleDeck), electric: !!(m && m.electric), axles: (m && m.axles) || 2 });

  /** An AT Metro bus, facing right. baseY is where the tyres meet the road; bh is one deck's height. */
  A.drawBus = function (ctx, x, baseY, bl, bh, o) {
    const { t = 0, night = false, moving = false, cancelled = false, dest = null, dp = 1 } = o;
    const look = o.look || { doubleDeck: false, electric: false, axles: 2 };
    const paint = C(cancelled ? '#8C96A5' : '#0096D6');
    const dark = css(mix(paint, BLACK, 0.35));
    const r = bh * 0.15;
    const bob = moving ? Math.sin(t * 7) * 0.5 * dp : 0;
    const deck = bh * 0.84;
    const bodyH = look.doubleDeck ? deck * 1.72 : deck;
    const top = baseY - r - bodyH + bob;
    const low = top + bodyH - deck;
    const glass = night ? '#FFE6A6' : '#CFEFFF';

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(x + bl * 0.51, baseY - r * 0.35 + r * 0.4, bl * 0.48, r * 0.4, 0, 0, 7); ctx.fill();
    if (night && !cancelled) {
      const g = ctx.createLinearGradient(x + bl, 0, x + bl + 70 * dp, 0);
      g.addColorStop(0, 'rgba(255,241,194,0.4)'); g.addColorStop(1, 'rgba(255,241,194,0)');
      ctx.fillStyle = g; ctx.beginPath();
      ctx.moveTo(x + bl, low + deck * 0.78); ctx.lineTo(x + bl + 70 * dp, baseY - 2 * dp); ctx.lineTo(x + bl + 70 * dp, low + deck * 0.47);
      ctx.closePath(); ctx.fill();
    }
    if (!look.electric && moving && !cancelled) {             // diesel exhaust, puffing out the back
      for (let k = 0; k < 3; k++) {
        const ph = (t * 0.9 + k / 3) % 1;
        ctx.fillStyle = `rgba(154,163,174,${0.32 * (1 - ph)})`;
        ctx.beginPath(); ctx.arc(x - 2 * dp - ph * 20 * dp, baseY - r * 0.9 - ph * 7 * dp, (2 + ph * 4.5) * dp, 0, 7); ctx.fill();
      }
    }
    const g = ctx.createLinearGradient(0, top, 0, top + bodyH);
    g.addColorStop(0, css(mix(paint, WHITE, 0.16))); g.addColorStop(0.5, css(paint)); g.addColorStop(1, css(mix(paint, BLACK, 0.1)));
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x, top, bl, bodyH, bh * 0.12); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.roundRect(x + bh * 0.05, top, bl - bh * 0.1, bh * 0.08, bh * 0.06); ctx.fill();
    ctx.fillStyle = dark; ctx.fillRect(x, low + deck * 0.786, bl, deck * 0.167);

    const paneW = bl * 0.12;
    const decks = look.doubleDeck ? [[top + deck * 0.06, true], [low, false]] : [[low, false]];
    for (const [dy, upper] of decks) {
      const wy = dy + deck * 0.18, wh = deck * (upper ? 0.46 : 0.405);
      for (let i = 0; i < (upper ? 6 : 5); i++) {
        if (!upper && i === 4) continue;                    // the rear door goes here
        const px = x + bl * 0.05 + i * (paneW + bl * 0.02);
        const pw = upper && i === 5 ? bl * 0.2 : paneW;
        ctx.fillStyle = glass; ctx.beginPath(); ctx.roundRect(px, wy, pw, wh, 2.5 * dp); ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${night ? 0.1 : 0.45})`; ctx.fillRect(px + paneW * 0.12, wy + 2 * dp, paneW * 0.18, Math.max(0, wh - 4 * dp));
      }
    }
    const wy = low + deck * 0.18;
    for (const dxf of [0.05 + 4 * 0.14, 0.74]) {             // doors
      const dxp = x + bl * dxf;
      ctx.fillStyle = dark; ctx.beginPath(); ctx.roundRect(dxp, wy - dp, bl * 0.085, deck * 0.74, 2 * dp); ctx.fill();
      ctx.fillStyle = glass; ctx.globalAlpha = 0.8; ctx.fillRect(dxp + 2 * dp, wy + dp, bl * 0.085 - 4 * dp, deck * 0.33); ctx.globalAlpha = 1;
    }
    ctx.fillStyle = glass; ctx.beginPath(); ctx.roundRect(x + bl * 0.855, low + deck * 0.155, bl * 0.13, deck * 0.55, 4 * dp); ctx.fill();
    const signY = look.doubleDeck ? low - deck * 0.02 : top + bh * 0.02;
    ctx.fillStyle = '#111418'; ctx.beginPath(); ctx.roundRect(x + bl * 0.84, signY, bl * 0.15, bh * 0.1, 1.5 * dp); ctx.fill();
    if (dest) {
      ctx.fillStyle = '#FFB02E';
      ctx.font = `bold ${Math.max(6, bh * 0.085)}px Consolas, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(dest, x + bl * 0.915, signY + bh * 0.052);
    }
    ctx.fillStyle = '#FFF4C8'; ctx.beginPath(); ctx.roundRect(x + bl - 6 * dp, low + deck * 0.738, 5 * dp, 3 * dp, dp); ctx.fill();
    ctx.fillStyle = '#E23B3B'; ctx.beginPath(); ctx.roundRect(x + dp, low + deck * 0.714, 3.5 * dp, 5 * dp, dp); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x + bh * 0.1, low + deck * 0.63, bl * 0.72, 1.6 * dp);
    if (look.electric && !cancelled) {                      // a lightning bolt on the electrics
      const bx = x + bl * 0.32, by = low + deck * 0.635, u = deck * 0.075;
      ctx.fillStyle = '#7CFFB2'; ctx.beginPath();
      ctx.moveTo(bx + 1.2 * u, by - 1.6 * u); ctx.lineTo(bx - 0.4 * u, by + 0.2 * u); ctx.lineTo(bx + 0.5 * u, by + 0.2 * u);
      ctx.lineTo(bx - 0.6 * u, by + 2 * u); ctx.lineTo(bx + 1.3 * u, by - 0.3 * u); ctx.lineTo(bx + 0.4 * u, by - 0.3 * u);
      ctx.closePath(); ctx.fill();
    }
    // wheels: a tri-axle has a tag axle just behind the drive axle
    for (const fx of look.axles >= 3 ? [0.15, 0.3, 0.8] : [0.2, 0.8]) {
      const cx = x + bl * fx, cy = baseY - r;
      ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(cx, cy - r * 0.1, r * 1.25, 0, 7); ctx.fill();
      ctx.fillStyle = '#1B1F27'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
      ctx.fillStyle = '#9AA3AE'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.52, 0, 7); ctx.fill();
      const spin = moving ? t * 5.6 : 0;
      ctx.strokeStyle = '#5B636E'; ctx.lineWidth = 1.2 * dp; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = spin + k * 2 * Math.PI / 5;
        ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5);
      }
      ctx.stroke();
    }
    if (cancelled) {
      ctx.strokeStyle = A.pal.late; ctx.lineWidth = 3 * dp;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + bl, baseY - r); ctx.stroke();
    }
  };

  /** A model's portrait: its bus on a strip of road under a soft sky. */
  A.drawPortrait = function (ctx, w, h, model, t, moving) {
    const road = h * 0.84;
    const g = ctx.createLinearGradient(0, 0, 0, road);
    g.addColorStop(0, '#7FB6F0'); g.addColorStop(1, '#D6EAFB');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, road);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(w * 0.2, road * 0.3, h * 0.08, 0, 7); ctx.arc(w * 0.26, road * 0.26, h * 0.1, 0, 7); ctx.arc(w * 0.32, road * 0.3, h * 0.07, 0, 7); ctx.fill();
    ctx.fillStyle = '#3A414C'; ctx.fillRect(0, road, w, h - road);
    ctx.fillStyle = '#F0E3A8';
    for (let x = 0; x < w; x += h * 0.2) ctx.fillRect(x, road + (h - road) * 0.5, h * 0.1, Math.max(1, h * 0.012));
    const look = A.lookOf(model);
    const bl = w * 0.78;
    const bh = look.doubleDeck ? road * 0.5 : road * 0.56;
    A.drawBus(ctx, (w - bl) / 2, road + h * 0.03, bl, bh, { t: t || 0, moving: !!moving, dp: Math.max(1, h / 90), look });
  };

  /** A canvas at the right resolution for the screen; returns its 2D context scaled to CSS pixels. */
  A.fitCanvas = function (canvas) {
    const r = canvas.getBoundingClientRect();
    const k = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * k)), h = Math.max(1, Math.round(r.height * k));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    return { ctx, w: r.width, h: r.height };
  };
})(window.AKL);
