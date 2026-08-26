const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashboard', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  getStats: () => ipcRenderer.invoke('stats:get'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  getWallpaper: () => ipcRenderer.invoke('wallpaper:get')
});
