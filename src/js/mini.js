// The desk board: a small always-on-top window with the next buses each way,
// styled after the ESP32 board on the desk.
(function (A) {
  'use strict';
  const esc = A.esc, T = A.time;
  let boards = [], updated = 0, error = null;

  function shell() {
    document.body.innerHTML = `
      <div class="mb-bar"><span class="mb-title">AT Departures</span><span class="mb-clock" id="mb-clock"></span>
        <span class="mb-tools"><button id="mb-open" title="Open AKL Live">⤢</button><button id="mb-close" title="Close">✕</button></span></div>
      <div class="mb-rows" id="mb-rows"><div class="mb-empty">Loading…</div></div>
      <div class="mb-foot" id="mb-foot"></div>`;
    document.getElementById('mb-open').onclick = () => A.desktop && A.desktop.showMain('buses');
    document.getElementById('mb-close').onclick = () => A.desktop ? A.desktop.closeMini() : window.close();
  }

  async function load() {
    const route = A.settings.get('route');
    try {
      boards = await Promise.all(A.settings.get('stops').map((c) => A.buses.board(c, route)));
      updated = T.now(); error = null;
    } catch (e) { error = e.message; }
    render();
  }

  function render() {
    const now = T.now();
    const rows = document.getElementById('mb-rows');
    if (!boards.length) { rows.innerHTML = `<div class="mb-empty">${esc(error || 'Loading…')}</div>`; return; }
    rows.innerHTML = boards.map((b, i) => {
      const deps = b.departures.filter((d) => !d.cancelled && d.expected >= now - 30);
      const d = deps[0];
      const later = deps.slice(1, 3).map((x) => `<span data-exp="${x.expected}">${A.countdown(x.expected - now)}</span>`).join(', ');
      return `<div class="mb-row">
        <span class="mb-route" style="--c:${A.pal.dir[i % 2]}">${esc((d && d.route) || A.settings.get('route'))}</span>
        <div class="mb-dest"><b>${esc((d && d.headsign) || b.headsign || b.code)}</b><small>${d ? (d.live ? '<i class="mb-live"></i>' + esc(A.punctuality(d.delay).text) : 'Scheduled') : 'No buses soon'}${later ? ' · then ' + later : ''}</small></div>
        <div class="mb-count" ${d ? `data-exp="${d.expected}"` : ''}>${d ? A.countdown(d.expected - now) : '--'}</div></div>`;
    }).join('');
    document.getElementById('mb-foot').textContent = error ? error : `${boards[0].name || ''} · updated ${A.ago(now - updated)}`;
    tick();
  }

  function tick() {
    const now = T.now();
    const c = T.clockParts(now);
    document.getElementById('mb-clock').textContent = `${c.hm} ${c.ampm}`;
    document.querySelectorAll('[data-exp]').forEach((e) => { e.textContent = A.countdown(+e.dataset.exp - now); });
  }

  window.addEventListener('DOMContentLoaded', () => {
    A.applyTheme();
    shell();
    load();
    setInterval(load, 30000);
    setInterval(tick, 1000);
    setInterval(render, 10000);
    A.on('settings', (k) => { if (k === 'stops' || k === 'route' || k === '*') load(); });
  });
})(window.AKL);
