// Settings: your stops, alerts, appearance, the desktop app, keys, about.
(function (A) {
  'use strict';
  const esc = A.esc;
  const V = {};
  let root, desk = null;

  V.mount = function (el) {
    root = el;
    render();
    if (A.desktop) A.desktop.getDesktopSettings().then((d) => { desk = d; render(); });
  };
  V.show = function () {};
  V.hide = function () {};

  function field(label, input, help) {
    return `<label class="field"><span>${label}</span>${input}${help ? `<small>${help}</small>` : ''}</label>`;
  }
  function toggle(id, on, label, help) {
    return `<label class="toggle-row"><span><b>${label}</b>${help ? `<small>${help}</small>` : ''}</span>` +
           `<input type="checkbox" id="${id}" ${on ? 'checked' : ''}><i class="switch"></i></label>`;
  }
  function seg(id, value, opts) {
    return `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === value ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  }

  function render() {
    const S = A.settings;
    const key = A.api.key();
    const alerts = S.get('alerts') || {};
    root.innerHTML = `
      <div class="page settings">
        <header class="page-head"><div><h1>Settings</h1><div class="sub">Saved on this computer</div></div></header>
        <div class="settings-grid">
          <section class="card"><h2>Your stops</h2>
            ${field('Bus stop numbers', `<input id="s-stops" value="${esc(S.get('stops').join(', '))}">`, 'The number on the stop sign, comma-separated. 8669 is Aldersgate Rd to the city, 8664 the other way.')}
            ${field('Route', `<input id="s-route" value="${esc(S.get('route'))}">`, 'Leave empty to show every route at those stops.')}
            ${field('Place name', `<input id="s-place" value="${esc(S.get('place'))}">`)}
            <button class="btn primary" id="s-save">Save stops</button>
          </section>

          <section class="card"><h2>Saved places</h2>
            <p class="help">For directions: pick them from the list or type an address, a place or a stop.</p>
            ${['home', 'work'].map((k) => {
              const p = k === 'home' ? A.settings.get('home') : A.settings.get('work');
              return `<div class="field place-field"><span>${k === 'home' ? '🏠 Home' : '💼 Work'}</span>
                <div class="pf-row"><input id="s-${k}" value="${esc(p ? p.name : '')}" placeholder="${k === 'home' ? esc((A.places.home() || {}).sub || 'Search') : 'Search an address or place'}" autocomplete="off">
                ${p ? `<button class="btn small" data-clear="${k}">Clear</button>` : ''}</div><div class="suggest" id="s-${k}-sug" hidden></div>
                ${p ? `<small>${esc(p.sub || '')}</small>` : k === 'home' ? '<small>Until you set one, home is your first bus stop.</small>' : ''}</div>`;
            }).join('')}
          </section>

          <section class="card"><h2>Alerts</h2>
            <p class="help">A Windows notification before each bus, so you know when to head out. Turn it on per direction with the bell on its card, or here.</p>
            ${A.state.boards.map((b) => toggle('s-alert-' + b.code, !!alerts[b.code], `${esc(A.settings.get('route'))} to ${esc(b.headsign || b.code)}`, `${esc(b.name || '')} · stop ${esc(b.code)}`)).join('')}
            <div class="two">
              ${field('Alert me this many minutes before', `<input type="number" min="1" max="30" id="s-alertmin" value="${S.get('alertMin')}">`)}
              ${field('Walk to the stop takes (min)', `<input type="number" min="0" max="30" id="s-walk" value="${S.get('walkMin')}">`, 'Used for "leave in 3 min".')}
            </div>
            <button class="btn" id="s-test">Send a test alert</button>
          </section>

          <section class="card"><h2>Appearance</h2>
            <div class="row-label">Theme</div>${seg('s-theme', S.get('theme'), [['system', 'Match Windows'], ['light', 'Light'], ['dark', 'Dark']])}
            <div class="row-label">Colour theme</div>
            <div class="palettes" id="s-palette">${A.PALETTES.map(([id, name, blurb, col]) =>
              `<button class="pal-opt${S.get('palette') === id ? ' on' : ''}" data-p="${id}" style="--c:${col}"><i></i><span><b>${name}</b><small>${blurb}</small></span></button>`).join('')}</div>
            <div class="row-label">Maps</div>${seg('s-basemap', S.get('basemap'), [['satellite', 'Satellite'], ['streets', 'Street map']])}
            ${toggle('s-kiwi', S.get('kiwi') !== false, 'Kiwi mode', 'Te reo greetings (Mōrena, Kia ora, Pō mārie) and a bit of local slang, like the Android app.')}
          </section>

          ${A.desktop ? `<section class="card"><h2>Desktop</h2>
            ${toggle('s-login', desk && desk.openAtLogin, 'Start with Windows', 'Opens quietly in the tray when you sign in, ready with alerts.')}
            ${toggle('s-tray', !desk || desk.closeToTray, 'Keep running in the tray when closed', 'Closing the window keeps alerts and the tray countdown going. Quit from the tray icon.')}
            ${toggle('s-ontop', !desk || desk.miniOnTop, 'Desk board stays on top', 'The small always-visible departure board (Ctrl+M).')}
            <button class="btn" id="s-mini">${A.icon('board', 16)} Open the desk board</button>
          </section>` : ''}

          <section class="card"><h2>Keys</h2>
            ${field('AT API key', `<input type="password" id="s-key" placeholder="${A.api.builtIn() ? 'Using the key built into this app' : 'Paste your key'}" value="${esc(S.get('apiKey'))}">`,
              A.api.builtIn() && !S.get('apiKey') ? `Using the built-in key (ends …${esc(key.slice(-4))}). Paste another to override it.` : key ? `A key is set (ends …${esc(key.slice(-4))}).` : 'Get a free key at dev-portal.at.govt.nz.')}
            ${field('LINZ Basemaps key (optional)', `<input type="password" id="s-linz" value="${esc(S.get('linzKey'))}" placeholder="Esri imagery without one">`,
              'With a free key from basemaps.linz.govt.nz the satellite maps use Toitū Te Whenua LINZ\'s aerials, down to 7.5 cm.')}
            <button class="btn primary" id="s-savekeys">Save keys</button>
          </section>

          <section class="card about"><h2>About</h2>
            <div class="about-row"><img src="assets/icon.png" alt=""><div><b>AKL Live for Windows</b><small id="s-version">${A.desktop ? '' : 'Browser preview'}</small></div></div>
            <p class="help">Live data from the Auckland Transport developer API; not affiliated with Auckland Transport. Maps by MapLibre with imagery from Esri or LINZ and streets from OpenFreeMap / OpenStreetMap. Weather by Open-Meteo.com (CC BY 4.0). Bus models and fleet numbers from the AT Metro Wiki (CC BY-SA). The train map is drawn from the track shapes in AT's timetable; the bus scenes are inspired by MSMGreen/at-departure-board.</p>
            <div class="keys-help"><b>Shortcuts</b><span><kbd>Ctrl</kbd>+<kbd>1</kbd>–<kbd>9</kbd> switch screens</span><span><kbd>Ctrl</kbd>+<kbd>K</kbd> search</span><span><kbd>Ctrl</kbd>+<kbd>D</kbd> directions</span><span><kbd>Ctrl</kbd>+<kbd>R</kbd> refresh</span>
              <span><kbd>Ctrl</kbd>+<kbd>F</kbd> search every bus</span><span><kbd>Ctrl</kbd>+<kbd>M</kbd> desk board</span><span><kbd>F11</kbd> full screen</span><span><kbd>Esc</kbd> close</span></div>
          </section>
        </div>
      </div>`;
    wire();
    if (A.desktop) A.desktop.version().then((v) => { const e = A.$('#s-version', root); if (e) e.textContent = 'Version ' + v; });
  }

  function wire() {
    const S = A.settings;
    for (const k of ['home', 'work']) {
      A.placeInput(A.$('#s-' + k, root), A.$('#s-' + k + '-sug', root), (p) => {
        S.set(k, { name: p.name, sub: p.sub, lat: p.lat, lon: p.lon, type: k, code: p.code, id: p.id });
        A.toast(`${k === 'home' ? 'Home' : 'Work'} saved`);
        render();
      });
    }
    A.$$('[data-clear]', root).forEach((b) => { b.onclick = () => { S.set(b.dataset.clear, null); render(); }; });
    A.$('#s-save', root).onclick = () => {
      const stops = A.$('#s-stops', root).value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      if (!stops.length) { A.toast('Add at least one stop number'); return; }
      S.set('stops', stops);
      S.set('route', A.$('#s-route', root).value.trim());
      S.set('place', A.$('#s-place', root).value.trim() || 'Home');
      A.toast('Saved. Loading your stops…');
    };
    for (const b of A.state.boards) {
      const e = A.$('#s-alert-' + b.code, root);
      if (e) e.onchange = () => { const a = Object.assign({}, S.get('alerts')); a[b.code] = e.checked; S.set('alerts', a); };
    }
    A.$('#s-alertmin', root).onchange = (e) => S.set('alertMin', Math.max(1, Math.min(30, +e.target.value || 5)));
    A.$('#s-walk', root).onchange = (e) => S.set('walkMin', Math.max(0, Math.min(30, +e.target.value || 0)));
    A.$('#s-test', root).onclick = () => {
      const title = `${S.get('route') || 'Your bus'} in ${S.get('alertMin')} min`;
      const body = 'This is what an alert looks like.';
      if (A.desktop) A.desktop.notify(title, body);
      else if (window.Notification) Notification.requestPermission().then((p) => { if (p === 'granted') new Notification(title, { body }); });
    };
    A.$$('#s-theme button', root).forEach((b) => { b.onclick = () => { S.set('theme', b.dataset.v); render(); }; });
    A.$$('#s-basemap button', root).forEach((b) => { b.onclick = () => { S.set('basemap', b.dataset.v); render(); }; });
    A.$$('#s-palette [data-p]', root).forEach((b) => { b.onclick = () => { S.set('palette', b.dataset.p); render(); }; });
    A.$('#s-kiwi', root).onchange = (e) => { S.set('kiwi', e.target.checked); A.refresh('buses'); };
    A.$('#s-savekeys', root).onclick = () => {
      S.set('apiKey', A.$('#s-key', root).value.trim());
      S.set('linzKey', A.$('#s-linz', root).value.trim());
      A.toast('Keys saved');
      render();
    };
    if (A.desktop) {
      const push = () => {
        desk = { openAtLogin: A.$('#s-login', root).checked, closeToTray: A.$('#s-tray', root).checked, miniOnTop: A.$('#s-ontop', root).checked };
        A.desktop.setDesktopSettings(desk);
      };
      ['#s-login', '#s-tray', '#s-ontop'].forEach((id) => { A.$(id, root).onchange = push; });
      A.$('#s-mini', root).onclick = () => A.desktop.openMini();
    }
  }

  A.on('buses', () => { if (root && !A.$('#s-stops:focus', root) && !root.contains(document.activeElement)) { /* keep the alert list fresh */ if (!A.$('#s-alert-' + ((A.state.boards[0] || {}).code || 'x'), root)) render(); } });
  (A.views = A.views || {}).settings = V;
})(window.AKL);
