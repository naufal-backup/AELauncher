const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Game
  getGameLinks: () => ipcRenderer.invoke('get-game-links'),

  // Download
  startDownload: (args) => ipcRenderer.invoke('start-download', args),
  pauseDownload: () => ipcRenderer.invoke('pause-download'),
  extractGame: (args) => ipcRenderer.invoke('extract-game', args),
  getFileSize: (filePath) => ipcRenderer.invoke('get-file-size', filePath),
  getTotalDownloaded: (args) => ipcRenderer.invoke('get-total-downloaded', args),
  getCompletedPartsCount: (args) => ipcRenderer.invoke('get-completed-parts-count', args),
  onDownloadProgress: (callback) =>
    ipcRenderer.on('download-progress', (event, data) => callback(data)),
  removeDownloadProgress: () =>
    ipcRenderer.removeAllListeners('download-progress'),
  onExtractProgress: (callback) =>
    ipcRenderer.on('extract-progress', (event, data) => callback(data)),
  removeExtractProgress: () =>
    ipcRenderer.removeAllListeners('extract-progress'),

  // Proton
  getProtonVersions: () => ipcRenderer.invoke('get-proton-versions'),
  checkProtonPath: (p) => ipcRenderer.invoke('check-proton-path', p),
  extractProton: (args) => ipcRenderer.invoke('extract-proton', args),
  downloadFile: (args) => ipcRenderer.invoke('download-file', args),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Browse
  browseDirectory: (defaultPath) => ipcRenderer.invoke('browse-directory', defaultPath),
  browseFile: (opts) => ipcRenderer.invoke('browse-file', opts),

  // Launch
  checkGameInstalled: (gameDir) => ipcRenderer.invoke('check-game-installed', gameDir),
  launchGame: (opts) => ipcRenderer.invoke('launch-game', opts),

  // Misc
  openExternal: (url) => ipcRenderer.send('open-external', url),

  // Window controls
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
});
