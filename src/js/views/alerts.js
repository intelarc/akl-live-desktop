// Alerts: every current and upcoming disruption on the network, yours first.
(function (A) {
  'use strict';
  const esc = A.esc;
  const V = {};
  let root, filter = 'mine', query = '';

  V.mount = function (el) {
    root = el;
    root.innerHTML = `<div class="page"><header class="page-head"><div><h1>Alerts</h1><div class="sub" id="a-sub"></div></div>
      <div class="head-right"><label class="search small">${A.icon('search', 16)}<input id="a-q" placeholder="Route, stop or street" spellcheck="false"></label></div></header>
      <div class="seg-row" id="a-filters"></div><div class="alert-list" id="a-list"></div></div>`;
    A.$('#a-q', root).addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); render(); });
    A.on('alerts', render);
    render();
  };
  V.show = function () { if (A.time.now() - A.state.alerts.updated > 120) A.alerts.refresh(); };
  V.hide = function () {};

  function render() {
    if (!root) return;
    const S = A.state.alerts;
    const mine = A.alerts.mine();
    const mineIds = new Set(mine.map((a) => a.id));
    const isTrain = (a) => a.routes.some((r) => A.NET.lineIds.includes(r)) || /train|rail|station/i.test(a.header);
    const isFerry = (a) => /ferry|wharf|pier/i.test(a.header);
    const groups = {
      mine: ['Yours', (a) => mineIds.has(a.id)],
      now: ['Happening now', (a) => a.active],
      trains: ['Trains', isTrain],
      ferries: ['Ferries', isFerry],
      upcoming: ['Coming up', (a) => !a.active],
      all: ['Everything', () => true],
    };
    A.$('#a-sub', root).innerHTML = S.updated ? `${S.list.filter((a) => a.active).length} happening now · ${S.list.length} in all · <span data-since="${S.updated}"></span>` : 'Loading…';
    A.$('#a-filters', root).innerHTML = Object.entries(groups).map(([k, [label, f]]) =>
      `<button class="fchip${filter === k ? ' on' : ''}" data-f="${k}">${label}<b>${S.list.filter(f).length}</b></button>`).join('');
    A.$$('#a-filters [data-f]', root).forEach((b) => { b.onclick = () => { filter = b.dataset.f; render(); }; });
    let list = S.list.filter(groups[filter][1]);
    if (query) list = list.filter((a) => (a.header + ' ' + a.description + ' ' + a.routes.join(' ') + ' ' + a.stopCodes.join(' ')).toLowerCase().includes(query));
    A.$('#a-list', root).innerHTML = S.error && !S.list.length ? `<div class="empty err">${esc(S.error)}</div>`
      : !list.length ? `<div class="empty">${filter === 'mine' ? 'Nothing affecting your route or stops right now. 🎉' : 'Nothing here.'}</div>`
      : list.map((a) => `<article class="card alert-card${a.active ? ' now' : ''}${mineIds.has(a.id) ? ' mine' : ''}">
          <div class="ac-top"><span class="chip ${a.cls}">${esc(a.label)}</span>${mineIds.has(a.id) ? '<span class="chip blue">Affects you</span>' : ''}<span class="ac-when">${esc(A.alerts.when(a))}</span></div>
          <h3>${esc(a.header)}</h3>
          ${a.routes.length ? `<div class="route-chips">${a.routes.slice(0, 24).map((r) => `<span class="rc">${esc(r)}</span>`).join('')}${a.routes.length > 24 ? `<span class="rc more">+${a.routes.length - 24}</span>` : ''}</div>` : ''}
          ${a.description ? `<details><summary>Details</summary><p>${esc(a.description).replace(/\n/g, '<br>')}</p></details>` : ''}
        </article>`).join('');
    A.tick();
  }

  (A.views = A.views || {}).alerts = V;
})(window.AKL);
