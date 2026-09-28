// Ctrl+K: one box for everything. Places and stops (directions or departures),
// routes (on the live map), bus models, screens and actions.
(function (A) {
  'use strict';
  const esc = A.esc;
  let box, input, list, items = [], active = 0, token = 0, routesCache = null;

  function build() {
    box = A.el(`<div class="palette" hidden><div class="pal-card"><label class="pal-in">${A.icon('search', 20)}<input placeholder="Search places, stops, routes, buses… or type a command" spellcheck="false" autocomplete="off"><kbd>Esc</kbd></label><div class="pal-list"></div></div></div>`);
    document.body.appendChild(box);
    input = box.querySelector('input');
    list = box.querySelector('.pal-list');
    box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
    input.addEventListener('input', update);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length);
        paint();
      } else if (e.key === 'Enter') { e.preventDefault(); run(active); }
    });
  }

  const views = [['buses', 'Buses', '🚌'], ['plan', 'Directions', '🧭'], ['stops', 'Stops', '🚏'], ['trains', 'Trains', '🚆'],
                 ['live', 'Every bus (live map)', '📍'], ['routes', 'Every route', '🗺'], ['fleet', 'Fleet', '🚍'], ['alerts', 'Alerts', '⚠️'], ['settings', 'Settings', '⚙️']];
  function actions() {
    const out = views.map(([id, name, icon]) => ({ icon, title: `Go to ${name}`, sub: 'Screen', run: () => A.show(id) }));
    out.push({ icon: '🌓', title: 'Switch light / dark', sub: 'Theme', run: () => A.settings.set('theme', A.isDark() ? 'light' : 'dark') });
    out.push({ icon: '🔄', title: 'Refresh everything', sub: 'Ctrl+R', run: () => { A.refresh('buses'); A.refresh('trains'); A.refresh('live'); A.alerts.refresh(); } });
    if (A.desktop) out.push({ icon: '🪟', title: 'Open the desk board', sub: 'Ctrl+M', run: () => A.desktop.openMini() });
    return out;
  }

  async function update() {
    const q = input.value.trim();
    const my = ++token;
    const ql = q.toLowerCase();
    let out = [];
    if (!q) {
      out = actions().slice(0, 8);
      const h = A.places.home();
      if (h) out.unshift({ icon: '🏠', title: 'Directions home', sub: h.sub || h.name, run: () => { A.show('plan'); A.views.plan.goTo(Object.assign({}, h, { type: 'home' })); } });
      render(out);
      return;
    }
    out = actions().filter((a) => a.title.toLowerCase().includes(ql));
    // routes: "27", "NX1", "E-W"
    if (!routesCache && A.gtfsState.ready) routesCache = await A.gtfs.routes();
    const routes = (routesCache || []).filter((r) => r.short.toLowerCase().startsWith(ql)).slice(0, 5).map((r) => ({
      icon: r.type === 2 ? '🚆' : r.type === 4 ? '⛴' : '🚌', title: `Route ${r.short}`, sub: `${r.long && r.long !== r.short ? r.long + ' · ' : ''}${r.trips} trips today · show live`,
      run: () => { A.show('live'); A.views.live.route(r.short); },
    }));
    const models = A.fleet.models.filter((m) => m.name.toLowerCase().includes(ql)).slice(0, 3).map((m) => ({
      icon: m.electric ? '⚡' : '🚍', title: m.name, sub: m.kind, run: () => A.emit('open-model', m.id),
    }));
    const fleetNo = /^[a-z]{2}\d{2,4}$/i.test(q) ? [{ icon: '🔎', title: `Find bus ${q.toUpperCase()}`, sub: 'On the live map', run: () => { A.show('live'); A.views.live.search(q.toUpperCase()); } }] : [];
    render(out.concat(routes, fleetNo, models));
    const stops = await A.gtfs.searchStops(q, 5).catch(() => []);
    if (my !== token) return;
    const stopItems = stops.map((s) => ({
      icon: s.modes & 2 ? '🚆' : s.modes & 4 ? '⛴' : '🚏', title: s.name, sub: `${s.station ? 'Station' : 'Stop ' + s.code} · departures`,
      run: () => { A.show('stops'); A.views.stops.open(s.id); },
      alt: { label: 'Directions', run: () => { A.show('plan'); A.views.plan.goTo({ name: s.name, sub: 'Stop ' + s.code, lat: s.lat, lon: s.lon, type: 'stop', code: s.code, id: s.id }); } },
    }));
    render(out.concat(routes, fleetNo, stopItems, models));
    if (/^[a-z]{0,3}\d{1,4}[a-z]?$/i.test(q)) return;       // "27H", "NX1", "NB5075": not an address
    const places = await A.places.search(q).catch(() => []);
    if (my !== token) return;
    const placeItems = places.slice(0, 5).map((p) => ({
      icon: '📍', title: p.name, sub: `${p.sub} · directions`, run: () => { A.show('plan'); A.views.plan.goTo(p); },
    }));
    render(out.concat(routes, fleetNo, stopItems, placeItems, models));
  }

  function render(out) {
    items = out;
    active = Math.min(active, Math.max(0, items.length - 1));
    list.innerHTML = items.map((it, i) => `<button class="pal-item" data-i="${i}"><span class="pi-i">${it.icon}</span><span class="pi-t"><b>${esc(it.title)}</b><small>${esc(it.sub || '')}</small></span>` +
      `${it.alt ? `<span class="pi-alt" data-alt="${i}">${esc(it.alt.label)}</span>` : ''}</button>`).join('') || '<div class="pal-empty">Nothing found</div>';
    A.$$('.pal-item', list).forEach((b) => {
      b.onmousedown = (e) => { e.preventDefault(); const alt = e.target.closest('[data-alt]'); if (alt) { close(); items[+alt.dataset.alt].alt.run(); } else run(+b.dataset.i); };
      b.onmousemove = () => { active = +b.dataset.i; paint(); };
    });
    paint();
  }
  function paint() { A.$$('.pal-item', list).forEach((b, i) => b.classList.toggle('on', i === active)); const on = A.$('.pal-item.on', list); if (on) on.scrollIntoView({ block: 'nearest' }); }
  function run(i) { const it = items[i]; if (!it) return; close(); it.run(); }

  function open() { if (!box) build(); box.hidden = false; input.value = ''; active = 0; update(); setTimeout(() => input.focus(), 10); }
  function close() { if (box) box.hidden = true; }
  A.palette = { open, close, isOpen: () => box && !box.hidden };
})(window.AKL);
