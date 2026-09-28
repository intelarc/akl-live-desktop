// Shared plumbing: DOM and time helpers, settings, events, the desktop bridge.
window.AKL = window.AKL || {};
(function (A) {
  'use strict';

  // ---------- DOM ----------
  A.$ = (sel, root) => (root || document).querySelector(sel);
  A.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  A.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  A.el = function (html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };

  // ---------- events ----------
  const handlers = {};
  A.on = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); return () => A.off(name, fn); };
  A.off = (name, fn) => { handlers[name] = (handlers[name] || []).filter((f) => f !== fn); };
  A.emit = (name, data) => (handlers[name] || []).slice().forEach((f) => { try { f(data); } catch (e) { console.error(e); } });

  // ---------- Auckland time: GTFS times are local, and so is everything shown ----------
  const TZ = 'Pacific/Auckland';
  const fmt = new Intl.DateTimeFormat('en-NZ', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const pad = (n) => String(n).padStart(2, '0');
  function parts(ms) {
    const o = {};
    for (const p of fmt.formatToParts(new Date(ms))) o[p.type] = p.value;
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
  }
  /** Epoch ms of midnight in Auckland on that date (GTFS: noon minus 12 h). */
  function midnight(y, mo, d) {
    const noon = Date.UTC(y, mo - 1, d, 12);
    const p = parts(noon);
    const offset = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - noon;
    return Date.UTC(y, mo - 1, d) - offset;
  }
  A.time = {
    now: () => Math.floor(Date.now() / 1000),
    parts,
    hour() { const p = parts(Date.now()); return p.h + p.mi / 60 + p.s / 3600; },
    /** "2026-09-25", optionally some days away */
    date(ms, addDays) {
      const p = parts(ms == null ? Date.now() : ms);
      if (!addDays) return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
      const t = new Date(Date.UTC(p.y, p.mo - 1, p.d + addDays));
      return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
    },
    /** "3:42 pm" */
    clock(sec) {
      const p = parts(sec * 1000);
      return `${p.h % 12 || 12}:${pad(p.mi)} ${p.h < 12 ? 'am' : 'pm'}`;
    },
    clockParts(sec) {
      const p = parts(sec * 1000);
      return { hm: `${p.h % 12 || 12}:${pad(p.mi)}`, ampm: p.h < 12 ? 'am' : 'pm', sec: pad(p.s) };
    },
    /** A GTFS "HH:MM:SS" (may run past 24:00) on a service date -> epoch seconds. */
    serviceEpoch(date, hms) {
      const ds = String(date).replace(/-/g, '');
      const y = +ds.slice(0, 4), mo = +ds.slice(4, 6), d = +ds.slice(6, 8);
      const [h, m, s] = String(hms).split(':').map(Number);
      return Math.floor(midnight(y, mo, d) / 1000) + h * 3600 + m * 60 + (s || 0);
    },
    weekday(sec) {
      return new Intl.DateTimeFormat('en-NZ', { timeZone: TZ, weekday: 'long' }).format(new Date(sec * 1000));
    },
  };

  /** "3 min", "Due", "1 h 5 min" */
  A.countdown = function (secs) {
    const m = Math.floor(secs / 60);
    if (secs < 45) return 'Due';
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  };
  /** { text: "2 min late", cls: "warn" } */
  A.punctuality = function (delay) {
    if (delay == null) return { text: 'Scheduled', cls: 'sched' };
    const m = Math.round(delay / 60);
    if (m >= 5) return { text: `${m} min late`, cls: 'late' };
    if (m >= 2) return { text: `${m} min late`, cls: 'warn' };
    if (m <= -2) return { text: `${-m} min early`, cls: 'warn' };
    return { text: 'On time', cls: 'ok' };
  };
  A.ago = function (sec) {
    if (sec < 5) return 'just now';
    if (sec < 90) return `${sec}s ago`;
    return `${Math.round(sec / 60)} min ago`;
  };
  A.km = function (lat1, lon1, lat2, lon2) {
    const r = 6371, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(a));
  };

  // ---------- settings (this computer only) ----------
  const DEFAULTS = {
    stops: ['8669', '8664'],
    route: '27H',
    place: 'Hillsborough',
    walkMin: 4,           // how long it takes to walk to the stop
    alertMin: 5,          // alert this many minutes before a bus
    alerts: {},           // stop code -> true when that direction's buses alert
    theme: 'system',      // system | light | dark
    basemap: 'satellite', // satellite | streets
    apiKey: '',           // overrides the key built into the app
    linzKey: '',
    trainLines: [0, 1, 2],
    liveTrains: false,
    view: 'buses',
    palette: 'waitemata', // one of A.PALETTES, each after something Auckland
    kiwi: true,           // te reo greetings and a bit of local slang
    spotted: {},          // the fleet dex: model id -> { n, first, last, no }
  };
  let store = {};
  try { store = JSON.parse(localStorage.getItem('akl.settings') || '{}'); } catch (e) { store = {}; }
  A.settings = {
    get(k) { return k in store ? store[k] : DEFAULTS[k]; },
    set(k, v) {
      store[k] = v;
      try { localStorage.setItem('akl.settings', JSON.stringify(store)); } catch (e) { /* private window */ }
      A.emit('settings', k);
    },
    defaults: DEFAULTS,
  };
  // another window (the desk board) changed something
  window.addEventListener('storage', (e) => {
    if (e.key !== 'akl.settings') return;
    try { store = JSON.parse(e.newValue || '{}'); } catch (err) { return; }
    A.emit('settings', '*');
  });

  // ---------- the desktop app around us (null in a plain browser) ----------
  A.desktop = window.desktop || null;

  // ---------- theme ----------
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  A.isDark = function () {
    const t = A.settings.get('theme');
    return t === 'dark' || (t === 'system' && media.matches);
  };
  // ---------- colour themes, as in the Android app, each after something Auckland ----------
  A.PALETTES = [
    ['waitemata', 'Waitematā', 'Harbour blue, AT\'s own', '#235EA8'],
    ['pohutukawa', 'Pōhutukawa', 'Summer crimson', '#B3261E'],
    ['kawakawa', 'Kawakawa', 'Bush green', '#2E7D4F'],
    ['kowhai', 'Kōwhai', 'Spring gold', '#8C6200'],
    ['rangitoto', 'Rangitoto', 'Volcanic slate', '#4F5B73'],
    ['tui', 'Tūī', 'Iridescent teal', '#1E5E6E'],
  ];
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => '#' + rgb(a).map((x, i) => Math.round(x + (rgb(b)[i] - x) * t).toString(16).padStart(2, '0')).join('');
  const rgba = (h, a) => `rgba(${rgb(h).join(', ')}, ${a})`;
  /** The page's colours for a palette (Waitematā is the stylesheet's own). */
  function paletteVars(pri, dark) {
    if (dark) {
      const surf = mix('#12151C', pri, 0.16);
      return { '--bg': mix('#090B10', pri, 0.1), '--bg2': mix('#0C0F15', pri, 0.13), '--surface': surf, '--surface2': mix('#181C25', pri, 0.18),
               '--line': mix('#232835', pri, 0.24), '--text': mix('#E6E8EE', pri, 0.06), '--muted': mix('#A6ABB8', pri, 0.12), '--faint': mix('#717786', pri, 0.12),
               '--accent': mix(pri, '#FFFFFF', 0.48), '--accent-soft': mix('#12151C', pri, 0.45), '--on-accent': mix(pri, '#000000', 0.66),
               '--blue': mix(pri, '#FFFFFF', 0.48), '--glass': rgba(surf, 0.9) };
    }
    return { '--bg': mix('#FFFFFF', pri, 0.075), '--bg2': mix('#FFFFFF', pri, 0.11), '--surface': '#FFFFFF', '--surface2': mix('#FFFFFF', pri, 0.045),
             '--line': mix('#FFFFFF', pri, 0.14), '--text': mix('#1A1C22', pri, 0.35), '--muted': mix('#5A5E6A', pri, 0.3), '--faint': mix('#8A8F9C', pri, 0.25),
             '--accent': pri, '--accent-soft': mix(pri, '#FFFFFF', 0.83), '--on-accent': '#FFFFFF', '--blue': pri, '--glass': 'rgba(255, 255, 255, .88)' };
  }
  const VARS = Object.keys(paletteVars('#235EA8', false));
  function applyPalette(dark) {
    const p = A.PALETTES.find((x) => x[0] === A.settings.get('palette')) || A.PALETTES[0];
    const st = document.documentElement.style;
    VARS.forEach((k) => st.removeProperty(k));
    if (p[0] === 'waitemata') return;
    const v = paletteVars(p[3], dark);
    VARS.forEach((k) => st.setProperty(k, v[k]));
  }

  A.applyTheme = function () {
    document.documentElement.dataset.theme = A.isDark() ? 'dark' : 'light';
    applyPalette(A.isDark());
    if (A.desktop && A.desktop.flags && A.desktop.flags.mica && !document.body.classList.contains('mini')) document.documentElement.classList.add('mica');
    if (A.desktop) A.desktop.setTheme(A.settings.get('theme'), A.isDark());
    A.emit('theme', A.isDark());
  };
  media.addEventListener('change', () => { if (A.settings.get('theme') === 'system') A.applyTheme(); });
  A.on('settings', (k) => { if (k === 'theme' || k === 'palette' || k === '*') A.applyTheme(); });

  // ---------- colours ----------
  A.pal = {
    atBlue: '#235EA8', navy: '#1A2744', ink: '#56647E', live: '#2FA85A', warn: '#E08A12',
    late: '#D64545', bus: '#0096D6', dir: ['#3D8BFF', '#00C2B8'],
  };
})(window.AKL);
