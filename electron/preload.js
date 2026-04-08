const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  getGameLinks: () => ipcRenderer.invoke('get-game-links'),
  startDownload: (args) => ipcRenderer.invoke('start-download', args),
  pauseDownload: () => ipcRenderer.invoke('pause-download'),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
  getProtonVersions: () => ipcRenderer.invoke('get-proton-versions'),
  openExternal: (url) => ipcRenderer.send('open-external', url)
});
