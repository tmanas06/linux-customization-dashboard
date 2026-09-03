const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashboard', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  getStats: () => ipcRenderer.invoke('stats:get'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  getWallpaper: () => ipcRenderer.invoke('wallpaper:get'),
  winMinimize: () => ipcRenderer.invoke('win:minimize'),
  winMaximize: () => ipcRenderer.invoke('win:maximize'),
  winClose: () => ipcRenderer.invoke('win:close'),
  listDirs: () => ipcRenderer.invoke('sys:dirs'),
  openPath: (p) => ipcRenderer.invoke('fs:openPath', p),
  readProc: (path) => ipcRenderer.invoke('sys:readProc', path),
  getNetStats: () => ipcRenderer.invoke('sys:netStats'),
  getDiskStats: () => ipcRenderer.invoke('sys:diskStats'),
  getCpuTemp: () => ipcRenderer.invoke('sys:cpuTemp')
});
