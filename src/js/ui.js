// Small shared pieces of UI: icons, chips, vehicle rows, live countdowns.
(function (A) {
  'use strict';
  const esc = A.esc;

  // ---------- icons (24px, currentColor) ----------
  const P = {
    buses: '<path fill-rule="evenodd" d="M6 3h12a3 3 0 0 1 3 3v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a3 3 0 0 1 3-3Zm-1 3v5h14V6H5Zm1 8v2h2v-2H6Zm10 0v2h2v-2h-2Z"/><path d="M5 18.5h4V21H5zM15 18.5h4V21h-4z"/>',
    trains: '<path fill-rule="evenodd" d="M8 2h8a4 4 0 0 1 4 4v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a4 4 0 0 1 4-4Zm-1.5 3.5v5h11v-5h-11ZM7 13v2h2v-2H7Zm8 0v2h2v-2h-2Z"/><path d="M7 19h2.5l-2 3H5zM14.5 19H17l2 3h-2.5z"/>',
    live: '<path fill-rule="evenodd" d="M12 2a7 7 0 0 1 7 7c0 5.2-7 13-7 13S5 14.2 5 9a7 7 0 0 1 7-7Zm0 4.2A2.8 2.8 0 1 0 12 11.8 2.8 2.8 0 0 0 12 6.2Z"/>',
    fleet: '<path fill-rule="evenodd" d="M3 5h15.5a2.8 2.8 0 0 1 2.7 2.2L22 11v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2.5V11h4V7.5H4Zm5.5 0V11h4V7.5h-4Zm5.5 0V11h5.2l-.8-3.5H15Z"/><circle cx="6.7" cy="18" r="2.2"/><circle cx="17.3" cy="18" r="2.2"/>',
    settings: '<path fill-rule="evenodd" d="M10.3 2h3.4l.5 2.6c.6.2 1.2.5 1.7.9l2.5-.9 1.7 2.9-2 1.7c.1.6.1 1.3 0 1.9l2 1.7-1.7 2.9-2.5-.9c-.5.4-1.1.7-1.7.9l-.5 2.6h-3.4l-.5-2.6c-.6-.2-1.2-.5-1.7-.9l-2.5.9-1.7-2.9 2-1.7a6 6 0 0 1 0-1.9l-2-1.7 1.7-2.9 2.5.9c.5-.4 1.1-.7 1.7-.9L10.3 2ZM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" transform="translate(0 1.5)"/>',
    refresh: '<path d="M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.3L13 11h7V4l-2.3 2.3Z"/>',
    bell: '<path d="M12 22a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.8V3.5a1.5 1.5 0 0 0-3 0v.7A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"/>',
    bellOff: '<path d="M12 22a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.8V3.5a1.5 1.5 0 0 0-3 0v.7c-.9.2-1.8.6-2.5 1.2L19 16.4V16ZM3.3 2.3 2 3.6l3.3 3.3A7 7 0 0 0 5 11v5l-2 2v1h14.4l3 3 1.3-1.3L3.3 2.3Z"/>',
    expand: '<path d="M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z"/>',
    shrink: '<path d="M8 4h2v6H4V8h4V4Zm6 0h2v4h4v2h-6V4ZM4 14h6v6H8v-4H4v-2Zm10 0h6v2h-4v4h-2v-6Z"/>',
    search: '<path d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3Zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z"/>',
    close: '<path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z"/>',
    back: '<path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20v-2Z"/>',
    board: '<path fill-rule="evenodd" d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm2 3v2h6V8H5Zm0 4v2h9v-2H5Zm12-4v2h2V8h-2Zm0 4v2h2v-2h-2Z"/>',
    follow: '<path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-1-7h2v3.1A8 8 0 0 1 19.9 11H23v2h-3.1A8 8 0 0 1 13 19.9V23h-2v-3.1A8 8 0 0 1 4.1 13H1v-2h3.1A8 8 0 0 1 11 4.1V1Zm1 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z"/>',
    zoomIn: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/>',
    zoomOut: '<path d="M5 11h14v2H5z"/>',
    fit: '<path d="M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z"/><circle cx="12" cy="12" r="2.5"/>',
  };
  A.icon = (name, size) => `<svg class="ico" viewBox="0 0 24 24" width="${size || 20}" height="${size || 20}" fill="currentColor" aria-hidden="true">${P[name] || ''}</svg>`;

  A.chip = (text, cls) => `<span class="chip ${cls || ''}">${esc(text)}</span>`;
  A.routeBadge = (route, color, big) =>
    `<span class="route-badge${big ? ' big' : ''}" style="--c:${color || A.pal.atBlue}">${esc(route || '—')}</span>`;
  A.linePill = (li, big) =>
    `<span class="route-badge line${big ? ' big' : ''}" style="--c:${A.NET.lineColors[li]}">${esc(A.NET.lineIds[li])}</span>`;

  /** "Live · 12s ago", pulsing; amber when stale. */
  A.liveBadge = function (updated, now) {
    const age = updated ? now - updated : null;
    const stale = age != null && age > 120;
    const text = age == null ? 'Connecting…' : stale ? `Stale · ${Math.floor(age / 60)} min` : `Live · ${A.ago(age)}`;
    return `<span class="live-badge ${age == null || stale ? 'warn' : ''}"><i></i>${esc(text)}</span>`;
  };

  /** What bus this is: a small drawing, model, operator and fleet number. Click for the model's page. */
  A.vehicleRow = function (v, opts) {
    const info = v && A.fleet.info(v.label);
    if (!info) return '';
    const m = info.model;
    const chips = m ? (m.electric ? A.chip('⚡ Electric', 'ok') : '') + (m.doubleDeck ? A.chip('Double-decker', 'blue') : '') : '';
    return `<button class="vehicle-row${opts && opts.big ? ' big' : ''}" data-model="${m ? m.id : 'unknown'}" title="About this model">
      <canvas class="portrait" data-portrait="${m ? m.id : ''}"></canvas>
      <span class="vr-text"><b>${esc(m ? m.short : `${info.operator} ${info.fleetNo}`)}</b>
        <small>${esc(m ? [m.maker, info.operator, info.fleetNo].join(' · ') : 'Model not identified yet')}</small></span>
      <span class="vr-chips">${chips}</span><span class="chev">›</span></button>`;
  };

  /** Draws every portrait canvas inside root (after it's been put on the page). */
  A.paintPortraits = function (root) {
    for (const c of A.$$('canvas[data-portrait]', root)) {
      if (!c.getBoundingClientRect().width) continue;          // hidden: painted when its screen shows
      const { ctx, w, h } = A.fitCanvas(c);
      A.drawPortrait(ctx, w, h, A.fleet.model(c.dataset.portrait), 0, false);
    }
  };

  /** The stops between the bus and you, with the one it last passed. */
  A.stopsTrack = function (code, away, color) {
    const r = A.ROUTES[code];
    if (!r || away == null) return '';
    const stops = r.stops;
    const mine = stops.findIndex((s) => s.code === code);
    if (mine < 0) return '';
    const at = Math.max(0, Math.min(mine, mine - away));
    const shown = Math.min(away, 12);
    const W = 600, H = 34, pad = 14, y = H / 2;
    const left = shown > 0 ? pad : W - pad, right = W - pad;
    const step = shown > 0 ? (right - left) / shown : 0;
    let svg = `<svg class="track" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
    if (away > shown) svg += `<line x1="0" y1="${y}" x2="${left}" y2="${y}" class="track-far"/>`;
    svg += `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`;
    for (let k = 1; k <= shown; k++) {
      const yours = k === shown;
      svg += `<circle cx="${left + k * step}" cy="${y}" r="${yours ? 8 : 4.5}" class="track-stop" stroke="${color}"/>`;
    }
    svg += `<circle cx="${left}" cy="${y}" r="15" fill="${color}" opacity="0.25"/><circle cx="${left}" cy="${y}" r="10" fill="${color}"/>` +
           `<circle cx="${left}" cy="${y}" r="4.5" fill="#fff"/></svg>`;
    return `<div class="stops-track">${svg}<div class="track-text"><b>${away === 0 ? 'At your stop' : 'Last stop: ' + esc(stops[at].name)}</b>` +
           `<span>${away === 0 ? '' : away === 1 ? '1 stop away' : away + ' stops away'}</span></div></div>`;
  };

  // ---------- live countdowns: any element with data-exp="<epoch>" ticks every second ----------
  function tick() {
    const now = A.time.now();
    for (const e of A.$$('[data-exp]')) {
      const secs = +e.dataset.exp - now;
      const text = e.dataset.cancelled ? 'Cancelled' : A.countdown(secs);
      if (e.dataset.big != null) {
        const [n, ...rest] = text.split(' ');
        const num = e.querySelector('b'), unit = e.querySelector('small');
        if (num && num.textContent !== n) { num.textContent = n; num.classList.remove('roll'); void num.offsetWidth; num.classList.add('roll'); }
        if (unit) unit.textContent = rest.join(' ');
        e.classList.toggle('due', secs < 45);
      } else if (e.textContent !== text) e.textContent = text;
    }
    for (const e of A.$$('[data-since]')) e.textContent = A.ago(Math.max(0, now - +e.dataset.since));
    A.emit('tick', now);
  }
  setInterval(tick, 1000);
  A.tick = tick;

  // ---------- toasts ----------
  let toastTimer = null;
  A.toast = function (text) {
    const t = A.$('#toast');
    if (!t) return;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  };

  // clicking any vehicle row opens that model's page
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-model]');
    if (b && b.classList.contains('vehicle-row')) A.emit('open-model', b.dataset.model);
  });
})(window.AKL);
