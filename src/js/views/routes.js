// Routes: every bus, train and ferry route running today, from AT's timetable.
// Click one to see it on the live map, with its buses.
(function (A) {
  'use strict';
  const esc = A.esc;
  const V = {};
  let root, list = null, q = '', type = 'all', busy = false;
  const TYPES = [['all', 'All'], ['3', '🚌 Bus'], ['2', '🚆 Train'], ['4', '⛴ Ferry']];

  V.mount = function (el) {
    root = el;
    root.innerHTML = `
      <div class="page">
        <header class="page-head">
          <div><h1>Routes</h1><div class="sub" id="r-sub">Every route running today</div></div>
          <div class="head-right"><div class="seg-row" id="r-types"></div></div>
        </header>
        <label class="search">${A.icon('search', 18)}<input id="r-q" placeholder="Route number or where it goes, e.g. 27H, NX1, Takapuna" autocomplete="off" spellcheck="false"></label>
        <div class="route-grid" id="r-grid"></div>
      </div>`;
    const input = A.$('#r-q', root);
    input.addEventListener('input', () => { q = input.value.trim().toLowerCase(); render(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; q = ''; render(); } });
    A.on('gtfs', () => { if (A.gtfsState.ready && !list) load(); else if (!list) render(); });
    load();
  };
  V.show = function () { if (!list) load(); };
  V.hide = function () {};

  async function load() {
    if (busy || !A.gtfsState.ready) { render(); return; }
    busy = true;
    try { list = await A.gtfs.routes(); } catch (e) { list = null; }
    busy = false;
    render();
  }

  const natural = (a, b) => a.short.localeCompare(b.short, undefined, { numeric: true, sensitivity: 'base' });
  function colour(r) {
    if (r.type === 2) { const li = A.NET.lineIds.indexOf(r.short); return li >= 0 ? A.NET.lineColors[li] : A.MODE_COLOR.train; }
    return r.type === 4 ? A.MODE_COLOR.ferry : A.pal.atBlue;
  }
  const kind = (t) => (t === 2 ? 'Train' : t === 4 ? 'Ferry' : 'Bus');

  function render() {
    const grid = A.$('#r-grid', root);
    if (!list) {
      grid.innerHTML = `<div class="empty"><span class="loading-bar"><i style="width:${A.gtfsState.pct || 3}%"></i></span>${esc(A.gtfsState.text || 'Loading AT\'s timetable…')}</div>`;
      A.$('#r-types', root).innerHTML = '';
      return;
    }
    const count = (t) => list.filter((r) => t === 'all' || String(r.type) === t).length;
    A.$('#r-types', root).innerHTML = TYPES.map(([k, label]) =>
      `<button class="fchip${type === k ? ' on' : ''}" data-t="${k}">${label}<b>${count(k)}</b></button>`).join('');
    A.$$('#r-types [data-t]', root).forEach((b) => { b.onclick = () => { type = b.dataset.t; render(); }; });
    const shown = list.filter((r) => (type === 'all' || String(r.type) === type) &&
      (!q || r.short.toLowerCase().startsWith(q) || (r.long || '').toLowerCase().includes(q))).sort((a, b) => a.type - b.type || natural(a, b));
    A.$('#r-sub', root).textContent = `${list.length} routes running today · ${list.reduce((t, r) => t + (r.trips || 0), 0).toLocaleString()} trips`;
    grid.innerHTML = shown.map((r) => `<button class="route-card" data-r="${esc(r.short)}">${A.routeBadge(r.short, colour(r), true)}` +
      `<span><b>${esc(r.long && r.long !== r.short ? r.long : kind(r.type) + ' ' + r.short)}</b><small>${kind(r.type)} · ${r.trips} trip${r.trips === 1 ? '' : 's'} today</small></span>` +
      `<span class="chev">›</span></button>`).join('') || '<div class="empty">No routes match that.</div>';
    A.$$('.route-card', grid).forEach((b) => { b.onclick = () => { A.show('live'); A.views.live.route(b.dataset.r); }; });
  }

  (A.views = A.views || {}).routes = V;
})(window.AKL);
