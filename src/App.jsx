import { useState, useEffect, useRef } from 'react';
import {
  Download, Settings, Play, Globe, ShieldCheck, Cpu,
  Pause, RotateCcw, X, FolderOpen, RefreshCw, ChevronDown,
  Zap, Monitor, Gamepad2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import './App.css';

// ─── Toggle Switch ────────────────────────────────────────────────────────────
function Toggle({ value, onChange }) {
  return (
    <button
      className={`toggle-btn ${value ? 'on' : ''}`}
      onClick={() => onChange(!value)}
      type="button"
    >
      <span className="toggle-thumb" />
    </button>
  );
}

// ─── Select ───────────────────────────────────────────────────────────────────
function Select({ value, onChange, options }) {
  return (
    <div className="select-wrap">
      <select value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={14} className="select-arrow" />
    </div>
  );
}

// ─── Settings Modal ───────────────────────────────────────────────────────────
function SettingsModal({ onClose, settings, onSave }) {
  const [tab, setTab] = useState('paths');
  const [local, setLocal] = useState({ ...settings });
  const [protonVersions, setProtonVersions] = useState([]);
  const [protonLoading, setProtonLoading] = useState(false);
  const [protonStatus, setProtonStatus] = useState('');

  const set = (key, val) => setLocal(prev => ({ ...prev, [key]: val }));

  const fetchProton = async () => {
    setProtonLoading(true);
    const versions = await window.electron.getProtonVersions();
    setProtonVersions(versions);
    setProtonLoading(false);
  };

  const checkProtonStatus = async () => {
    const exists = await window.electron.checkProtonPath(local.protonPath);
    setProtonStatus(exists ? 'found' : 'not_found');
  };

  useEffect(() => {
    if (tab === 'proton') {
      fetchProton();
      checkProtonStatus();
    }
  }, [tab]);

  useEffect(() => {
    checkProtonStatus();
  }, [local.protonPath]);

  const browse = async (key, current) => {
    const dir = await window.electron.browseDirectory(current);
    if (dir) set(key, dir);
  };

  const handleSave = () => {
    onSave(local);
    onClose();
  };

  const tabs = ['Paths', 'Proton', 'Launch', 'Downloads'];

  return (
    <motion.div
      className="modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className="modal"
        initial={{ scale: 0.92, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        {/* Header */}
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Tabs */}
        <div className="modal-tabs">
          {tabs.map(t => (
            <button
              key={t}
              className={`modal-tab ${tab === t.toLowerCase() ? 'active' : ''}`}
              onClick={() => setTab(t.toLowerCase())}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="modal-body">

          {/* ── PATHS ── */}
          {tab === 'paths' && (
            <div className="settings-section">
              <div className="setting-row">
                <label>Game directory</label>
                <div className="path-input-row">
                  <input
                    value={local.gameDir}
                    onChange={e => set('gameDir', e.target.value)}
                    placeholder="/home/user/Games/ArknightsEndfield"
                  />
                  <button className="browse-btn" onClick={() => browse('gameDir', local.gameDir)}>
                    Browse
                  </button>
                </div>
              </div>

              <div className="setting-row">
                <label>Download directory</label>
                <div className="path-input-row">
                  <input
                    value={local.downloadDir}
                    onChange={e => set('downloadDir', e.target.value)}
                    placeholder="/home/user/Games/ArknightsEndfield/_download"
                  />
                  <button className="browse-btn" onClick={() => browse('downloadDir', local.downloadDir)}>
                    Browse
                  </button>
                </div>
                <span className="setting-hint">Temporary directory for downloaded archives</span>
              </div>

              <div className="setting-row">
                <label>Language</label>
                <Select
                  value={local.language}
                  onChange={v => set('language', v)}
                  options={[
                    { value: 'English', label: 'English' },
                    { value: 'Chinese', label: 'Chinese (Simplified)' },
                    { value: 'Japanese', label: 'Japanese' },
                    { value: 'Korean', label: 'Korean' },
                  ]}
                />
              </div>
            </div>
          )}

          {/* ── PROTON ── */}
          {tab === 'proton' && (
            <div className="settings-section">
              <div className="setting-row">
                <label>Active DWProton</label>
                <div className="path-input-row">
                  <input
                    value={local.protonPath}
                    onChange={e => set('protonPath', e.target.value)}
                    placeholder="/home/user/.local/share/llauncher/proton"
                  />
                  <button className="browse-btn" onClick={() => browse('protonPath', local.protonPath)}>
                    Browse
                  </button>
                </div>
                <span className={`setting-hint ${protonStatus === 'found' ? 'hint-ok' : 'hint-err'}`}>
                  Status: {protonStatus === 'found' ? 'Found' : protonStatus === 'not_found' ? 'Not found' : 'Checking...'}
                </span>
              </div>

              <div className="setting-row">
                <div className="proton-versions-header">
                  <label>Available versions</label>
                  <button className="refresh-btn" onClick={fetchProton} disabled={protonLoading}>
                    {protonLoading ? <RefreshCw size={14} className="spin" /> : <span style={{ color: '#facc15', fontSize: 13, fontWeight: 600 }}>Refresh</span>}
                  </button>
                </div>

                <div className="proton-versions-list">
                  {protonLoading && (
                    <div className="proton-loading">
                      <RefreshCw size={16} className="spin" />
                      <span>Loading versions...</span>
                    </div>
                  )}
                  {!protonLoading && protonVersions.length === 0 && (
                    <div className="proton-loading">
                      <span style={{ color: 'rgba(255,255,255,0.4)' }}>No versions found. Check your internet connection.</span>
                    </div>
                  )}
                  {protonVersions.map((p, i) => (
                    <div key={i} className="proton-version-item">
                      <div className="pv-info">
                        <span className="pv-name">{p.version}</span>
                        <span className="pv-meta">{p.date} · {p.size}</span>
                      </div>
                      <button
                        className="pv-download-btn"
                        onClick={() => {
                          // Set proton path and trigger download
                          const targetPath = local.protonPath || `/home/${process.env.USER || 'user'}/.local/share/llauncher/proton`;
                          set('protonPath', targetPath);
                          window.electron.startDownload({
                            url: p.url,
                            savePath: targetPath + '.tar.gz',
                          });
                        }}
                      >
                        Download
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── LAUNCH ── */}
          {tab === 'launch' && (
            <div className="settings-section">
              <div className="setting-row toggle-row">
                <div className="toggle-info">
                  <span className="toggle-label">Launch at startup</span>
                  <span className="toggle-desc">Automatically start LLauncher when you log in</span>
                </div>
                <Toggle value={local.launchAtStartup} onChange={v => set('launchAtStartup', v)} />
              </div>

              <div className="setting-row">
                <label>After game launch</label>
                <Select
                  value={local.afterGameLaunch}
                  onChange={v => set('afterGameLaunch', v)}
                  options={[
                    { value: 'hide', label: 'Hide launcher' },
                    { value: 'minimize', label: 'Minimize launcher' },
                    { value: 'keep', label: 'Keep open' },
                    { value: 'close', label: 'Close launcher' },
                  ]}
                />
              </div>

              <div className="setting-row toggle-row">
                <div className="toggle-info">
                  <span className="toggle-label">Native Vulkan</span>
                  <span className="toggle-desc">Use the game's built-in Vulkan renderer (-vulkan)</span>
                </div>
                <Toggle value={local.nativeVulkan} onChange={v => set('nativeVulkan', v)} />
              </div>

              <div className="setting-row toggle-row">
                <div className="toggle-info">
                  <span className="toggle-label">Wayland</span>
                  <span className="toggle-desc">Enable Wayland support in Proton (PROTON_ENABLE_WAYLAND=1)</span>
                </div>
                <Toggle value={local.wayland} onChange={v => set('wayland', v)} />
              </div>

              <div className="setting-row toggle-row">
                <div className="toggle-info">
                  <span className="toggle-label">GameMode</span>
                  <span className="toggle-desc">Optimize CPU governor for gaming via gamemoderun</span>
                </div>
                <Toggle value={local.gameMode} onChange={v => set('gameMode', v)} />
              </div>

              <div className="setting-row toggle-row">
                <div className="toggle-info">
                  <span className="toggle-label">DXVK Async</span>
                  <span className="toggle-desc">Async shader compilation via DXVK (reduces stuttering)</span>
                </div>
                <Toggle value={local.dxvkAsync} onChange={v => set('dxvkAsync', v)} />
              </div>

              <div className="setting-row toggle-row">
                <div className="toggle-info">
                  <span className="toggle-label">Disable Fsync</span>
                  <span className="toggle-desc">Disable Proton fsync (PROTON_NO_FSYNC=1)</span>
                </div>
                <Toggle value={local.disableFsync} onChange={v => set('disableFsync', v)} />
              </div>

              <div className="setting-row toggle-row">
                <div className="toggle-info">
                  <span className="toggle-label">Disable Esync</span>
                  <span className="toggle-desc">Disable Proton esync (PROTON_NO_ESYNC=1)</span>
                </div>
                <Toggle value={local.disableEsync} onChange={v => set('disableEsync', v)} />
              </div>

              <div className="setting-row toggle-row">
                <div className="toggle-info">
                  <span className="toggle-label">MangoHud</span>
                  <span className="toggle-desc">Show FPS / frame time overlay</span>
                  {!local.mangoHud && <span className="hint-err" style={{ fontSize: 12 }}>Not installed</span>}
                </div>
                <Toggle value={local.mangoHud} onChange={v => set('mangoHud', v)} />
              </div>

              <div className="setting-row toggle-row">
                <div className="toggle-info">
                  <span className="toggle-label">
                    Canonical Hole (skip_volatile_check)
                    <span className="badge-experimental">EXPERIMENTAL</span>
                  </span>
                  <span className="toggle-desc">
                    WINE_CANONICAL_HOLE=skip_volatile_check — may improve performance up to 200% (DWProton)
                  </span>
                </div>
                <Toggle value={local.canonicalHole} onChange={v => set('canonicalHole', v)} />
              </div>

              <div className="setting-row">
                <label>Launch arguments</label>
                <input
                  className="text-input"
                  value={local.launchArgs}
                  onChange={e => set('launchArgs', e.target.value)}
                  placeholder="e.g. -windowed -fullscreen"
                />
              </div>

              <div className="setting-row">
                <label>Custom environment variables</label>
                <textarea
                  className="text-input textarea"
                  value={local.customEnvVars}
                  onChange={e => set('customEnvVars', e.target.value)}
                  rows={4}
                />
                <span className="setting-hint">Lines starting with # are ignored</span>
              </div>
            </div>
          )}

          {/* ── DOWNLOADS ── */}
          {tab === 'downloads' && (
            <div className="settings-section">
              <div className="setting-row">
                <label>Max concurrent downloads</label>
                <Select
                  value={String(local.maxConcurrentDownloads)}
                  onChange={v => set('maxConcurrentDownloads', parseInt(v))}
                  options={[1, 2, 3, 4, 5, 6, 8].map(n => ({ value: String(n), label: String(n) }))}
                />
              </div>

              <div className="setting-row">
                <label>Speed limit</label>
                <div className="speed-row">
                  <input
                    type="number"
                    className="text-input speed-input"
                    value={local.speedLimit}
                    min={0}
                    onChange={e => set('speedLimit', parseInt(e.target.value) || 0)}
                  />
                  <Select
                    value={local.speedLimitUnit}
                    onChange={v => set('speedLimitUnit', v)}
                    options={[
                      { value: 'MB/s', label: 'MB/s' },
                      { value: 'KB/s', label: 'KB/s' },
                    ]}
                  />
                </div>
                <span className="setting-hint">0 or empty = unlimited</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="footer-btn cancel" onClick={onClose}>Cancel</button>
          <button className="footer-btn save" onClick={handleSave}>Save</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [gameInfo, setGameInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('home');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState(null);

  const [isDownloading, setIsDownloading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);

  const progressListenerRef = useRef(false);

  useEffect(() => {
    const init = async () => {
      try {
        const [info, cfg] = await Promise.all([
          window.electron.getGameLinks(),
          window.electron.getSettings(),
        ]);
        setGameInfo(info);
        setSettings(cfg);
        if (info?.pkg?.total_size) setTotalBytes(parseInt(info.pkg.total_size));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    init();

    if (!progressListenerRef.current) {
      progressListenerRef.current = true;
      window.electron.onDownloadProgress((data) => {
        setDownloadedBytes(data.downloadedBytes || 0);
        setDownloadSpeed(data.speed || 0);
        if (data.totalBytes) setTotalBytes(data.totalBytes);
      });
    }
  }, []);

  const getSavePath = (packIndex = 0) => {
    const dir = settings?.downloadDir || '/tmp';
    return `${dir}/Endfield_Part_${packIndex + 1}.zip`;
  };

  const handleDownload = async () => {
    if (!gameInfo?.pkg?.packs?.length) return;
    const pack = gameInfo.pkg.packs[0];
    const savePath = getSavePath(0);

    // Check resume
    const existingSize = await window.electron.getFileSize(savePath);

    setIsDownloading(true);
    setIsPaused(false);
    if (existingSize === 0) setDownloadedBytes(0);

    try {
      await window.electron.startDownload({
        url: pack.url,
        savePath,
        startByte: existingSize,
        speedLimit: settings?.speedLimit || 0,
        speedLimitUnit: settings?.speedLimitUnit || 'MB/s',
      });
      setIsDownloading(false);
    } catch (e) {
      console.error(e);
      setIsDownloading(false);
    }
  };

  const handlePause = async () => {
    await window.electron.pauseDownload();
    setIsPaused(true);
    setIsDownloading(false);
  };

  const handleLaunch = async () => {
    if (!settings) return;
    try {
      await window.electron.launchGame({
        gameDir: settings.gameDir,
        protonPath: settings.protonPath,
        args: settings.launchArgs,
        nativeVulkan: settings.nativeVulkan,
        wayland: settings.wayland,
        gameMode: settings.gameMode,
        dxvkAsync: settings.dxvkAsync,
        disableFsync: settings.disableFsync,
        disableEsync: settings.disableEsync,
        mangoHud: settings.mangoHud,
        canonicalHole: settings.canonicalHole,
        customEnvVars: settings.customEnvVars,
      });
    } catch (e) {
      console.error('Launch error:', e);
    }
  };

  const handleSaveSettings = async (newSettings) => {
    setSettings(newSettings);
    await window.electron.saveSettings(newSettings);
  };

  const progress = totalBytes > 0 ? Math.min((downloadedBytes / totalBytes) * 100, 100) : 0;

  const fmtBytes = (b) => {
    if (b >= 1e9) return (b / 1e9).toFixed(2) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
    return (b / 1e3).toFixed(0) + ' KB';
  };

  const fmtSpeed = (bps) => {
    if (bps >= 1e6) return (bps / 1e6).toFixed(1) + ' MB/s';
    if (bps >= 1e3) return (bps / 1e3).toFixed(0) + ' KB/s';
    return bps.toFixed(0) + ' B/s';
  };

  const gameSize = gameInfo?.pkg?.total_size
    ? (parseInt(gameInfo.pkg.total_size) / 1e9).toFixed(2) + ' GB'
    : '—';

  const statusLabel = isDownloading
    ? `${fmtSpeed(downloadSpeed)}`
    : isPaused
    ? 'Paused'
    : 'Ready to download';

  return (
    <div className="launcher-container">
      <div className="drag-region" />
      <nav className="sidebar">
        <div className="logo-circle">AE</div>
        <div className="nav-items">
          <button className={activeTab === 'home' ? 'active' : ''} onClick={() => setActiveTab('home')} title="Home">
            <Play size={20} />
          </button>
          <button className={activeTab === 'setup' ? 'active' : ''} onClick={() => setActiveTab('setup')} title="Linux Setup">
            <Cpu size={20} />
          </button>
        </div>
        <div className="nav-footer no-drag">
          <button onClick={() => setShowSettings(true)} title="Settings">
            <Settings size={20} />
          </button>
          <button onClick={() => window.electron.openExternal('https://github.com/dawn-winery')} title="GitHub">
            <Globe size={20} />
          </button>
        </div>
      </nav>

      <main className="content">
        <AnimatePresence mode="wait">
          {loading ? (
            <div key="loading" className="loader-container">
              <div className="spinner" />
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Loading...</span>
            </div>
          ) : activeTab === 'home' ? (
            <motion.div
              key="home"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="tab-content home"
            >
              <div className="hero-section">
                <h1>Arknights: Endfield</h1>
                <div className="version-badge">v{gameInfo?.version || '1.1.9'}</div>

                <div className="download-card">
                  <div className="card-header">
                    <div className="card-info">
                      <span className="size-label">{gameSize}</span>
                      <span className="status-label">{statusLabel}</span>
                    </div>

                    <div className="btn-group">
                      {!isDownloading ? (
                        <>
                          <button className="main-btn no-drag" onClick={handleDownload}>
                            {isPaused ? <RotateCcw size={20} /> : <Download size={20} />}
                            <span>{isPaused ? 'Resume' : 'Download'}</span>
                          </button>
                          {isPaused || downloadedBytes > 0 ? null : (
                            <button className="launch-btn no-drag" onClick={handleLaunch} title="Launch Game">
                              <Play size={20} />
                            </button>
                          )}
                        </>
                      ) : (
                        <button className="main-btn pause-btn no-drag" onClick={handlePause}>
                          <Pause size={20} />
                          <span>Pause</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {(isDownloading || isPaused || downloadedBytes > 0) && (
                    <div className="progress-container">
                      <div className="progress-bar-bg">
                        <motion.div
                          className="progress-fill"
                          style={{ width: progress + '%' }}
                          initial={false}
                          animate={{ width: progress + '%' }}
                          transition={{ ease: 'linear', duration: 0.3 }}
                        />
                      </div>
                      <div className="progress-stats">
                        <span>{progress.toFixed(1)}%</span>
                        <span>{fmtBytes(downloadedBytes)} / {fmtBytes(totalBytes)}</span>
                        {isDownloading && <span>{fmtSpeed(downloadSpeed)}</span>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="setup"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="tab-content setup"
            >
              <h2>Linux Setup</h2>
              <p className="section-desc">
                Configure Proton and environment settings in{' '}
                <button
                  className="link-btn"
                  onClick={() => setShowSettings(true)}
                >
                  Settings → Proton
                </button>
              </p>

              <div className="setup-info-card">
                <Gamepad2 size={24} color="#facc15" />
                <div>
                  <h4>DWProton Configuration</h4>
                  <p>
                    Open Settings to download and configure DWProton versions,
                    set launch options, Vulkan, Wayland, DXVK, and more.
                  </p>
                  <button className="main-btn no-drag" style={{ marginTop: 12 }} onClick={() => setShowSettings(true)}>
                    <Settings size={16} />
                    <span>Open Settings</span>
                  </button>
                </div>
              </div>

              <div className="setup-info-card" style={{ marginTop: 16 }}>
                <Zap size={24} color="#facc15" />
                <div>
                  <h4>Current Configuration</h4>
                  <div className="config-tags">
                    {settings?.nativeVulkan && <span className="config-tag">Vulkan</span>}
                    {settings?.wayland && <span className="config-tag">Wayland</span>}
                    {settings?.dxvkAsync && <span className="config-tag">DXVK Async</span>}
                    {settings?.gameMode && <span className="config-tag">GameMode</span>}
                    {settings?.mangoHud && <span className="config-tag">MangoHud</span>}
                    {settings?.canonicalHole && <span className="config-tag config-tag-exp">Canonical Hole</span>}
                  </div>
                  <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>
                    Proton: {settings?.protonPath || 'Not configured'}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && settings && (
          <SettingsModal
            settings={settings}
            onClose={() => setShowSettings(false)}
            onSave={handleSaveSettings}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
