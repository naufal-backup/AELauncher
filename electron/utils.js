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
 * Extract Arknights Endfield split-zip game parts.
 *
 * The launcher downloads the game as a single ZIP split across N files
 * (Part_1.zip contains the local file headers, Part_N.zip contains EOCD).
 * unzip cannot handle individual parts — they must be concatenated first,
 * then extracted with 7z (which handles merged split-zips robustly).
 *
 * Strategy:
 *   1. Sort parts numerically (Part_1, Part_2 … Part_N)
 *   2. Merge into one temporary file using `cat`
 *   3. Extract merged file with `7z x`
 *   4. Delete temp file
 *
 * @param {string[]} partPaths   - Absolute paths, already sorted
 * @param {string}   destDir     - Extraction destination
 * @param {Function} [onProgress] - Called with progress string
 * @returns {Promise<{status: string, message?: string}>}
 */
function extractGameParts(partPaths, destDir, onProgress) {
  const { spawn } = require('child_process');

  return new Promise((resolve) => {
    if (!partPaths || partPaths.length === 0) {
      return resolve({ status: 'error', message: 'No parts to extract' });
    }

    // Verify all parts exist
    for (const p of partPaths) {
      if (!fs.existsSync(p)) {
        return resolve({ status: 'error', message: `Missing part: ${path.basename(p)}` });
      }
    }

    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const mergedPath = path.join(path.dirname(partPaths[0]), '_merged_game.zip');

    // Step 1: Merge all parts into one file using cat
    console.log(`[Extract] Merging ${partPaths.length} parts → ${mergedPath}`);
    if (onProgress) onProgress(`Merging ${partPaths.length} parts...`);

    const cat = spawn('cat', partPaths, { stdio: ['ignore', 'pipe', 'pipe'] });
    const writeStream = fs.createWriteStream(mergedPath);

    cat.stdout.pipe(writeStream);

    cat.on('error', (err) => {
      resolve({ status: 'error', message: `cat error: ${err.message}` });
    });

    writeStream.on('finish', () => {
      console.log('[Extract] Merge done, starting 7z extraction...');
      if (onProgress) onProgress('Extracting...');

      // Step 2: Extract merged zip with 7z
      const sevenZ = spawn('7z', ['x', mergedPath, `-o${destDir}`, '-aoa', '-bsp1']);

      sevenZ.stdout.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg && onProgress) onProgress(msg);
      });

      sevenZ.stderr.on('data', (data) => {
        console.error('[7z stderr]', data.toString().trim());
      });

      sevenZ.on('close', (code) => {
        // Step 3: Clean up merged file
        try { fs.unlinkSync(mergedPath); } catch (_) {}

        if (code === 0) {
          console.log('[Extract] Extraction complete.');
          resolve({ status: 'done' });
        } else {
          resolve({ status: 'error', message: `7z exited with code ${code}` });
        }
      });

      sevenZ.on('error', (err) => {
        try { fs.unlinkSync(mergedPath); } catch (_) {}
        resolve({ status: 'error', message: `7z not found: ${err.message}` });
      });
    });

    writeStream.on('error', (err) => {
      resolve({ status: 'error', message: `Write error: ${err.message}` });
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
};
