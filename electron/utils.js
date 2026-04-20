'use strict';

const fs = require('fs');
const path = require('path');

// ─── Settings ────────────────────────────────────────────────────────────────

/**
 * Load settings from disk, merging with defaults.
 * @param {string} settingsPath - absolute path to settings.json
 * @param {object} defaultSettings
 * @returns {object}
 */
function loadSettings(settingsPath, defaultSettings) {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return { ...defaultSettings, ...data };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return { ...defaultSettings };
}

/**
 * Save settings to disk.
 * @param {string} settingsPath
 * @param {object} settings
 * @returns {boolean}
 */
function saveSettings(settingsPath, settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return true;
  } catch (e) {
    console.error('Failed to save settings:', e);
    return false;
  }
}

// ─── File / Download helpers ──────────────────────────────────────────────────

/**
 * Get file size in bytes, 0 if file doesn't exist.
 * @param {string} filePath
 * @returns {number}
 */
function getFileSize(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return fs.statSync(filePath).size;
    }
  } catch (e) {}
  return 0;
}

/**
 * Sum sizes of all downloaded part files on disk.
 * @param {Array<{package_size: string}>} packs
 * @param {string} downloadDir
 * @returns {number}
 */
function getTotalDownloaded(packs, downloadDir) {
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
}

/**
 * Count how many parts are fully downloaded (file size >= package_size).
 * @param {Array<{package_size: string}>} packs
 * @param {string} downloadDir
 * @returns {number}
 */
function getCompletedPartsCount(packs, downloadDir) {
  try {
    if (!packs || !downloadDir) return 0;
    let completed = 0;
    for (let i = 0; i < packs.length; i++) {
      const savePath = path.join(downloadDir, `Endfield_Part_${i + 1}.zip`);
      const expectedSize = parseInt(packs[i].package_size || '0');
      if (
        expectedSize > 0 &&
        fs.existsSync(savePath) &&
        fs.statSync(savePath).size >= expectedSize
      ) {
        completed++;
      }
    }
    return completed;
  } catch (e) {
    return 0;
  }
}

// ─── Game ─────────────────────────────────────────────────────────────────────

/**
 * Check if the game is installed by finding Endfield.exe in gameDir.
 * @param {string} gameDir
 * @returns {boolean}
 */
function checkGameInstalled(gameDir) {
  if (!gameDir) return false;
  try {
    const exePath = path.join(gameDir, 'Endfield.exe');
    return fs.existsSync(exePath);
  } catch (e) {
    return false;
  }
}

/**
 * Check if a Proton installation exists at the given path.
 * @param {string} protonPath
 * @returns {boolean}
 */
function checkProtonPath(protonPath) {
  if (!protonPath) return false;
  try {
    return fs.existsSync(protonPath);
  } catch (e) {
    return false;
  }
}

/**
 * Map a raw Gitea release object to a simplified version descriptor.
 * Returns null if no .tar.xz asset is found.
 * @param {object} release  - raw release from Gitea API
 * @returns {{ version, date, size, url, assetName } | null}
 */
function mapProtonRelease(release) {
  const asset = (release.assets || []).find(
    (a) => a.name.endsWith('.tar.xz') && !a.name.endsWith('.torrent')
  );
  if (!asset) return null;
  return {
    version: release.name || release.tag_name,
    date: release.published_at ? release.published_at.split('T')[0] : '',
    size: (asset.size / (1024 * 1024)).toFixed(1) + ' MB',
    url: asset.browser_download_url,
    assetName: asset.name,
  };
}

/**
 * Returns true if part should be skipped
 */
function isPartAlreadyComplete(startByte, expectedSize) {
  return expectedSize > 0 && startByte >= expectedSize;
}

// ─── Extract ──────────────────────────────────────────────────────────────────

/**
 * Collect .zip files in downloadDir, sorted alphabetically.
 * @param {string} downloadDir
 * @returns {string[]} sorted filenames (basenames only)
 */
function collectZipParts(downloadDir) {
  try {
    return fs.readdirSync(downloadDir)
      .filter(f => f.endsWith('.zip'))
      .sort();
  } catch (e) {
    return [];
  }
}

/**
 * Extract a single zip file to destDir using the system `unzip` binary.
 * Returns a Promise resolving to { status: 'done' | 'error', message? }.
 * NOTE: Only use this for self-contained (non-split) zips.
 * @param {string} zipPath    - absolute path to .zip file
 * @param {string} destDir    - directory to extract into
 * @param {Function} [onProgress]
 * @param {Function} spawnFn  - injectable spawn (default: child_process.spawn)
 * @returns {Promise<{status: string, message?: string, code?: number}>}
 */
function extractZip(zipPath, destDir, onProgress, spawnFn) {
  const { spawn } = spawnFn ? { spawn: spawnFn } : require('child_process');
  return new Promise((resolve) => {
    // Check file exists first
    if (!fs.existsSync(zipPath)) {
      return resolve({ status: 'error', message: `File not found: ${zipPath}` });
    }
    const proc = spawn('unzip', ['-o', zipPath, '-d', destDir]);
    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ status: 'done' });
      } else {
        resolve({ status: 'error', message: `unzip exited with code ${code}: ${stderr.trim()}`, code });
      }
    });
    proc.on('error', (err) => resolve({ status: 'error', message: err.message }));
  });
}

/**
 * Extract Arknights Endfield game parts.
 *
 * The parts are individual ZIP archives that should be extracted 
 * one by one into the same destination directory.
 *
 * @param {string[]} partPaths   - Absolute paths, already sorted
 * @param {string}   destDir     - Extraction destination
 * @param {Function} [onProgress] - Called with progress string
 * @returns {Promise<{status: string, message?: string}>}
 */
function extractGameParts(partPaths, destDir, onProgress) {
  const { spawn, execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');

  return new Promise(async (resolve) => {
    if (!partPaths || partPaths.length === 0) {
      return resolve({ status: 'error', message: 'No parts to extract' });
    }

    const sortedPaths = [...partPaths].sort((a, b) => {
      const extractNum = (p) => {
        const m = path.basename(p).match(/Part_(\d+)/i);
        return m ? parseInt(m[1]) : 0;
      };
      return extractNum(a) - extractNum(b);
    });

    let binary = '7z';
    try {
      execSync('7z --help', { stdio: 'ignore' });
    } catch (e) {
      const { path7za } = require('7zip-bin');
      binary = path7za;
      if (binary.includes('app.asar') && !binary.includes('app.asar.unpacked')) {
        binary = binary.replace('app.asar', 'app.asar.unpacked');
      }
      try { fs.chmodSync(binary, 0o755); } catch (err) {}
    }

    // --- STEP 1: MERGE ---
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const downloadDir = path.dirname(sortedPaths[0]);
    const mergedPath = path.join(downloadDir, '_merged_game.zip');

    console.log(`[Extract] Merging ${sortedPaths.length} parts sequentially...`);
    if (onProgress) onProgress(`Merging ${sortedPaths.length} parts...`);

    try {
      const writeStream = fs.createWriteStream(mergedPath);
      for (let i = 0; i < sortedPaths.length; i++) {
        if (onProgress) onProgress(`Merging parts (${i + 1}/${sortedPaths.length})...`);
        const rs = fs.createReadStream(sortedPaths[i]);
        await new Promise((res, rej) => {
          rs.pipe(writeStream, { end: false });
          rs.on('end', res);
          rs.on('error', rej);
        });
      }
      writeStream.end();
      await new Promise(res => writeStream.on('finish', res));
    } catch (err) {
      return resolve({ status: 'error', message: `Merge failed: ${err.message}` });
    }

    // --- STEP 2: EXTRACT ---
    console.log('[Extract] Merge complete. Starting extraction...');
    if (onProgress) onProgress('Extracting game files (this will take a while)...');
    
    const sevenZ = spawn(binary, ['x', mergedPath, `-o${destDir}`, '-tzip', '-aoa', '-y', '-bsp1']);
    let stderr = '';

    sevenZ.stderr.on('data', (data) => stderr += data.toString());
    sevenZ.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && onProgress) onProgress(msg);
    });

    sevenZ.on('close', (code) => {
      // Cleanup merged file to free up ~45GB
      try { fs.unlinkSync(mergedPath); } catch (_) {}
      
      if (code === 0) {
        console.log('[Extract] Success!');
        resolve({ status: 'done' });
      } else {
        console.error('[Extract] 7z Failed:', stderr);
        resolve({ 
          status: 'error', 
          message: `Extraction failed (Code ${code}).\n${stderr}\n\nJika masih muncul 'Data Error', kemungkinan ada part lain yang corrupt selain Part 1.` 
        });
      }
    });
  });
}

/**
 * Extract a .tar.xz Proton archive into destDir using system `tar`.
 * After success, deletes the archive file.
 * @param {string} archivePath
 * @param {string} destDir
 * @param {Function} [onProgress]  - called with (message) per stderr chunk
 * @param {Function} spawnFn  - injectable spawn
 * @returns {Promise<{status: string, message?: string, code?: number}>}
 */
function extractProtonArchive(archivePath, destDir, onProgress, spawnFn) {
  const { spawn } = spawnFn ? { spawn: spawnFn } : require('child_process');
  return new Promise((resolve) => {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const proc = spawn('tar', ['-xJf', archivePath, '-C', destDir, '--strip-components=1']);

    if (onProgress) {
      proc.stderr.on('data', (data) => onProgress(data.toString().trim()));
    }

    proc.on('close', (code) => {
      if (code === 0) {
        try { fs.unlinkSync(archivePath); } catch (_) {}
        resolve({ status: 'done' });
      } else {
        resolve({ status: 'error', code });
      }
    });

    proc.on('error', (err) => resolve({ status: 'error', message: err.message }));
  });
}

// ─── Launch env builder ───────────────────────────────────────────────────────

/**
 * Build the environment variables object for launching the game via Proton.
 * @param {object} opts
 * @returns {{ env: object, cmd: string[] }}
 */
function buildLaunchEnv(opts = {}) {
  const {
    wayland, dxvkAsync, disableFsync, disableEsync,
    mangoHud, canonicalHole, customEnvVars = '',
  } = opts;

  const env = { ...process.env };

  if (wayland)       env['PROTON_ENABLE_WAYLAND'] = '1';
  if (dxvkAsync)     env['DXVK_ASYNC'] = '1';
  if (disableFsync)  env['PROTON_NO_FSYNC'] = '1';
  if (disableEsync)  env['PROTON_NO_ESYNC'] = '1';
  if (mangoHud)      env['MANGOHUD'] = '1';
  if (canonicalHole) env['WINE_CANONICAL_HOLE'] = 'skip_volatile_check';

  if (customEnvVars) {
    customEnvVars.split('\n').forEach(line => {
      line = line.trim();
      if (line && !line.startsWith('#') && line.includes('=')) {
        const [k, ...v] = line.split('=');
        env[k.trim()] = v.join('=').trim();
      }
    });
  }

  return env;
}

/**
 * Download an image from a URL to a local path.
 * @param {string} url
 * @param {string} savePath
 * @returns {Promise<boolean>}
 */
async function downloadImage(url, savePath) {
  const axios = require('axios');
  const fs = require('fs');
  const path = require('path');

  try {
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream'
    });

    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(savePath);
      response.data.pipe(writer);
      writer.on('finish', () => resolve(true));
      writer.on('error', (err) => {
        fs.unlink(savePath, () => {}); // Clean up partial file
        reject(err);
      });
    });
  } catch (error) {
    console.error(`Failed to download image from ${url}:`, error.message);
    return false;
  }
}

/**
 * Attempt to find the latest KV (Key Visual) from the official website.
 * @returns {Promise<string|null>} URL of the latest background image
 */
async function findLatestBackground() {
  const axios = require('axios');
  try {
    const response = await axios.get('https://endfield.gryphline.com/', { timeout: 10000 });
    const html = response.data;
    
    // Look for patterns like https://web-static.hg-cdn.com/endfield/official-v4/_next/static/media/kv_...jpg
    const regex = /https:\/\/web-static\.hg-cdn\.com\/endfield\/official-v4\/_next\/static\/media\/kv_[^"']+\.(?:jpg|png|webp)/g;
    const matches = html.match(regex);
    
    if (matches && matches.length > 0) {
      // Return the first match (usually the main KV)
      return matches[0];
    }
  } catch (error) {
    console.error('Failed to fetch latest background info:', error.message);
  }
  return null;
}

/**
 * Calculate MD5 hash of a file.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
function calculateMD5(filePath) {
  const crypto = require('crypto');
  const fs = require('fs');
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

module.exports = {
  loadSettings,
  saveSettings,
  getFileSize,
  getTotalDownloaded,
  getCompletedPartsCount,
  checkGameInstalled,
  checkProtonPath,
  mapProtonRelease,
  isPartAlreadyComplete,
  collectZipParts,
  extractZip,
  extractGameParts,
  extractProtonArchive,
  buildLaunchEnv,
  downloadImage,
  findLatestBackground,
  calculateMD5,
};
