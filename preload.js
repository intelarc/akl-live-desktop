// The only things our pages can ask of Windows.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  flags: ipcRenderer.sendSync('app:flags'),
  gtfsInfo: () => ipcRenderer.invoke('gtfs:info'),
  gtfsZip: () => ipcRenderer.invoke('gtfs:zip'),
  setTray: (t) => ipcRenderer.send('tray:update', t),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  getDesktopSettings: () => ipcRenderer.invoke('settings:get'),
  setDesktopSettings: (s) => ipcRenderer.send('settings:desktop', s),
  openMini: () => ipcRenderer.send('mini:open'),
  closeMini: () => ipcRenderer.send('mini:close'),
  showMain: (view) => ipcRenderer.send('app:show', view),
  toggleFullscreen: () => ipcRenderer.send('win:fullscreen'),
  setTheme: (mode) => ipcRenderer.send('theme:set', { mode }),
  version: () => ipcRenderer.invoke('app:version'),
  onNavigate: (fn) => ipcRenderer.on('navigate', (e, view) => fn(view)),
});
