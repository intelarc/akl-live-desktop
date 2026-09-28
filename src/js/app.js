// The shell: title bar, sidebar, switching screens, keyboard shortcuts.
(function (A) {
  'use strict';
  const esc = A.esc, T = A.time;
  const VIEWS = [
    ['buses', 'Buses'], ['plan', 'Directions'], ['stops', 'Stops'], ['trains', 'Trains'], ['live', 'Live'],
    ['routes', 'Routes'], ['fleet', 'Fleet'], ['alerts', 'Alerts'], ['settings', 'Settings'],
  ];
  const mounted = {};
  let current = null;

  function build() {
    document.body.innerHTML = `
      <div id="titlebar"><img src="assets/icon.png" alt=""><span>AKL Live</span><span id="tb-next"></span></div>
      <div id="shell">
        <nav id="side">
          <button class="nav search-nav" id="open-palette" title="Search everything (Ctrl+K)">${A.icon('search', 20)}<span>Search</span><kbd>Ctrl K</kbd></button>
          ${VIEWS.map(([id, label], i) => `<button class="nav" data-view="${id}" title="${label} (Ctrl+${i + 1})">${A.icon(id, 22)}<span>${label}</span>${id === 'alerts' ? '<b class="badge" id="alert-badge" hidden></b>' : ''}</button>`).join('')}
          <div class="side-next" id="side-next"></div>
          ${A.desktop ? `<button class="nav mini-btn" id="open-mini" title="Desk board (Ctrl+M)">${A.icon('board', 20)}<span>Desk board</span></button>` : ''}
        </nav>
        <main id="main">${VIEWS.map(([id]) => `<section class="view" data-view="${id}" hidden></section>`).join('')}</main>
      </div>
      <div id="toast"></div>`;
    A.$$('#side .nav[data-view]').forEach((b) => { b.onclick = () => show(b.dataset.view); });
    A.$('#open-palette').onclick = () => A.palette.open();
    const mini = A.$('#open-mini');
    if (mini) mini.onclick = () => A.desktop.openMini();
    document.body.classList.toggle('desktop', !!A.desktop);
  }

  function show(id) {
    if (!A.views[id]) id = 'buses';
    if (current === id) return;
    const prev = current;
    current = id;
    if (prev && A.views[prev].hide) A.views[prev].hide();
    A.$$('#main .view').forEach((s) => { s.hidden = s.dataset.view !== id; });
    A.$$('#side .nav[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === id));
    const el = A.$(`#main .view[data-view="${id}"]`);
    if (!mounted[id]) { A.views[id].mount(el); mounted[id] = true; }
    A.views[id].show();
    requestAnimationFrame(() => A.paintPortraits(el));
    A.settings.set('view', id);
    document.title = `AKL Live · ${VIEWS.find((v) => v[0] === id)[1]}`;
  }
  A.show = show;

  // the next bus each way, always in the sidebar (and the title bar)
  function renderNext() {
    const now = T.now();
    const html = A.state.boards.map((b, i) => {
      const d = A.nextBus(b);
      return `<div class="sn-row"><i style="background:${A.pal.dir[i % 2]}"></i><span>${esc((d && d.headsign) || b.headsign || b.code)}</span>` +
             `<b ${d ? `data-exp="${d.expected}"` : ''}>${d ? A.countdown(d.expected - now) : '—'}</b></div>`;
    }).join('');
    A.$('#side-next').innerHTML = A.state.boards.length ? `<div class="sn-head">${esc(A.settings.get('route') || 'Next buses')}</div>${html}` : '';
    const first = A.state.boards.map((b) => [b, A.nextBus(b)]).filter(([, d]) => d);
    A.$('#tb-next').innerHTML = first.map(([b, d]) => `${esc(d.route)} → ${esc(d.headsign)} <b data-exp="${d.expected}">${A.countdown(d.expected - now)}</b>`).join('<span>·</span>');
  }

  function keys(e) {
    const inField = /input|textarea|select/i.test(document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (A.palette.isOpen()) A.palette.close(); else A.palette.open(); return; }
    if (A.palette.isOpen()) return;
    if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= String(VIEWS.length)) { e.preventDefault(); show(VIEWS[+e.key - 1][0]); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      A.refresh('buses'); A.refresh('trains'); A.refresh('live');
      A.toast('Refreshing…');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && current !== 'live') { e.preventDefault(); show('live'); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); show('plan'); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm' && A.desktop) { e.preventDefault(); A.desktop.openMini(); return; }
    if (e.key === 'F11' && A.desktop) { e.preventDefault(); A.desktop.toggleFullscreen(); return; }
    if (inField && e.key !== 'Escape' && !(e.ctrlKey || e.metaKey)) return;
    const v = A.views[current];
    if (v && v.key) v.key(e);
  }

  /**
   * First run without a key: what the key is for, where to get one (free), and
   * a box to paste it in. Directions and maps work without one, so it can wait.
   */
  function welcome() {
    const box = A.el(`<div class="welcome"><div class="wl-card">
      <img src="assets/icon.png" alt="">
      <h1>Kia ora! Welcome to AKL Live</h1>
      <p>Live buses, trains and ferries come from Auckland Transport's developer API. It's free, but you need your own key:</p>
      <ol><li>Sign up at <a href="https://dev-portal.at.govt.nz" target="_blank" rel="noopener">dev-portal.at.govt.nz</a></li>
        <li>Subscribe to AT's GTFS and real-time APIs (no cost)</li>
        <li>Copy your primary key from your profile and paste it here</li></ol>
      <form class="wl-in"><input type="password" placeholder="Your AT API key" spellcheck="false" autocomplete="off"><button class="btn primary" type="submit">Save</button></form>
      <div class="wl-msg" hidden></div>
      <button class="wl-skip" type="button">Look around first</button>
      <small>Directions and the maps work without a key; live times need one. You can add it any time in Settings.</small>
    </div></div>`);
    document.body.appendChild(box);
    const input = A.$('input', box), msg = A.$('.wl-msg', box), btn = A.$('button[type=submit]', box);
    const say = (text, bad) => { msg.hidden = false; msg.textContent = text; msg.classList.toggle('bad', !!bad); };
    A.$('.wl-skip', box).onclick = () => box.remove();
    A.$('form', box).onsubmit = async (e) => {
      e.preventDefault();
      const key = input.value.trim();
      if (!key) { say('Paste your key first.', true); return; }
      btn.disabled = true;
      say('Checking it with AT…');
      A.settings.set('apiKey', key);
      try {
        await A.api.get('/gtfs/v3/stops?filter%5Bstop_code%5D=8669');
        box.remove();
        A.toast('Your key works. Welcome aboard!');
        ['buses', 'trains', 'live'].forEach((k) => A.refresh(k));
        A.alerts.refresh();
      } catch (err) {
        A.settings.set('apiKey', '');
        say(err.message === 'AT rejected the API key (401)' ? "AT didn't accept that key. Check you copied the whole primary key." : err.message, true);
      }
      btn.disabled = false;
    };
    setTimeout(() => input.focus(), 50);
  }
  A.welcome = welcome;

  window.addEventListener('DOMContentLoaded', () => {
    A.applyTheme();
    build();
    A.on('buses', renderNext);
    A.on('open-model', (id) => { show('fleet'); A.views.fleet.open(id); });
    document.addEventListener('keydown', keys);
    if (A.desktop) A.desktop.onNavigate((v) => show(v));
    A.start();
    A.gtfs.start();
    A.alerts.refresh();
    setInterval(() => { if (!document.hidden) A.alerts.refresh(); }, 5 * 60000);
    setTimeout(() => A.photos.prefetch(), 5000);                // every model's photo, ready before it's needed
    A.on('alerts', () => {
      const n = A.alerts.mine().length;
      const b = A.$('#alert-badge');
      b.hidden = !n; b.textContent = n;
    });
    show(A.settings.get('view'));
    renderNext();
    if (!A.api.key()) welcome();
  });
})(window.AKL);
