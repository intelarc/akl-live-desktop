// The shell: title bar, sidebar, switching screens, keyboard shortcuts.
(function (A) {
  'use strict';
  const esc = A.esc, T = A.time;
  const VIEWS = [
    ['buses', 'Buses'], ['trains', 'Trains'], ['live', 'Live'], ['fleet', 'Fleet'], ['settings', 'Settings'],
  ];
  const mounted = {};
  let current = null;

  function build() {
    document.body.innerHTML = `
      <div id="titlebar"><img src="assets/icon.png" alt=""><span>AKL Live</span><span id="tb-next"></span></div>
      <div id="shell">
        <nav id="side">
          ${VIEWS.map(([id, label], i) => `<button class="nav" data-view="${id}" title="${label} (Ctrl+${i + 1})">${A.icon(id, 22)}<span>${label}</span></button>`).join('')}
          <div class="side-next" id="side-next"></div>
          ${A.desktop ? `<button class="nav mini-btn" id="open-mini" title="Desk board (Ctrl+M)">${A.icon('board', 20)}<span>Desk board</span></button>` : ''}
        </nav>
        <main id="main">${VIEWS.map(([id]) => `<section class="view" data-view="${id}" hidden></section>`).join('')}</main>
      </div>
      <div id="toast"></div>`;
    A.$$('#side .nav[data-view]').forEach((b) => { b.onclick = () => show(b.dataset.view); });
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
    if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '5') { e.preventDefault(); show(VIEWS[+e.key - 1][0]); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      A.refresh('buses'); A.refresh('trains'); A.refresh('live');
      A.toast('Refreshing…');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && current !== 'live') { e.preventDefault(); show('live'); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm' && A.desktop) { e.preventDefault(); A.desktop.openMini(); return; }
    if (e.key === 'F11' && A.desktop) { e.preventDefault(); A.desktop.toggleFullscreen(); return; }
    if (inField && e.key !== 'Escape' && !(e.ctrlKey || e.metaKey)) return;
    const v = A.views[current];
    if (v && v.key) v.key(e);
  }

  window.addEventListener('DOMContentLoaded', () => {
    A.applyTheme();
    build();
    A.on('buses', renderNext);
    A.on('open-model', (id) => { show('fleet'); A.views.fleet.open(id); });
    document.addEventListener('keydown', keys);
    if (A.desktop) A.desktop.onNavigate((v) => show(v));
    A.start();
    show(A.settings.get('view'));
    renderNext();
    if (!A.api.key()) { show('settings'); A.toast('Add your AT API key to get started'); }
  });
})(window.AKL);
