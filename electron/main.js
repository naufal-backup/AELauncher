const { app, BrowserWindow, ipcMain, shell, dialog, protocol, Tray, Menu } = require('electron');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

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
  try {
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return { ...defaultSettings, ...data };
    }
  } catch (e) { console.error('Failed to load settings:', e); }
  return { ...defaultSettings };
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return true;
  } catch (e) {
    console.error('Failed to save settings:', e);
    return false;
  }
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  console.log('Creating tray with icon:', iconPath);
  if (!fs.existsSync(iconPath)) {
    console.error('Tray icon not found at:', iconPath);
    return;
  }

  try {
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show AELauncher', click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        }
      },
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
    console.log('Tray created successfully');
  } catch (e) {
    console.error('Failed to create tray:', e);
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

  const iconPath = path.join(__dirname, 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 1000, minHeight: 700,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f0f0f',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('close', (event) => {
    const settings = loadSettings();
    if (settings.minimizeToTray && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
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
<<<<<<< HEAD
async function downloadPart(event, { url, savePath, startByte = 0, speedLimit = 0, speedLimitUnit = 'MB/s', partIndex, totalParts, onProgress, expectedSize }) {
  const maxRetries = 3;
  let retryCount = 0;
  const partLabel = `[Part ${partIndex + 1}/${totalParts}]`;
=======
async function downloadPart(event, { url, savePath, startByte = 0, speedLimit = 0, speedLimitUnit = 'MB/s', partIndex, totalParts, overallDownloaded, expectedSize }) {
  // If we already have the full file, just return its size
  if (expectedSize && startByte >= expectedSize) {
    return { downloadedBytes: startByte };
  }
>>>>>>> parent of f9d75c2 (fix: Consolidate multi-part download progress into a single bar)

  console.log(`${partLabel} Starting download. Target: ${savePath}, StartByte: ${startByte}, Expected: ${expectedSize}`);

<<<<<<< HEAD
  while (retryCount <= maxRetries) {
    try {
      if (expectedSize && startByte >= expectedSize) {
        console.log(`${partLabel} Already completed (Size: ${startByte}). Skipping.`);
        return { downloadedBytes: startByte };
=======
  try {
    const response = await axios({
      method: 'get',
      url,
      responseType: 'stream',
      headers,
      signal: downloadController.signal,
      timeout: 30000,
    });

    const totalFromHeader = parseInt(response.headers['content-length'] || '0');
    const writer = fs.createWriteStream(savePath, { flags: startByte > 0 ? 'a' : 'w' });

    let partDownloaded = startByte;
    let lastTime = Date.now();
    let lastOverall = overallDownloaded;

    response.data.on('data', (chunk) => {
      partDownloaded += chunk.length;
      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;

      if (elapsed >= 0.5) {
        const currentOverall = lastOverall + (partDownloaded - startByte);
        const speed = (currentOverall - lastOverall) / elapsed;
        event.sender.send('download-progress', {
          downloadedBytes: currentOverall,
          partIndex,
          totalParts,
          speed,
        });
        lastTime = now;
        lastOverall = currentOverall;
>>>>>>> parent of f9d75c2 (fix: Consolidate multi-part download progress into a single bar)
      }

      const headers = {};
      if (startByte > 0) {
        headers['Range'] = `bytes=${startByte}-`;
        console.log(`${partLabel} Requesting range: ${headers['Range']}`);
      } else {
        console.log(`${partLabel} Starting from byte 0`);
      }

<<<<<<< HEAD
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

      response.data.on('data', (chunk) => {
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
=======
    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve({ downloadedBytes: partDownloaded }));
      writer.on('error', reject);
      response.data.on('error', reject);
    });
  } catch (error) {
    // If range is not satisfiable, it usually means we already have the whole file
    if (error.response && error.response.status === 416) {
      return { downloadedBytes: startByte };
>>>>>>> parent of f9d75c2 (fix: Consolidate multi-part download progress into a single bar)
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

<<<<<<< HEAD
  const partSizes = packs.map((_, i) => {
    const savePath = path.join(downloadDir, `Endfield_Part_${i + 1}.zip`);
    const size = fs.existsSync(savePath) ? fs.statSync(savePath).size : 0;
    if (size > 0) console.log(`Found existing part ${i+1}: ${size} bytes`);
    return size;
  });

  const sendOverallProgress = (speed) => {
    const totalDownloaded = partSizes.reduce((a, b) => a + b, 0);
    event.sender.send('download-progress', {
      downloadedBytes: totalDownloaded,
      speed,
    });
  };
=======
  let overallDownloaded = 0;
  // Calculate already downloaded bytes from existing files
  for (let i = 0; i < packs.length; i++) {
    const savePath = path.join(downloadDir, `Endfield_Part_${i + 1}.zip`);
    if (fs.existsSync(savePath)) {
      overallDownloaded += fs.statSync(savePath).size;
    }
  }
>>>>>>> parent of f9d75c2 (fix: Consolidate multi-part download progress into a single bar)

  try {
    for (let i = 0; i < packs.length; i++) {
      const pack = packs[i];
      const savePath = path.join(downloadDir, `Endfield_Part_${i + 1}.zip`);
<<<<<<< HEAD

      // Re-check size on disk for each part to ensure accurate resume
      const existingSize = fs.existsSync(savePath) ? fs.statSync(savePath).size : 0;
      partSizes[i] = existingSize;

      const expectedSize = parseInt(pack.package_size || '0');

      await downloadPart(event, {
=======
      const existingSize = fs.existsSync(savePath) ? fs.statSync(savePath).size : 0;
      const expectedSize = parseInt(pack.size || '0');
      
      const result = await downloadPart(event, {
>>>>>>> parent of f9d75c2 (fix: Consolidate multi-part download progress into a single bar)
        url: pack.url,
        savePath,
        startByte: existingSize,
        speedLimit,
        speedLimitUnit,
        partIndex: i,
        totalParts: packs.length,
        overallDownloaded,
        expectedSize
      });
      
      // Update overallDownloaded with the actual bytes on disk after this part's attempt
      if (fs.existsSync(savePath)) {
        const finalPartSize = fs.statSync(savePath).size;
        // The difference between what we had before starting this part and what we have now
        overallDownloaded += (finalPartSize - existingSize);
      }
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

// Extract game parts
ipcMain.handle('extract-game', async (event, { downloadDir, gameDir }) => {
  if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });
  
  // We'll extract all .zip files in downloadDir to gameDir
  // Using 7z if available, otherwise fallback or error
  return new Promise((resolve, reject) => {
    const parts = fs.readdirSync(downloadDir).filter(f => f.endsWith('.zip')).sort();
    if (parts.length === 0) return reject(new Error('No zip files found to extract'));

    // Extracting the first part of a multi-part zip usually handles the rest if they are named correctly
    // But since these might be independent zips, we extract them one by one or as a set
    
    // For simplicity, let's extract them sequentially
    let currentPart = 0;
    
    const extractNext = () => {
      if (currentPart >= parts.length) {
        return resolve({ status: 'done' });
      }
      
      const partPath = path.join(downloadDir, parts[currentPart]);
      event.sender.send('extract-progress', { status: 'extracting', message: `Extracting ${parts[currentPart]}...`, partIndex: currentPart, totalParts: parts.length });
      
      const unzip = spawn('unzip', ['-o', partPath, '-d', gameDir]);
      
      unzip.on('close', (code) => {
        if (code === 0) {
          currentPart++;
          extractNext();
        } else {
          resolve({ status: 'error', message: `Unzip failed with code ${code} for ${parts[currentPart]}` });
        }
      });
      
      unzip.on('error', (err) => resolve({ status: 'error', message: err.message }));
    };

    extractNext();
  });
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
ipcMain.handle('get-file-size', (event, filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      return fs.statSync(filePath).size;
    }
  } catch (e) {}
  return 0;
});

// Get total downloaded bytes from disk
ipcMain.handle('get-total-downloaded', (event, { packs, downloadDir }) => {
  try {
    if (!packs || !downloadDir) return 0;
    let total = 0;
    for (let i = 0; i < packs.length; i++) {
      const savePath = path.join(downloadDir, `Endfield_Part_${i + 1}.zip`);
      if (fs.existsSync(savePath)) {
        total += fs.statSync(savePath).size;
      }
    }
    return total;
  } catch (e) {
    return 0;
  }
});

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
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    // tar -xJf archive.tar.xz -C destDir --strip-components=1
    const tar = spawn('tar', ['-xJf', archivePath, '-C', destDir, '--strip-components=1']);
    tar.stderr.on('data', (data) => {
      event.sender.send('extract-progress', { status: 'extracting', message: data.toString().trim() });
    });
    tar.on('close', (code) => {
      if (code === 0) {
        // Delete archive after successful extract
        try { fs.unlinkSync(archivePath); } catch (_) {}
        event.sender.send('extract-progress', { status: 'done' });
        resolve({ status: 'done' });
      } else {
        resolve({ status: 'error', code });
      }
    });
    tar.on('error', (err) => resolve({ status: 'error', message: err.message }));
  });
});

// Check if proton path exists
ipcMain.handle('check-proton-path', (event, protonPath) => {
  return fs.existsSync(protonPath);
});

// Check if game is installed
ipcMain.handle('check-game-installed', (event, gameDir) => {
  if (!gameDir) return false;
  try {
    const exePath = path.join(gameDir, 'Endfield.exe');
    return fs.existsSync(exePath);
  } catch (e) {
    return false;
  }
});

// Launch game
ipcMain.handle('launch-game', async (event, { gameDir, protonPath, args, envVars, nativeVulkan, wayland, gameMode, dxvkAsync, disableFsync, disableEsync, mangoHud, canonicalHole, customEnvVars }) => {
  const { spawn } = require('child_process');

  // Build environment
  const env = { ...process.env };

  if (wayland) env['PROTON_ENABLE_WAYLAND'] = '1';
  if (dxvkAsync) env['DXVK_ASYNC'] = '1';
  if (disableFsync) env['PROTON_NO_FSYNC'] = '1';
  if (disableEsync) env['PROTON_NO_ESYNC'] = '1';
  if (mangoHud) env['MANGOHUD'] = '1';
  if (canonicalHole) env['WINE_CANONICAL_HOLE'] = 'skip_volatile_check';

  // Parse custom env vars
  if (customEnvVars) {
    customEnvVars.split('\n').forEach(line => {
      line = line.trim();
      if (line && !line.startsWith('#') && line.includes('=')) {
        const [k, ...v] = line.split('=');
        env[k.trim()] = v.join('=').trim();
      }
    });
  }

  // Build command
  let cmd = [];
  if (gameMode) cmd.push('gamemoderun');

  const exePath = path.join(gameDir, 'Endfield.exe');

  if (protonPath && fs.existsSync(protonPath)) {
    cmd.push(path.join(protonPath, 'proton'), 'run');
  }

  cmd.push(exePath);
  if (nativeVulkan) cmd.push('-vulkan');
  if (args) cmd.push(...args.split(' ').filter(Boolean));

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
