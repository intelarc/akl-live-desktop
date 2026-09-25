// AKL Live for Windows: the window, the tray, notifications, the desk board,
// starting with Windows. Everything else lives in src/ (plain web pages).
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, shell, nativeTheme, screen, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Windows 11 (build 22000+): let the window's Mica material show through the chrome
const MICA = process.platform === 'win32' && +(os.release().split('.')[2] || 0) >= 22000;

const APP_ID = 'nz.aryan.akllive.desktop';        // must match build.appId, for Windows notifications
const hidden = process.argv.includes('--hidden');   // started with Windows: straight to the tray
let win = null, mini = null, tray = null, quitting = false, trayLines = [];

app.setAppUserModelId(APP_ID);
if (!app.requestSingleInstanceLock()) { app.quit(); }
/** "--view=trains" from a taskbar jump-list task; "--mini" for the desk board. */
const viewArg = (argv) => { const a = argv.find((x) => x.startsWith('--view=')); return a ? a.slice(7) : null; };
app.on('second-instance', (e, argv) => { if (argv.includes('--mini')) openMini(); else showMain(viewArg(argv)); });

// ---------- small persistent state (window place, desktop options) ----------
const stateFile = () => path.join(app.getPath('userData'), 'desktop.json');
let state = { bounds: null, maximized: false, miniBounds: null, closeToTray: true, miniOnTop: true, trayHintShown: false };
function loadState() { try { state = Object.assign(state, JSON.parse(fs.readFileSync(stateFile(), 'utf8'))); } catch (e) { /* first run */ } }
function saveState() { try { fs.writeFileSync(stateFile(), JSON.stringify(state)); } catch (e) { /* read-only? */ } }

function visibleOnScreen(b) {
  return b && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 10 && b.y < a.y + a.height - 60;
  });
}
const icon = (name) => path.join(__dirname, 'src', 'assets', name);
const dark = () => nativeTheme.shouldUseDarkColors;
const overlay = () => ({ color: MICA ? '#00000000' : dark() ? '#0B1220' : '#EEF3FA', symbolColor: dark() ? '#E6ECF7' : '#1A2744', height: 40 });
const bgColor = () => (MICA ? '#00000000' : dark() ? '#0B1220' : '#EEF3FA');

// ---------- the main window ----------
function createMain() {
  const b = visibleOnScreen(state.bounds) ? state.bounds : { width: 1440, height: 920 };
  win = new BrowserWindow({
    ...b, minWidth: 880, minHeight: 600, show: false, title: 'AKL Live', icon: icon('icon.png'),
    backgroundColor: bgColor(), ...(MICA ? { backgroundMaterial: 'mica' } : {}),
    titleBarStyle: 'hidden', titleBarOverlay: overlay(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true,
      backgroundThrottling: false,            // keep polling for alerts and the tray while hidden
      spellcheck: false,
    },
  });
  win.removeMenu();
  if (state.maximized) win.maximize();
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => { if (!hidden) win.show(); });
  const remember = () => {
    if (!win || win.isMinimized()) return;
    state.maximized = win.isMaximized();
    if (!state.maximized && !win.isFullScreen()) state.bounds = win.getBounds();
    saveState();
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('close', (e) => {
    if (quitting || !state.closeToTray) return;
    e.preventDefault();
    win.hide();
    if (!state.trayHintShown) {
      state.trayHintShown = true; saveState();
      notify('AKL Live is still running', 'It lives in the tray now, keeping alerts and the countdown going. Right-click the icon to quit.');
    }
  });
  win.on('closed', () => { win = null; if (!state.closeToTray) app.quit(); });
  lockDown(win);
  // Ctrl+Shift+I opens the developer tools, for poking at things
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools();
  });
}

/** Only our own pages load in our windows; web links open in the browser. */
function lockDown(w) {
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
}

function showMain(view) {
  if (!win) createMain();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (view) win.webContents.send('navigate', view);
}

// ---------- the desk board: a small always-on-top window ----------
function openMini() {
  if (mini) { mini.show(); mini.focus(); return; }
  const wa = screen.getPrimaryDisplay().workArea;
  const b = visibleOnScreen(state.miniBounds) ? state.miniBounds : { width: 400, height: 214, x: wa.x + wa.width - 420, y: wa.y + wa.height - 234 };
  mini = new BrowserWindow({
    ...b, minWidth: 300, minHeight: 170, frame: false, resizable: true, alwaysOnTop: state.miniOnTop, skipTaskbar: true,
    backgroundColor: '#0B1220', title: 'AKL Live · Desk board', icon: icon('icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  mini.setAlwaysOnTop(state.miniOnTop, 'floating');
  mini.loadFile(path.join(__dirname, 'src', 'mini.html'));
  mini.once('ready-to-show', () => mini.show());
  const remember = () => { if (mini) { state.miniBounds = mini.getBounds(); saveState(); } };
  mini.on('move', remember);
  mini.on('resize', remember);
  mini.on('closed', () => { mini = null; });
  lockDown(mini);
}

// ---------- tray ----------
function trayMenu() {
  const login = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    ...trayLines.map((l) => ({ label: l, enabled: false })),
    ...(trayLines.length ? [{ type: 'separator' }] : []),
    { label: 'Open AKL Live', click: () => showMain() },
    { label: 'Buses', click: () => showMain('buses') },
    { label: 'Trains', click: () => showMain('trains') },
    { label: 'Every bus (live map)', click: () => showMain('live') },
    { label: 'Desk board', click: openMini },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: login, click: (i) => setLogin(i.checked) },
    { type: 'separator' },
    { label: 'Quit AKL Live', click: () => { quitting = true; app.quit(); } },
  ]);
}
function createTray() {
  const img = nativeImage.createFromPath(icon('tray.png'));
  img.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(icon('tray@2x.png')) });
  tray = new Tray(img);
  tray.setToolTip('AKL Live');
  tray.setContextMenu(trayMenu());
  tray.on('click', () => (win && win.isVisible() && win.isFocused() ? win.hide() : showMain()));
}

function setLogin(on) {
  app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  if (tray) tray.setContextMenu(trayMenu());
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: icon('icon.png'), silent: false });
  n.on('click', () => showMain('buses'));
  n.show();
}

// ---------- messages from the pages ----------
ipcMain.on('tray:update', (e, t) => {
  if (!tray || !t) return;
  tray.setToolTip(String(t.tooltip || 'AKL Live').slice(0, 127));
  trayLines = (t.lines || []).map(String).slice(0, 6);
  tray.setContextMenu(trayMenu());
});
ipcMain.on('notify', (e, n) => notify(String(n.title || 'AKL Live'), String(n.body || '')));
ipcMain.handle('settings:get', () => ({
  openAtLogin: app.getLoginItemSettings().openAtLogin, closeToTray: state.closeToTray, miniOnTop: state.miniOnTop,
}));
ipcMain.on('settings:desktop', (e, s) => {
  if (typeof s.openAtLogin === 'boolean') setLogin(s.openAtLogin);
  if (typeof s.closeToTray === 'boolean') state.closeToTray = s.closeToTray;
  if (typeof s.miniOnTop === 'boolean') { state.miniOnTop = s.miniOnTop; if (mini) mini.setAlwaysOnTop(s.miniOnTop, 'floating'); }
  saveState();
});
ipcMain.on('mini:open', openMini);
ipcMain.on('mini:close', () => { if (mini) mini.close(); });
ipcMain.on('app:show', (e, view) => showMain(view));
ipcMain.on('win:fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.on('app:flags', (e) => { e.returnValue = { mica: MICA }; });

// ---------- AT's timetable (gtfs.zip): checked every six hours, kept for offline ----------
const GTFS_URL = 'https://gtfs.at.govt.nz/gtfs.zip';
const gtfsZipPath = () => path.join(app.getPath('userData'), 'gtfs.zip');
const gtfsMetaPath = () => path.join(app.getPath('userData'), 'gtfs.json');
let gtfsBusy = null;
async function gtfsInfo() {
  if (gtfsBusy) return gtfsBusy;
  gtfsBusy = (async () => {
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(gtfsMetaPath(), 'utf8')); } catch (e) { /* first run */ }
    const have = fs.existsSync(gtfsZipPath());
    if (have && meta && Date.now() - meta.checked < 6 * 3600 * 1000) return { etag: meta.etag };
    try {
      const head = await net.fetch(GTFS_URL, { method: 'HEAD' });
      const etag = String(head.headers.get('etag') || head.headers.get('last-modified') || Date.now()).replace(/"/g, '');
      if (!have || !meta || meta.etag !== etag) {
        const r = await net.fetch(GTFS_URL);
        if (!r.ok) throw new Error('AT timetable download failed: ' + r.status);
        fs.writeFileSync(gtfsZipPath() + '.part', Buffer.from(await r.arrayBuffer()));
        fs.renameSync(gtfsZipPath() + '.part', gtfsZipPath());
      }
      meta = { etag, checked: Date.now() };
      fs.writeFileSync(gtfsMetaPath(), JSON.stringify(meta));
      return { etag };
    } catch (e) {
      if (have && meta) return { etag: meta.etag };       // offline: yesterday's timetable is better than none
      throw e;
    }
  })();
  try { return await gtfsBusy; } finally { gtfsBusy = null; }
}
ipcMain.handle('gtfs:info', () => gtfsInfo());
ipcMain.handle('gtfs:zip', async () => {
  await gtfsInfo();
  const b = fs.readFileSync(gtfsZipPath());
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});
ipcMain.on('theme:set', (e, t) => {
  nativeTheme.themeSource = ['light', 'dark'].includes(t.mode) ? t.mode : 'system';
  if (win) { win.setTitleBarOverlay(overlay()); win.setBackgroundColor(bgColor()); }
});
nativeTheme.on('updated', () => { if (win) win.setTitleBarOverlay(overlay()); });

app.whenReady().then(() => {
  loadState();
  createMain();
  createTray();
  const v = viewArg(process.argv);
  if (v) win.webContents.once('did-finish-load', () => win.webContents.send('navigate', v));
  if (process.argv.includes('--mini')) openMini();
  // right-click the taskbar button for these
  const task = (args, title, description) => ({ program: process.execPath, arguments: args, iconPath: process.execPath, iconIndex: 0, title, description });
  app.setUserTasks([
    task('--view=buses', 'Buses', 'Your stops, live'),
    task('--view=trains', 'Trains', 'The network, live'),
    task('--view=live', 'Every bus', 'Every bus in Auckland on a map'),
    task('--mini', 'Desk board', 'The small always-on-top board'),
  ]);
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (!state.closeToTray) app.quit(); });
