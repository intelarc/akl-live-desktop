// Fleet: every bus model in Auckland with how many are out right now, the
// operators' fleets at a glance, and a page per model with a live map.
(function (A) {
  'use strict';
  const esc = A.esc, T = A.time;
  const V = {};
  let root, filter = 'all', sort = 'out', openId = null, map = null, selected = null, portraitRun = false, fitted = null, heroPhoto = false;

  V.mount = function (el) {
    root = el;
    root.innerHTML = `<div class="page" id="f-list"></div><div class="page model-page" id="f-model" hidden></div>`;
    A.on('live', () => { if (openId) renderModel(false); else renderList(); });
    renderList();
  };
  V.show = function () {
    A.need('live', true);
    if (openId) { setTimeout(() => map && map.resize(), 30); portraitRun = true; requestAnimationFrame(animate); }
  };
  V.hide = function () { A.need('live', false); portraitRun = false; };
  V.key = function (e) { if (e.key === 'Escape' && openId) V.open(null); if (e.key === 'Backspace' && openId && !/input|textarea/i.test(document.activeElement.tagName)) V.open(null); };

  /** Open a model's page (or the unidentified buses with "unknown"); null goes back to the list. */
  V.open = function (id) {
    openId = id;
    selected = null; fitted = null; heroPhoto = false;
    A.$('#f-list', root).hidden = !!id;
    A.$('#f-model', root).hidden = !id;
    if (id) {
      renderModel(true);
      portraitRun = true;
      requestAnimationFrame(animate);
      A.$('#f-model', root).scrollTop = 0;
    } else {
      portraitRun = false;
      renderList();
    }
  };

  function byModel() {
    const out = {};
    for (const b of A.state.live.buses) {
      const k = b.info.model ? b.info.model.id : 'unknown';
      (out[k] = out[k] || []).push(b);
    }
    return out;
  }

  // ---------- the list ----------
  function renderList() {
    const L = A.state.live;
    const groups = byModel();
    const count = (m) => (groups[m.id] || []).length;
    let models = A.fleet.models.filter((m) => filter === 'electric' ? m.electric : filter === 'diesel' ? !m.electric
                                              : filter === 'double' ? m.doubleDeck : true);
    models = models.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => count(b) - count(a) || a.name.localeCompare(b.name));
    const unknown = groups.unknown || [];
    const known = L.buses.length - unknown.length;
    const out = L.buses.length;
    const elecOut = L.buses.filter((b) => b.info.model && b.info.model.electric).length;
    const tog = (key, label, cur) => `<button class="fchip${cur === key ? ' on' : ''}" data-k="${key}">${label}</button>`;
    const page = A.$('#f-list', root);
    page.innerHTML = `
      <header class="page-head">
        <div><h1>Fleet</h1><div class="sub">${L.loading ? 'Counting the buses on the road…'
          : `${A.fleet.models.length} models · <b>${out.toLocaleString()}</b> buses out right now · ${Math.round(known * 100 / Math.max(1, out))}% identified`}</div></div>
        <div class="head-right"><div class="seg-row">${tog('all', 'All', filter)}${tog('electric', '⚡ Electric', filter)}${tog('diesel', 'Diesel', filter)}${tog('double', 'Double-deckers', filter)}</div>
          <div class="seg-row sort">${['out', 'name'].map((k) => `<button class="fchip${sort === k ? ' on' : ''}" data-s="${k}">${k === 'out' ? 'Most out' : 'A–Z'}</button>`).join('')}</div></div>
      </header>
      <div class="stat-row">
        ${stat('Out now', out.toLocaleString())}${stat('Electric', elecOut + ' · ' + Math.round(elecOut * 100 / Math.max(1, out)) + '%')}
        ${stat('Double-deckers', L.buses.filter((b) => b.info.model && b.info.model.doubleDeck).length)}
        ${stat('Not in service', L.buses.filter((b) => !b.route).length)}
      </div>
      <div class="model-grid">${models.map((m) => card(m, groups[m.id] || [])).join('')}
        ${filter === 'all' && unknown.length ? unknownCard(unknown) : ''}</div>
      <section class="card ops-card"><div class="card-head"><div><h2>Operators</h2><div class="sub">Who runs what, right now</div></div></div>
        <div class="ops-grid">${operators()}</div></section>
      <p class="credit">Models and fleet numbers from the AT Metro Wiki (atmetro.fandom.com, CC BY-SA), matched to the fleet number each bus reports. Live positions from Auckland Transport.</p>`;
    A.$$('[data-k]', page).forEach((b) => { b.onclick = () => { filter = b.dataset.k; renderList(); }; });
    A.$$('[data-s]', page).forEach((b) => { b.onclick = () => { sort = b.dataset.s; renderList(); }; });
    A.$$('[data-open]', page).forEach((b) => { b.onclick = () => V.open(b.dataset.open); });
    A.paintPortraits(page);
  }
  const stat = (label, value) => `<div class="stat"><b>${esc(value)}</b><small>${esc(label)}</small></div>`;

  function card(m, live) {
    const ops = A.fleet.numbers(m).map(([op]) => `<span class="op-tag" style="--c:${A.fleet.color(A.fleet.codeOf(op))}">${esc(op)}</span>`).join('');
    return `<button class="card model-card" data-open="${m.id}">
      <div class="mc-pic">${A.picHtml(m, 'portrait big')}
        <span class="mc-badge${live.length ? '' : ' none'}"><i></i>${live.length ? `${live.length} out now` : 'None out now'}</span>${A.creditHtml(m)}</div>
      <div class="mc-text"><b>${esc(m.name)}</b><small>${esc(m.kind)}</small><div class="op-tags">${ops}</div></div></button>`;
  }
  function unknownCard(list) {
    const by = {};
    list.forEach((b) => { by[b.info.operator] = (by[b.info.operator] || 0) + 1; });
    return `<button class="card model-card unknown" data-open="unknown">
      <div class="mc-pic"><div class="q">?</div><span class="mc-badge"><i></i>${list.length} out now</span></div>
      <div class="mc-text"><b>Not identified yet</b><small>Fleet numbers the app's list doesn't cover: ${Object.keys(by).map((k) => `${esc(k)} ${by[k]}`).join(', ')}</small></div></button>`;
  }
  function operators() {
    const L = A.state.live;
    const by = {};
    for (const b of L.buses) {
      const o = by[b.info.code] = by[b.info.code] || { n: 0, elec: 0, models: {} };
      o.n++;
      if (b.info.model && b.info.model.electric) o.elec++;
      const k = b.info.model ? b.info.model.short : 'Unidentified';
      o.models[k] = (o.models[k] || 0) + 1;
    }
    return Object.keys(by).sort((a, b) => by[b].n - by[a].n).map((code) => {
      const o = by[code];
      const top = Object.entries(o.models).sort((a, b) => b[1] - a[1]);
      const bar = top.map(([k, n], i) => `<s style="width:${n * 100 / o.n}%;opacity:${Math.max(0.25, 1 - i * 0.16)}" title="${esc(k)}: ${n}"></s>`).join('');
      return `<div class="op-card" style="--c:${A.fleet.color(code)}"><div class="op-top"><i></i><b>${esc(A.fleet.OPERATORS[code])}</b><span>${o.n}</span></div>
        <div class="op-bar">${bar}</div>
        <small>${Math.round(o.elec * 100 / o.n)}% electric · ${top.slice(0, 3).map(([k, n]) => `${esc(k)} ${n}`).join(', ')}</small></div>`;
    }).join('') || '<div class="empty">Waiting for the live feed…</div>';
  }

  // ---------- one model ----------
  function renderModel(first) {
    const page = A.$('#f-model', root);
    const m = openId === 'unknown' ? null : A.fleet.model(openId);
    const live = (byModel()[openId] || []).slice().sort((a, b) =>
      (!a.route - !b.route) || (a.route || '').localeCompare(b.route || '', undefined, { numeric: true }) || a.info.fleetNo.localeCompare(b.info.fleetNo));
    if (first) {
      page.innerHTML = `
        <div class="hero"><canvas id="f-hero"></canvas>
          <div class="hero-photo" hidden><div class="pic-blur"></div><img alt="" referrerpolicy="no-referrer"></div>
          <a class="pic-credit" hidden target="_blank" rel="noopener"></a>
          <button class="icon-btn back" id="f-back" title="Back (Esc)">${A.icon('back')}</button></div>
        <div class="model-body">
          <div class="model-main">
            <h1>${esc(m ? m.name : 'Not identified yet')}</h1>
            <div class="sub">${esc(m ? `${m.maker} · ${m.kind}` : 'Buses the app\'s fleet list doesn\'t cover yet')}</div>
            <div class="stat-row" id="f-stats"></div>
            <p class="about">${esc(m ? m.about : 'Their operator is known from the fleet-number prefix, but not the model. The fleet list grows as more ranges are confirmed; the Android app\'s CI survey lists the gaps.')}</p>
            ${m ? `<h3>Fleet numbers</h3><div class="numbers">${A.fleet.numbers(m).map(([op, nums]) =>
              `<div><span class="op-tag" style="--c:${A.fleet.color(A.fleet.codeOf(op))}">${esc(op)}</span><span>${esc(nums)}</span></div>`).join('')}</div>` : ''}
          </div>
          <section class="card model-map-card">
            <div class="card-head"><div><h2>Where they are now</h2><div class="sub" id="f-mapsub"></div></div>
              <div class="seg" id="f-basemap"><button data-b="satellite">Satellite</button><button data-b="streets">Map</button></div></div>
            <div class="model-map" id="f-map"></div>
            <div class="vehicle-card inline" id="f-card" hidden></div>
          </section>
          <section class="card"><div class="card-head"><div><h2>On the road</h2><div class="sub">Click one to find it on the map</div></div></div>
            <div class="bus-list" id="f-list-rows"></div></section>
        </div>`;
      A.$('#f-back', page).onclick = () => V.open(null);
      if (m) A.photos.forModel(m).then((p) => heroFor(m, p));
      if (map) { map.destroy(); map = null; }
      map = new A.MapView(A.$('#f-map', page), {
        cooperativeGestures: true,
        onPick: (p) => { if (p.kind === 'vehicle') pick(p.id); },
        onBackground: () => pick(null),
      });
      A.$$('#f-basemap button', page).forEach((b) => {
        b.classList.toggle('on', b.dataset.b === A.settings.get('basemap'));
        b.onclick = () => { A.settings.set('basemap', b.dataset.b); map.setBasemap(b.dataset.b); A.$$('#f-basemap button', page).forEach((x) => x.classList.toggle('on', x === b)); };
      });
      map.fit([A.AKL_BOUNDS[0], A.AKL_BOUNDS[1]], 30);
    }
    const stats = [['Out now', live.length], ['In service', live.filter((b) => b.route).length]];
    if (m) for (const [k, v] of m.specs) stats.push([k, v]);
    A.$('#f-stats', page).innerHTML = stats.map(([k, v]) => stat(k, v)).join('');
    A.$('#f-mapsub', page).innerHTML = live.length ? `${live.length} on the road · <span data-since="${A.state.live.updated}"></span>` : 'None of them are out right now';
    // frame them once, when they first come in
    if (!fitted && live.length) {
      fitted = true;
      if (live.length === 1) map.flyTo(live[0].v.lon, live[0].v.lat, 14);
      else map.fit(live.map((b) => [b.v.lon, b.v.lat]), 40, 14);
    }
    map.setCrowd(live.map((b) => ({ id: b.v.id, lon: b.v.lon, lat: b.v.lat, bearing: b.v.bearing, color: A.fleet.color(b.info.code),
                                     op: b.info.code, kind: 'bus', label: b.route })));
    A.$('#f-list-rows', page).innerHTML = live.length ? live.map((b) =>
      `<button class="bus-row${b.v.id === selected ? ' on' : ''}" data-id="${esc(b.v.id)}"><i style="background:${A.fleet.color(b.info.code)}"></i>` +
      `<span><b>${esc(b.info.fleetNo)}</b><small>${esc(b.info.operator)}</small></span>` +
      `<span class="facts">${[b.v.speedKmh == null ? '' : b.v.speedKmh < 2 ? 'Stopped' : Math.round(b.v.speedKmh) + ' km/h', A.occupancy(b.v.occupancy) || ''].filter(Boolean).join(' · ')}</span>` +
      `${b.route ? A.routeBadge(b.route, A.fleet.color(b.info.code)) : '<span class="chip sched">Not in service</span>'}</button>`).join('')
      : `<div class="empty">None of them are out right now.</div>`;
    A.$$('.bus-row', page).forEach((r) => { r.onclick = () => pick(r.dataset.id, true); });
    renderCard();
    A.tick();
  }

  function pick(id, fly) {
    selected = id;
    map.select(id);
    const b = id && A.state.live.buses.find((x) => x.v.id === id);
    if (b && fly) { map.flyTo(b.v.lon, b.v.lat, 15); A.$('#f-map', root).scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    A.$$('.bus-row', root).forEach((r) => r.classList.toggle('on', r.dataset.id === id));
    renderCard();
  }
  function renderCard() {
    const card = A.$('#f-card', root);
    const b = selected && A.state.live.buses.find((x) => x.v.id === selected);
    if (!card) return;
    if (!b) { card.hidden = true; return; }
    const occ = A.occupancy(b.v.occupancy);
    card.innerHTML = `<div class="vc-head">${A.routeBadge(b.route || '—', A.fleet.color(b.info.code), true)}<div class="vc-title"><b>${esc(b.info.fleetNo)}</b>` +
      `<small>${esc(b.info.operator)}${b.route ? '' : ' · not in service'}</small></div>` +
      `<div class="chips">${A.chip(b.v.speedKmh == null ? 'Speed unknown' : b.v.speedKmh < 2 ? 'Stopped' : Math.round(b.v.speedKmh) + ' km/h', 'blue')}${occ ? A.chip(occ, 'sched') : ''}</div>` +
      `<button class="icon-btn small" id="f-cardx">${A.icon('close', 16)}</button></div>`;
    card.hidden = false;
    A.$('#f-cardx', card).onclick = () => pick(null);
  }

  /** The model's real photo across the top: whole, over a blurred copy of itself. */
  function heroFor(m, p) {
    if (!p || openId !== m.id) return;
    const hero = A.$('.hero', root), img = A.$('.hero-photo img', hero);
    img.onload = () => {
      if (openId !== m.id) return;
      A.$('.pic-blur', hero).style.backgroundImage = `url("${p.url.replace(/"/g, '%22')}")`;
      A.$('.hero-photo', hero).hidden = false;
      const credit = A.$('.pic-credit', hero);
      credit.textContent = p.credit;
      if (p.page) credit.href = p.page;
      credit.hidden = false;
      heroPhoto = true;                                      // no need to draw the bus any more
    };
    img.alt = m.name;
    img.src = p.url;
  }

  // the hero bus drives on the spot (until its photo is in)
  function animate(ts) {
    if (!portraitRun || !openId || heroPhoto) return;
    const c = A.$('#f-hero', root);
    if (c) {
      const { ctx, w, h } = A.fitCanvas(c);
      const m = openId === 'unknown' ? null : A.fleet.model(openId);
      A.drawPortrait(ctx, w, h, m, ts / 1000, true);
      if (!m) {
        ctx.fillStyle = 'rgba(11,22,40,0.45)'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#fff'; ctx.font = `800 ${h * 0.4}px "Segoe UI", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', w / 2, h * 0.45);
      }
    }
    requestAnimationFrame(animate);
  }

  (A.views = A.views || {}).fleet = V;
})(window.AKL);
