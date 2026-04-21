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
  protonPath: path.join(os.homedir(), '.local', 'share', 'aelauncher', 'proton'),
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
  backgroundPath: path.join(app.getPath('userData'), 'backgrounds', 'kv_v1d2.f352a0f9.jpg'),
  backgroundOffsetX: 50,
  backgroundOffsetY: 50,
  backgroundZoom: 100,
  overlayOpacity: 0.4,
};

const DEFAULT_BG_URL = 'https://web-static.hg-cdn.com/endfield/official-v4/_next/static/media/kv_v1d2.f352a0f9.jpg';

async function checkAndUpdateBackground() {
  const settings = loadSettings();
  const bgDir = path.join(app.getPath('userData'), 'backgrounds');
  
  if (!fs.existsSync(bgDir)) fs.mkdirSync(bgDir, { recursive: true });

  // 1. Ensure we have at least the default background
  if (!fs.existsSync(settings.backgroundPath)) {
    console.log('Default background missing, downloading...');
    const ok = await utils.downloadImage(DEFAULT_BG_URL, settings.backgroundPath);
    if (ok && mainWindow) {
      mainWindow.webContents.send('settings-updated', loadSettings());
    }
  }

  // 2. Check for updates from the official site
  try {
    const latestUrl = await utils.findLatestBackground();
    if (latestUrl && !latestUrl.includes(path.basename(settings.backgroundPath))) {
      console.log('New background detected:', latestUrl);
      const newFilename = path.basename(latestUrl);
      const newPath = path.join(bgDir, newFilename);

      if (!fs.existsSync(newPath)) {
        const ok = await utils.downloadImage(latestUrl, newPath);
        if (ok) {
          settings.backgroundPath = newPath;
          saveSettings(settings);
          console.log('Background auto-updated to:', newFilename);
          if (mainWindow) {
            mainWindow.webContents.send('settings-updated', settings);
          }
        }
      } else {
        // File exists but not set as current
        settings.backgroundPath = newPath;
        saveSettings(settings);
        if (mainWindow) {
          mainWindow.webContents.send('settings-updated', settings);
        }
      }
    }
  } catch (error) {
    console.error('Auto-update background failed:', error.message);
  }
}

function loadSettings() {
  return utils.loadSettings(settingsPath, defaultSettings);
}

function saveSettings(settings) {
  return utils.saveSettings(settingsPath, settings);
}

function createTray() {
  let iconPath = path.join(__dirname, 'icon.png');
  
  // If packaged, use the unpacked version for better compatibility with Linux tray
  if (app.isPackaged) {
    iconPath = path.join(__dirname, 'icon.png').replace('app.asar', 'app.asar.unpacked');
  }

  console.log('Creating tray with icon:', iconPath);

  if (!fs.existsSync(iconPath)) {
    console.warn('Tray icon not found at:', iconPath);
    // On some Linux systems, the tray might not show up without a valid icon
    // But we should still initialize it if possible, or at least not return early
    // if we want to handle the 'isQuitting' logic via a tray menu.
    // However, Tray(null) is not allowed. 
  }

  try {
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
        mainWindow?.focus();
      }
    });
  } catch (e) {
    console.error('Failed to create tray:', e.message);
  }
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
  checkAndUpdateBackground();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
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
    // CRITICAL: Check if already aborted before starting/retrying
    if (downloadController?.signal.aborted) {
      throw new Error('Aborted');
    }

    try {
      // Re-check size inside retry loop in case it changed
      if (expectedSize && startByte >= expectedSize) {
        return { downloadedBytes: startByte };
      }

      const headers = {};
      if (startByte > 0) {
        headers['Range'] = `bytes=${startByte}-`;
      }

      // Capture the current controller to ensure we use the same one throughout this attempt
      const currentController = downloadController;

      const response = await axios({
        method: 'get',
        url,
        responseType: 'stream',
        headers,
        signal: currentController?.signal,
        timeout: 60000,
      });

      console.log(`${partLabel} Server response: ${response.status}`);
      
      const actualStartByte = (response.status === 206) ? startByte : 0;
      const writer = fs.createWriteStream(savePath, { flags: actualStartByte > 0 ? 'a' : 'w' });

      let partDownloaded = actualStartByte;
      let lastTime = Date.now();
      let lastBytes = actualStartByte;

      return await new Promise((resolve, reject) => {
        const onAbort = () => {
          console.log(`${partLabel} Abort signal received. Killing traffic...`);
          
          // Force destroy the request and the stream
          if (response.request) response.request.destroy();
          if (response.data) {
            response.data.destroy();
            if (response.data.socket) response.data.socket.destroy();
          }
          
          writer.destroy();
          reject(new Error('Aborted'));
        };

        if (currentController) {
          currentController.signal.addEventListener('abort', onAbort, { once: true });
        }

        response.data.on('data', (chunk) => {
          if (currentController?.signal.aborted) return;
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

        response.data.on('end', () => {
          if (currentController) {
            currentController.signal.removeEventListener('abort', onAbort);
          }
          writer.end();
        });

        writer.on('finish', () => {
          onProgress(partDownloaded, 0);
          resolve({ downloadedBytes: partDownloaded });
        });
        
        writer.on('error', (err) => {
          if (currentController) currentController.signal.removeEventListener('abort', onAbort);
          writer.close();
          reject(err);
        });

        response.data.on('error', (err) => {
          if (currentController) currentController.signal.removeEventListener('abort', onAbort);
          writer.close();
          reject(err);
        });
      });
    } catch (error) {
      const isCancel = axios.isCancel(error) || error.name === 'CanceledError' || error.code === 'ERR_CANCELED' || error.message === 'Aborted';
      if (isCancel || downloadController?.signal.aborted) {
        throw new Error('Aborted');
      }

      if (error.response && error.response.status === 416) {
        return { downloadedBytes: startByte };
      }

      retryCount++;
      if (retryCount > maxRetries) throw error;
      
      const delay = 2000 * retryCount;
      console.log(`${partLabel} Retrying in ${delay}ms... (Attempt ${retryCount}/${maxRetries})`);
      
      // Wait for delay, but allow it to be interrupted by abort
      await new Promise(resolve => {
        const timer = setTimeout(resolve, delay);
        downloadController?.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      
      if (fs.existsSync(savePath)) {
        startByte = fs.statSync(savePath).size;
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

    // Use the same robust abort logic
    const currentController = downloadController;

    return await new Promise((resolve, reject) => {
      const onAbort = () => {
        if (response.request) response.request.destroy();
        if (response.data) {
          response.data.destroy();
          if (response.data.socket) response.data.socket.destroy();
        }
        writer.destroy();
        reject(new Error('Aborted'));
      };

      currentController.signal.addEventListener('abort', onAbort, { once: true });

      response.data.on('data', (chunk) => {
        if (currentController.signal.aborted) return;
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

      response.data.on('end', () => {
        currentController.signal.removeEventListener('abort', onAbort);
        writer.end();
      });

      writer.on('finish', () => resolve({ status: 'done' }));
      writer.on('error', reject);
      response.data.on('error', reject);
    });
  } catch (error) {
    const isCancel = axios.isCancel(error) || error.name === 'CanceledError' || error.code === 'ERR_CANCELED';
    if (isCancel) return { status: 'cancelled' };
    return { error: error.message };
  }
});

// Extract game parts (split ZIP — merge all parts then extract with 7z)
ipcMain.handle('extract-game', async (event, { downloadDir, gameDir, packs, speedLimit, speedLimitUnit, version }) => {
  if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });

  // --- STEP 1: AUTOMATIC INTEGRITY CHECK & RECOVERY ---
  let allMatch = false;
  while (!allMatch) {
    allMatch = true;
    for (let i = 0; i < packs.length; i++) {
      const pack = packs[i];
      const savePath = path.join(downloadDir, `Endfield_Part_${i + 1}.zip`);
      
      event.sender.send('extract-progress', {
        status: 'extracting',
        message: `Checking Part ${i + 1}/${packs.length}...`,
      });

      const exists = fs.existsSync(savePath);
      const sizeMatch = exists && fs.statSync(savePath).size >= parseInt(pack.package_size || '0');
      
      let needsRedownload = !exists || !sizeMatch;

      // Only check MD5 if size matches to save time
      if (!needsRedownload) {
        const currentMd5 = await utils.calculateMD5(savePath);
        if (currentMd5 !== pack.md5) {
          console.warn(`MD5 Mismatch for Part ${i + 1}. Expected ${pack.md5}, got ${currentMd5}`);
          needsRedownload = true;
          try { fs.unlinkSync(savePath); } catch (e) {}
        }
      }

      if (needsRedownload) {
        allMatch = false;
        console.log(`Part ${i + 1} is missing or corrupt. Redownloading...`);
        event.sender.send('extract-progress', {
          status: 'extracting',
          message: `Redownloading Part ${i + 1}...`,
        });

        // Use existing downloadPart logic to recover this specific part
        try {
          if (!downloadController) downloadController = new AbortController();
          await downloadPart(event, {
            url: pack.url,
            savePath,
            startByte: 0,
            speedLimit,
            speedLimitUnit,
            partIndex: i,
            totalParts: packs.length,
            expectedSize: parseInt(pack.package_size || '0'),
            onProgress: (currentPartSize, speed) => {
              event.sender.send('download-progress', {
                downloadedBytes: utils.getTotalDownloaded(packs, downloadDir),
                speed,
                partIndex: i,
                totalParts: packs.length
              });
            }
          });
        } catch (err) {
          return { status: 'error', message: `Failed to recover Part ${i + 1}: ${err.message}` };
        }
        // Break inner loop to re-verify from the beginning or continue to next part
      }
    }
  }

  // --- STEP 2: PROCEED TO EXTRACTION ---
  event.sender.send('extract-progress', {
    status: 'extracting',
    message: 'All files verified. Merging...',
  });

  const partNames = utils.collectZipParts(downloadDir);
  const partPaths = partNames.map(name => path.join(downloadDir, name));

  const result = await utils.extractGameParts(
    partPaths,
    gameDir,
    (msg) => event.sender.send('extract-progress', { status: 'extracting', message: msg })
  );

  // --- STEP 3: CLEANUP DOWNLOAD PARTS ON SUCCESS ---
  if (result.status === 'done') {
    console.log('[Extract] Extraction successful. Cleaning up download parts...');
    
    // Save the game version
    if (version) {
      utils.saveLocalGameVersion(gameDir, version);
    }

    event.sender.send('extract-progress', { status: 'extracting', message: 'Cleaning up...' });
    
    for (const partPath of partPaths) {
      try {
        if (fs.existsSync(partPath)) {
          fs.unlinkSync(partPath);
        }
      } catch (e) {
        console.error(`Failed to delete part ${partPath}:`, e.message);
      }
    }
    console.log('[Extract] Cleanup complete.');
  }

  return result;
});

ipcMain.handle('get-local-version', (event, gameDir) => utils.getLocalGameVersion(gameDir));



ipcMain.handle('pause-download', () => {
  if (downloadController) {
    downloadController.abort();
    // Do not nullify here, let the download loop catch the abort
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
ipcMain.on('window-close', () => {
  const settings = loadSettings();
  if (settings.minimizeToTray) {
    mainWindow?.hide();
  } else {
    isQuitting = true;
    mainWindow?.close();
  }
});

// Check if a process (game) is still running by PID
ipcMain.handle('is-process-running', (event, pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0); // signal 0 = existence check, no actual signal sent
    return true;
  } catch (e) {
    return false; // ESRCH = no such process
  }
});
