const { app, BrowserWindow, ipcMain, shell, dialog, protocol, Tray, Menu } = require('electron');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const utils = require('./utils');

let downloadController = null;
let mainWindow = null;
let tray = null;
let isQuitting = false;

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

const defaultSettings = {
  gameDir: path.join(os.homedir(), 'Games', 'ArknightsEndfield'),
  downloadDir: path.join(os.homedir(), 'Games', 'ArknightsEndfield', '_download'),
  language: 'English',
  protonPath: path.join(os.homedir(), '.local', 'share', 'llauncher', 'proton'),
  launchAtStartup: false,
  minimizeToTray: true,
  afterGameLaunch: 'hide',
  nativeVulkan: true,
  wayland: true,
  gameMode: false,
  dxvkAsync: true,
  disableFsync: false,
  disableEsync: false,
  mangoHud: false,
  canonicalHole: false,
  launchArgs: '',
  customEnvVars: '# One per line, KEY=VALUE\nDXVK_HUD=fps\nMESA_SHADER_CACHE=1',
  maxConcurrentDownloads: 4,
  speedLimit: 0,
  speedLimitUnit: 'MB/s',
  // Appearance
  backgroundPath: path.join(os.homedir(), 'Downloads', 'kv_v1d1.3df4b429.jpg'),
  backgroundOffsetX: 50,
  backgroundOffsetY: 50,
  backgroundZoom: 100,
  overlayOpacity: 0.4,
};

function loadSettings() {
  return utils.loadSettings(settingsPath, defaultSettings);
}

function saveSettings(settings) {
  return utils.saveSettings(settingsPath, settings);
}

function createTray() {
  const iconPath = path.join(__dirname, '../build/icon.png');
  if (!fs.existsSync(iconPath)) return;

  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show AELauncher', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('AELauncher');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
    }
  });
}

function createWindow() {
  // Register local-resource protocol to load images from disk
  protocol.registerFileProtocol('local-resource', (request, callback) => {
    const url = request.url.replace(/^local-resource:\/\//, '');
    try {
      return callback(decodeURIComponent(url));
    } catch (error) {
      console.error(error);
    }
  });

  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 1000, minHeight: 700,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f0f0f',
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Try Vite dev server first, fallback to built dist
  const devServerUrl = 'http://localhost:5173';
  const distFile = path.join(__dirname, '../dist/index.html');

  // ELECTRON_DEV=1 is set by "npm run electron" after wait-on confirms Vite is ready
  if (process.env.ELECTRON_DEV === '1') {
    console.log('Dev mode: loading from Vite dev server...');
    mainWindow.loadURL(devServerUrl);
  } else if (!app.isPackaged) {
    // Standalone electron launch: check if Vite is running, else use dist
    const tryLoadDevServer = () => new Promise((resolve) => {
      const http = require('http');
      const req = http.get(devServerUrl, () => { req.destroy(); resolve(true); });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
    tryLoadDevServer().then((devAvailable) => {
      if (devAvailable) {
        mainWindow.loadURL(devServerUrl);
      } else if (fs.existsSync(distFile)) {
        console.log('Dev server not running, loading from dist...');
        mainWindow.loadFile(distFile);
      } else {
        mainWindow.loadURL('data:text/html,<h2>Build not found. Run: npm run dev</h2>');
      }
    });
  } else {
    mainWindow.loadFile(distFile);
  }

  mainWindow.on('close', (event) => {
    const settings = loadSettings();
    if (settings.minimizeToTray && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

// Settings
ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (event, settings) => {
  const ok = saveSettings(settings);
  return { success: ok };
});

// Browse directory
ipcMain.handle('browse-directory', async (event, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: defaultPath || os.homedir(),
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Browse file (for images)
ipcMain.handle('browse-file', async (event, { defaultPath, filters } = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    defaultPath: defaultPath || os.homedir(),
    filters: filters || [{
      name: 'Images',
      extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'],
    }],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Game info
ipcMain.handle('get-game-links', async () => {
  try {
    const response = await axios.get('https://launcher.gryphline.com/api/game/get_latest', {
      params: { appcode: 'YDUTE5gscDZ229CW', platform: 'Windows', channel: '6', sub_channel: '6' },
      timeout: 10000,
    });
    return response.data;
  } catch (error) {
    return { error: error.message };
  }
});

// Download with speed limiting and proper resume
async function downloadPart(event, { url, savePath, startByte = 0, speedLimit = 0, speedLimitUnit = 'MB/s', partIndex, totalParts, onProgress, expectedSize }) {
  const maxRetries = 3;
  let retryCount = 0;
  const partLabel = `[Part ${partIndex + 1}/${totalParts}]`;

  // Quick check locally BEFORE any network request
  if (expectedSize && startByte >= expectedSize) {
    console.log(`${partLabel} Local check: Already completed (Size: ${startByte}). Skipping network.`);
    return { downloadedBytes: startByte };
  }

  console.log(`${partLabel} Starting download. Target: ${savePath}, StartByte: ${startByte}, Expected: ${expectedSize}`);

  while (retryCount <= maxRetries) {
    try {
      // Re-check size inside retry loop in case it changed
      if (expectedSize && startByte >= expectedSize) {
        return { downloadedBytes: startByte };
      }

      const headers = {};
      if (startByte > 0) {
        headers['Range'] = `bytes=${startByte}-`;
        console.log(`${partLabel} Requesting range: ${headers['Range']}`);
      } else {
        console.log(`${partLabel} Starting from byte 0`);
      }

      const response = await axios({
        method: 'get',
        url,
        responseType: 'stream',
        headers,
        signal: downloadController?.signal,
        timeout: 60000,
      });

      console.log(`${partLabel} Server response: ${response.status} ${response.statusText}`);
      
      // Check if resume was successful or if we're starting over
      const actualStartByte = (response.status === 206) ? startByte : 0;
      if (startByte > 0 && response.status !== 206) {
        console.warn(`${partLabel} Server did not return 206 Partial Content (Status: ${response.status}). Restarting part from 0 to prevent corruption.`);
      }

      const writer = fs.createWriteStream(savePath, { flags: actualStartByte > 0 ? 'a' : 'w' });
      console.log(`${partLabel} Writing to disk with flags: ${actualStartByte > 0 ? "'a' (append)" : "'w' (overwrite)"}`);

      let partDownloaded = actualStartByte;
      let lastTime = Date.now();
      let lastBytes = actualStartByte;

      // Pipe stream to disk AND track progress
      response.data.on('data', (chunk) => {
        // CRITICAL: actually write data to disk
        writer.write(chunk);
        partDownloaded += chunk.length;
        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;

        if (elapsed >= 0.5) {
          const speed = (partDownloaded - lastBytes) / elapsed;
          onProgress(partDownloaded, speed);
          lastTime = now;
          lastBytes = partDownloaded;
        }
      });

      response.data.on('end', () => writer.end());

      return await new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log(`${partLabel} Finished writing to disk. Final size: ${partDownloaded}`);
          onProgress(partDownloaded, 0);
          resolve({ downloadedBytes: partDownloaded });
        });
        
        writer.on('error', (err) => {
          console.error(`${partLabel} Stream writer error:`, err.message);
          writer.close();
          reject(err);
        });

        response.data.on('error', (err) => {
          console.error(`${partLabel} Response data stream error:`, err.message);
          writer.close();
          reject(err);
        });

        if (downloadController) {
          downloadController.signal.addEventListener('abort', () => {
            console.log(`${partLabel} Abort signal received.`);
            writer.close();
            reject(new Error('Aborted'));
          }, { once: true });
        }
      });
    } catch (error) {
      const isCancel = axios.isCancel(error) || error.name === 'CanceledError' || error.code === 'ERR_CANCELED' || error.message === 'Aborted';
      if (isCancel) {
        console.log(`${partLabel} Download cancelled by user or new download started.`);
        throw error;
      }

      if (error.response && error.response.status === 416) {
        console.log(`${partLabel} Range Not Satisfiable (416). Assuming file is already complete.`);
        return { downloadedBytes: startByte };
      }

      console.error(`${partLabel} Error occurred:`, error.message);
      if (error.code) console.error(`${partLabel} Error code: ${error.code}`);

      retryCount++;
      if (retryCount > maxRetries) {
        console.error(`${partLabel} Max retries reached (${maxRetries}). Failing.`);
        throw error;
      }
      
      const delay = 2000 * retryCount;
      console.log(`${partLabel} Retrying in ${delay}ms... (Attempt ${retryCount}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
      
      if (fs.existsSync(savePath)) {
        startByte = fs.statSync(savePath).size;
        console.log(`${partLabel} Updated startByte from disk: ${startByte}`);
      }
    }
  }
}

ipcMain.handle('start-download', async (event, { packs, downloadDir, speedLimit, speedLimitUnit }) => {
  console.log('--- START DOWNLOAD TASK ---');
  console.log(`Packs: ${packs.length}, Directory: ${downloadDir}`);

  if (downloadController) {
    console.log('Aborting previous download controller...');
    downloadController.abort();
  }
  downloadController = new AbortController();

  if (!fs.existsSync(downloadDir)) {
    console.log(`Creating download directory: ${downloadDir}`);
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  const partSizes = packs.map((_, i) => {
    const savePath = path.join(downloadDir, `Endfield_Part_${i + 1}.zip`);
    const size = fs.existsSync(savePath) ? fs.statSync(savePath).size : 0;
    if (size > 0) console.log(`Found existing part ${i+1}: ${size} bytes`);
    return size;
  });

  const sendOverallProgress = (speed, currentPartIndex) => {
    const totalDownloaded = partSizes.reduce((a, b) => a + b, 0);
    event.sender.send('download-progress', {
      downloadedBytes: totalDownloaded,
      speed,
      partIndex: currentPartIndex,
      totalParts: packs.length
    });
  };

  try {
    for (let i = 0; i < packs.length; i++) {
      const pack = packs[i];
      const savePath = path.join(downloadDir, `Endfield_Part_${i + 1}.zip`);

      // Re-check size on disk for each part to ensure accurate resume
      const existingSize = fs.existsSync(savePath) ? fs.statSync(savePath).size : 0;
      partSizes[i] = existingSize;

      const expectedSize = parseInt(pack.package_size || '0');
      
      // Update UI that we are starting/checking this part
      sendOverallProgress(0, i);

      await downloadPart(event, {
        url: pack.url,
        savePath,
        startByte: existingSize,
        speedLimit,
        speedLimitUnit,
        partIndex: i,
        totalParts: packs.length,
        expectedSize,
        onProgress: (currentPartSize, speed) => {
          partSizes[i] = currentPartSize;
          sendOverallProgress(speed, i);
        }
      });
    }
    console.log('--- DOWNLOAD TASK COMPLETED SUCCESSFULLY ---');
    downloadController = null;
    return { status: 'done' };
  } catch (error) {
    const isCancel = axios.isCancel(error) || error.name === 'CanceledError' || error.code === 'ERR_CANCELED' || error.message === 'Aborted';
    if (isCancel) {
      console.log('--- DOWNLOAD TASK CANCELLED ---');
      return { status: 'cancelled' };
    }
    console.error('--- DOWNLOAD TASK FAILED ---');
    console.error('Error Details:', error.message);
    return { error: error.message };
  }
});

// Single-file download (used by DWProton installer)
ipcMain.handle('download-file', async (event, { url, savePath, startByte = 0 }) => {
  console.log(`[download-file] ${url} → ${savePath} (startByte: ${startByte})`);

  if (downloadController) downloadController.abort();
  downloadController = new AbortController();

  const dir = path.dirname(savePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  try {
    const headers = {};
    if (startByte > 0) headers['Range'] = `bytes=${startByte}-`;

    const response = await axios.get(url, {
      responseType: 'stream',
      headers,
      signal: downloadController.signal,
    });

    const totalFromHeader = parseInt(response.headers['content-length'] || '0');
    const totalBytes = startByte + totalFromHeader;

    const writer = fs.createWriteStream(savePath, { flags: startByte > 0 ? 'a' : 'w' });
    let downloaded = startByte;
    let lastReport = Date.now();
    let lastBytes = startByte;

    response.data.on('data', (chunk) => {
      writer.write(chunk);
      downloaded += chunk.length;
      const now = Date.now();
      if (now - lastReport >= 500) {
        const speed = ((downloaded - lastBytes) / ((now - lastReport) / 1000));
        event.sender.send('download-progress', { downloadedBytes: downloaded, totalBytes, speed });
        lastBytes = downloaded;
        lastReport = now;
      }
    });

    await new Promise((resolve, reject) => {
      response.data.on('end', () => { writer.end(); resolve(); });
      response.data.on('error', reject);
      writer.on('error', reject);
    });

    downloadController = null;
    return { status: 'done' };
  } catch (error) {
    const isCancel = axios.isCancel(error) || error.name === 'CanceledError' || error.code === 'ERR_CANCELED';
    if (isCancel) return { status: 'cancelled' };
    return { error: error.message };
  }
});

// Extract game parts (split ZIP — merge all parts then extract with 7z)
ipcMain.handle('extract-game', async (event, { downloadDir, gameDir }) => {
  if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });

  // Sort parts numerically: Part_1, Part_2 ... Part_10, Part_11 ...
  const partNames = utils.collectZipParts(downloadDir);
  if (partNames.length === 0) return { status: 'error', message: 'No zip files found to extract' };

  const partPaths = partNames
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] || '0');
      const numB = parseInt(b.match(/\d+/)?.[0] || '0');
      return numA - numB;
    })
    .map(name => path.join(downloadDir, name));

  event.sender.send('extract-progress', {
    status: 'extracting',
    message: `Merging ${partPaths.length} parts...`,
  });

  const result = await utils.extractGameParts(
    partPaths,
    gameDir,
    (msg) => event.sender.send('extract-progress', { status: 'extracting', message: msg })
  );

  return result;
});



ipcMain.handle('pause-download', () => {
  if (downloadController) {
    downloadController.abort();
    downloadController = null;
    return { status: 'paused' };
  }
  return { status: 'no_download' };
});

// Get file size for resume
ipcMain.handle('get-file-size', (event, filePath) => utils.getFileSize(filePath));

// Get how many parts are fully completed on disk
ipcMain.handle('get-completed-parts-count', (event, { packs, downloadDir }) =>
  utils.getCompletedPartsCount(packs, downloadDir)
);

// Get total downloaded bytes from disk
ipcMain.handle('get-total-downloaded', (event, { packs, downloadDir }) =>
  utils.getTotalDownloaded(packs, downloadDir)
);

// Proton versions — from dawn.wine Gitea
ipcMain.handle('get-proton-versions', async () => {
  try {
    const response = await axios.get(
      'https://dawn.wine/api/v1/repos/dawn-winery/dwproton/releases?limit=20',
      { timeout: 10000 }
    );
    return response.data.map(release => {
      const asset = release.assets.find(a =>
        a.name.endsWith('.tar.xz') && !a.name.endsWith('.torrent')
      );
      if (!asset) return null;
      return {
        version: release.name || release.tag_name,
        date: release.published_at ? release.published_at.split('T')[0] : '',
        size: (asset.size / (1024 * 1024)).toFixed(1) + ' MB',
        url: asset.browser_download_url,
        assetName: asset.name,
      };
    }).filter(Boolean);
  } catch (error) {
    return [];
  }
});

// Extract proton tar.xz into target directory
ipcMain.handle('extract-proton', async (event, { archivePath, destDir }) => {
  const result = await utils.extractProtonArchive(
    archivePath,
    destDir,
    (msg) => event.sender.send('extract-progress', { status: 'extracting', message: msg })
  );
  if (result.status === 'done') {
    event.sender.send('extract-progress', { status: 'done' });
  }
  return result;
});

// Check if proton path exists
ipcMain.handle('check-proton-path', (event, protonPath) => utils.checkProtonPath(protonPath));

// Check if game is installed
ipcMain.handle('check-game-installed', (event, gameDir) => utils.checkGameInstalled(gameDir));

// Launch game
ipcMain.handle('launch-game', async (event, { gameDir, protonPath, args, nativeVulkan, wayland, gameMode, dxvkAsync, disableFsync, disableEsync, mangoHud, canonicalHole, customEnvVars }) => {
  const exePath = path.join(gameDir, 'Endfield.exe');

  // Build env via utils
  const env = utils.buildLaunchEnv({ wayland, dxvkAsync, disableFsync, disableEsync, mangoHud, canonicalHole, customEnvVars });

  // Proton requires these two env vars
  const compatDataPath = path.join(gameDir, 'pfx'); // Wine prefix directory
  env['STEAM_COMPAT_DATA_PATH'] = compatDataPath;
  env['STEAM_COMPAT_CLIENT_INSTALL_PATH'] = protonPath || '';

  // Create prefix dir if needed
  if (!fs.existsSync(compatDataPath)) fs.mkdirSync(compatDataPath, { recursive: true });

  // Build command: [gamemoderun] [proton run] exe [-vulkan] [args...]
  const cmd = [];
  if (gameMode) cmd.push('gamemoderun');

  const protonBin = protonPath && fs.existsSync(path.join(protonPath, 'proton'))
    ? path.join(protonPath, 'proton')
    : null;

  if (protonBin) {
    cmd.push(protonBin, 'run');
  } else {
    console.warn('[launch-game] protonPath not found, launching exe directly:', protonPath);
  }

  cmd.push(exePath);
  if (nativeVulkan) cmd.push('-vulkan');
  if (args) cmd.push(...args.split(' ').filter(Boolean));

  console.log('[launch-game] Command:', cmd.join(' '));
  console.log('[launch-game] STEAM_COMPAT_DATA_PATH:', compatDataPath);

  const [bin, ...binArgs] = cmd;
  const child = spawn(bin, binArgs, { env, cwd: gameDir, detached: true, stdio: 'ignore' });
  child.unref();

  return { status: 'launched', pid: child.pid };
});


ipcMain.on('open-external', (event, url) => shell.openExternal(url));

// Window controls
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());
