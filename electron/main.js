const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

let downloadController = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 1000, minHeight: 700,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true,
    },
  });

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

ipcMain.handle('get-game-links', async () => {
  try {
    const response = await axios.get('https://launcher.gryphline.com/api/game/get_latest', {
      params: { appcode: 'YDUTE5gscDZ229CW', platform: 'Windows', channel: '6', sub_channel: '6' }
    });
    return response.data;
  } catch (error) { return { error: error.message }; }
});

ipcMain.handle('start-download', async (event, { url, savePath, startByte = 0 }) => {
  if (downloadController) downloadController.abort();
  downloadController = new AbortController();
  try {
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
      headers: { Range: 'bytes=' + startByte + '-' },
      signal: downloadController.signal
    });
    const writer = fs.createWriteStream(savePath, { flags: startByte > 0 ? 'a' : 'w' });
    let downloadedBytes = startByte;
    response.data.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      event.sender.send('download-progress', { downloadedBytes });
    });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    if (axios.isCancel(error)) return { status: 'cancelled' };
    return { error: error.message };
  }
});

ipcMain.handle('pause-download', () => {
  if (downloadController) {
    downloadController.abort();
    downloadController = null;
    return { status: 'paused' };
  }
});

ipcMain.handle('get-proton-versions', async () => {
  try {
    const response = await axios.get('https://api.github.com/repos/dawn-winery/dwproton-mirror/releases');
    return response.data.map(release => ({
      version: release.name,
      url: release.assets.find(a => a.name.endsWith('.tar.gz'))?.browser_download_url
    })).filter(p => p.url).slice(0, 5);
  } catch (error) { return []; }
});

ipcMain.on('open-external', (event, url) => shell.openExternal(url));
