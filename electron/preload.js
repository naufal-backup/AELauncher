const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Game
  getGameLinks: () => ipcRenderer.invoke('get-game-links'),

  // Download
  startDownload: (args) => ipcRenderer.invoke('start-download', args),
  pauseDownload: () => ipcRenderer.invoke('pause-download'),
  getFileSize: (filePath) => ipcRenderer.invoke('get-file-size', filePath),
  onDownloadProgress: (callback) =>
    ipcRenderer.on('download-progress', (event, data) => callback(data)),
  removeDownloadProgress: () =>
    ipcRenderer.removeAllListeners('download-progress'),

  // Proton
  getProtonVersions: () => ipcRenderer.invoke('get-proton-versions'),
  checkProtonPath: (p) => ipcRenderer.invoke('check-proton-path', p),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Browse
  browseDirectory: (defaultPath) => ipcRenderer.invoke('browse-directory', defaultPath),

  // Launch
  launchGame: (opts) => ipcRenderer.invoke('launch-game', opts),

  // Misc
  openExternal: (url) => ipcRenderer.send('open-external', url),
});
