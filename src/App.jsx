import { useState, useEffect } from 'react';
import { Download, Settings, Play, Info, Globe, ShieldCheck, Cpu, Pause, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import './App.css';

function App() {
  const [gameInfo, setGameInfo] = useState(null);
  const [protonVersions, setProtonVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('home');
  const [selectedProton, setSelectedProton] = useState('');
  
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentPart, setCurrentPart] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const info = await window.electron.getGameLinks();
        const protons = await window.electron.getProtonVersions();
        setGameInfo(info);
        setProtonVersions(protons);
        if (protons.length > 0) setSelectedProton(protons[0].version);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    fetchData();

    window.electron.onDownloadProgress((data) => {
      if (gameInfo?.pkg?.total_size) {
        const totalSize = parseInt(gameInfo.pkg.total_size);
        const currentProgress = (data.downloadedBytes / totalSize) * 100;
        setProgress(currentProgress);
      }
    });
  }, []);

  const handleDownload = async () => {
    if (!gameInfo?.pkg?.packs) return;
    setIsDownloading(true);
    setIsPaused(false);
    
    try {
      await window.electron.startDownload({
        url: gameInfo.pkg.packs[currentPart].url,
        savePath: '/home/tb/Downloads/Endfield_Part_1.zip',
        startByte: 0 
      });
    } catch (e) { console.error(e); }
  };

  const handlePause = async () => {
    await window.electron.pauseDownload();
    setIsPaused(true);
    setIsDownloading(false);
  };

  return (
    <div className='launcher-container'>
      <div className='drag-region'></div>
      <nav className='sidebar'>
        <div className='logo-circle'>AE</div>
        <div className='nav-items'>
          <button className={activeTab === 'home' ? 'active' : ''} onClick={() => setActiveTab('home')}><Play size={20} /></button>
          <button className={activeTab === 'setup' ? 'active' : ''} onClick={() => setActiveTab('setup')}><Cpu size={20} /></button>
          <button className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}><Settings size={20} /></button>
        </div>
        <div className='nav-footer no-drag'>
          <button onClick={() => window.electron.openExternal("https://github.com/dawn-winery")}><Globe size={20} /></button>
        </div>
      </nav>

      <main className='content'>
        <AnimatePresence mode='wait'>
          {loading ? (
            <div className='loader-container'><div className='spinner'></div></div>
          ) : activeTab === 'home' ? (
            <motion.div key='home' initial={{ opacity: 0 }} animate={{ opacity: 1 }} className='tab-content home'>
              <div className='hero-section'>
                <h1>Arknights: Endfield</h1>
                <div className='version-badge'>v{gameInfo?.version || "1.1.9"}</div>
                
                <div className='download-card'>
                  <div className='card-header'>
                    <div className='card-info'>
                      <span className='size-label'>{(parseInt(gameInfo?.pkg?.total_size || 0) / 1e9).toFixed(2)} GB</span>
                      <span className='status-label'>{isDownloading ? "Downloading..." : isPaused ? "Paused" : "Ready"}</span>
                    </div>
                    {!isDownloading ? (
                      <button className='main-btn no-drag' onClick={handleDownload}>
                        {isPaused ? <RotateCcw size={20} /> : <Download size={20} />}
                        <span>{isPaused ? "Resume" : "Download"}</span>
                      </button>
                    ) : (
                      <button className='main-btn pause-btn no-drag' onClick={handlePause}>
                        <Pause size={20} />
                        <span>Pause</span>
                      </button>
                    )}
                  </div>
                  
                  {(isDownloading || isPaused) && (
                    <div className='progress-container'>
                      <div className='progress-bar-bg'>
                        <div className='progress-fill' style={{ width: progress + "%%" }} />
                      </div>
                      <div className='progress-stats'>
                        <span>{progress.toFixed(1)}%%</span>
                        <span>Part {currentPart + 1} of {gameInfo?.pkg?.packs?.length}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ) : activeTab === 'setup' ? (
            <motion.div key='setup' initial={{ opacity: 0 }} animate={{ opacity: 1 }} className='tab-content setup'>
              <h2>Linux Setup</h2>
              <div className='proton-manager'>
                <h3>DW Proton Versions</h3>
                <div className='proton-list'>
                  {protonVersions.map((p, i) => (
                    <div key={i} className={'proton-item no-drag ' + (selectedProton === p.version ? 'selected' : '')} onClick={() => setSelectedProton(p.version)}>
                      <div className='p-info'><ShieldCheck size={16} color='#facc15' /><span>{p.version}</span></div>
                      <button className='p-btn' onClick={() => window.electron.openExternal(p.url)}><Download size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          ) : (
            <div className='tab-content'><h2>Settings</h2><p>Coming Soon</p></div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
export default App;
