// Main application entry point, ties all modules together
// Uses IndexedDB for file storage, lazy loading, and Sakoe-Chiba DTW

window.progressiveTimer = null;
window.scheduleProgressiveUpdate = function() {
    if (window.progressiveTimer) clearTimeout(window.progressiveTimer);
    window.progressiveTimer = setTimeout(function() {
        window.updateChartFull();
    }, 10);
};
window.updateUI = window.scheduleProgressiveUpdate;

window.switchTab = function(id) {
    window.activeTabId = id;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-btn-' + id).classList.add('active');
    const cfg = window.TAB_CONFIG[id];
    document.getElementById('chart-main-title').innerText = cfg.title;
    document.getElementById('chart-sub-title').innerText = cfg.subTitle;
    document.getElementById('upper-tol').value = window.appState[id].upperTol;
    document.getElementById('lower-tol').value = window.appState[id].lowerTol;
    document.getElementById('ndr-toggle-container').style.display = (id === 'stress') ? 'flex' : 'none';
    document.getElementById('ult-strain-tol-row').classList.toggle('hidden', id !== 'stress');
    document.getElementById('force-dev-tol-row').classList.toggle('hidden', id !== 'stress');
    document.getElementById('break-time-tol-row').classList.toggle('hidden', id !== 'tear');
    if (id === 'stress') {
        document.getElementById('ult-strain-tol').value = window.appState.stress.ultStrainTol || 10;
        document.getElementById('force-dev-tol').value = window.appState.stress.forceDevTol || 7;
    }
    if (id === 'tear') {
        document.getElementById('break-time-tol').value = window.appState.tear.breakTimeTol || 10;
    }
    window.mainChart.options.scales.x.title.text = cfg.xAxis;
    window.mainChart.options.scales.y.title.text = cfg.yAxis;
    window.buildMetricsUI();
    window.updateUI();
};

function saveSession() {
    const exportState = JSON.parse(JSON.stringify(window.appState));
    // Remove _uid from session export? No, keep it for reidentification.
    // But we do not export the actual data (it's in IndexedDB). The session only saves metadata.
    const payload = JSON.stringify(exportState);
    let hash = 5381; for (let i = 0; i < payload.length; i++) hash = ((hash << 5) + hash) + payload.charCodeAt(i);
    exportState._integrity = (hash >>> 0).toString(16);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(exportState)], { type: 'application/json' }));
    a.download = 'session.json'; a.click();
    window.showToast('Session saved', 'success');
}

async function loadSession(e) {
    try {
        const text = await e.target.files[0].text(), loaded = JSON.parse(text);
        if (loaded._integrity) {
            const savedHash = loaded._integrity; delete loaded._integrity;
            let hash = 5381, checkPayload = JSON.stringify(loaded);
            for (let i = 0; i < checkPayload.length; i++) hash = ((hash << 5) + hash) + checkPayload.charCodeAt(i);
            if ((hash >>> 0).toString(16) !== savedHash) {
                window.showToast('Session file corrupted', 'error');
                e.target.value = '';
                return;
            }
        }
        if (loaded && loaded.stress) {
            window.appState = loaded;
            window.dataCache.clear();
            window.featureCache.clear();
            window.globalFeatureStats = null;
            // Ensure new tolerance fields exist
            if (!window.appState.stress.ultStrainTol) window.appState.stress.ultStrainTol = 10;
            if (!window.appState.stress.forceDevTol) window.appState.stress.forceDevTol = 7;
            if (!window.appState.tear.breakTimeTol) window.appState.tear.breakTimeTol = 10;
            // Reload feature vectors (data will be loaded lazily from IndexedDB when needed)
            Object.keys(window.TAB_CONFIG).forEach(tabId => {
                window.appState[tabId]?.tests.forEach(t => window.computeFeatureVector(t, tabId));
                window.appState[tabId]?.dbs.forEach(d => window.computeFeatureVector(d, tabId));
            });
            window.switchTab(window.activeTabId);
            window.showToast('Session loaded', 'success');
        } else window.showToast('Invalid format', 'warn');
    } catch (err) {
        window.showToast('Error loading', 'error');
    } finally {
        e.target.value = '';
    }
}

function resetApp() {
    window.dataCache.clear();
    window.featureCache.clear();
    window.fileDB.clearAll();
    window.globalFeatureStats = null;
    window.appState = JSON.parse(JSON.stringify(window.INITIAL_STATE));
    ['test-file-input', 'db-folder-input', 'load-session-input'].forEach(id => document.getElementById(id).value = '');
    window._lastSelectedTestIndex = undefined;
    window._lastSelectedDbIndex = undefined;
    window.switchTab(window.activeTabId);
    window.updateUI();
    window.showToast('Reset complete', 'success');
}

function exportExcel() {
    const wb = XLSX.utils.book_new();
    const state = window.appState[window.activeTabId];
    const activeMetrics = window.TAB_CONFIG[window.activeTabId].metrics.filter(m => state.activeMetrics.includes(m.id));
    [...state.tests.filter(t => t.selected), ...state.dbs.filter(d => d.selected)].forEach(f => {
        const rows = [[window.TAB_CONFIG[window.activeTabId].xAxis, ...activeMetrics.map(m => m.label)]];
        const base = window.processFileData(f, activeMetrics[0]?.id, 'none');
        base.forEach((p, i) => {
            const r = [p.x]; activeMetrics.forEach(m => {
                const d = window.processFileData(f, m.id, 'none');
                r.push(d[i]?.y || 0);
            });
            rows.push(r);
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), f.name.substring(0, 30));
    });
    XLSX.writeFile(wb, 'Film_Data.xlsx');
    window.showToast('Excel exported', 'success');
}

async function processFiles(files, type) {
    const state = window.appState[window.activeTabId];
    let loadedCount = 0;
    for (let f of files) {
        if (!f.name.endsWith('.json')) continue;
        try {
            const text = await f.text();
            if (text.length > 5 * 1024 * 1024) {
                window.showToast('File too large: ' + f.name, 'warn');
                continue;
            }
            const data = JSON.parse(text);
            if (!window.validateJSONSchema(data)) {
                window.showToast('Invalid schema: ' + f.name, 'warn');
                continue;
            }
            const uid = Date.now().toString(36) + Math.random().toString(36).substr(2);
            const item = {
                _uid: uid,
                name: f.name.replace('.json', ''),
                color: window.PALETTE[(state.tests.length + state.dbs.length) % window.PALETTE.length],
                selected: (type === 'test')
            };
            // Store full data in IndexedDB
            await window.fileDB.storeFile({ _uid: uid, name: item.name, data: data });
            // For selected files, keep data in memory so chart/table can use it immediately
            if (item.selected) {
                item.data = data;
            }
            // Compute feature vector (needs data)
            const tempData = data; // use data directly
            window.computeFeatureVector({ ...item, data: tempData }, window.activeTabId);
            if (type === 'test') state.tests.push(item);
            else state.dbs.push(item);
            window.globalFeatureStats = null;
            loadedCount++;
        } catch (err) {
            window.showToast('Error processing: ' + f.name, 'error');
        }
    }
    document.getElementById(type === 'test' ? 'test-file-input' : 'db-folder-input').value = '';
    if (loadedCount > 0) window.showToast('Loaded ' + loadedCount + ' file(s)', 'success');
    window.updateUI();
}

window.onload = function() {
    // Initialize IndexedDB
    window.fileDB = window.fileDB; // Already defined in db.js

    Object.values(window.TAB_CONFIG).forEach(tab => {
        const btn = document.createElement('button');
        btn.id = 'tab-btn-' + tab.id;
        btn.className = 'tab-btn rounded-t-lg px-6 py-2.5 text-sm font-bold whitespace-nowrap';
        btn.innerText = tab.title;
        btn.onclick = () => window.switchTab(tab.id);
        document.getElementById('tab-container').appendChild(btn);
    });
    window.initChart();

    // Event bindings
    document.getElementById('test-file-input').onchange = e => processFiles(e.target.files, 'test');
    document.getElementById('db-folder-input').onchange = e => processFiles(e.target.files, 'db');

    ['upper-tol', 'lower-tol'].forEach(id => document.getElementById(id).oninput = e => {
        window.appState[window.activeTabId][id === 'upper-tol' ? 'upperTol' : 'lowerTol'] = parseFloat(e.target.value) || 0;
        window.scheduleProgressiveUpdate();
    });

    document.getElementById('ult-strain-tol').oninput = e => {
        window.appState.stress.ultStrainTol = parseFloat(e.target.value) || 10;
        window.scheduleProgressiveUpdate();
    };
    document.getElementById('force-dev-tol').oninput = e => {
        window.appState.stress.forceDevTol = parseFloat(e.target.value) || 7;
        window.scheduleProgressiveUpdate();
    };
    document.getElementById('break-time-tol').oninput = e => {
        window.appState.tear.breakTimeTol = parseFloat(e.target.value) || 10;
        window.scheduleProgressiveUpdate();
    };

    ['toggle-optimum', 'toggle-anomalies'].forEach(id => document.getElementById(id).onchange = e => {
        window.appState[id === 'toggle-optimum' ? 'showOptimum' : 'showAnomalies'] = e.target.checked;
        window.updateChartFull();
    });
    document.getElementById('toggle-prefilter').onchange = e => {
        window.appState.usePrefilter = e.target.checked;
        window.scheduleProgressiveUpdate();
    };

    document.getElementById('clear-tab-btn').onclick = () => {
        const tab = window.appState[window.activeTabId];
        [...tab.tests, ...tab.dbs].forEach(f => {
            window.dataCache.deleteByPrefix(window.activeTabId + '_' + f._uid);
            window.featureCache.deleteByPrefix(f._uid);
            window.fileDB.removeFile(f._uid);
        });
        tab.tests = [];
        tab.dbs = [];
        window._lastSelectedTestIndex = undefined;
        window._lastSelectedDbIndex = undefined;
        window.globalFeatureStats = null;
        window.updateUI();
    };

    document.getElementById('save-session-btn').onclick = saveSession;
    document.getElementById('load-session-input').onchange = loadSession;
    document.getElementById('reset-btn').onclick = resetApp;
    document.getElementById('download-png-btn').onclick = () => {
        const a = document.createElement('a');
        a.download = 'Analytics.png';
        a.href = window.mainChart.toBase64Image();
        a.click();
    };
    document.getElementById('export-excel-btn').onclick = exportExcel;

    const lBtn = document.getElementById('toggle-legend-btn');
    lBtn.onclick = () => {
        window.appState.showLegend = !window.appState.showLegend;
        window.mainChart.options.plugins.legend.display = window.appState.showLegend;
        window.mainChart.update();
        lBtn.classList.toggle('bg-emerald-50', window.appState.showLegend);
        lBtn.classList.toggle('text-emerald-700', window.appState.showLegend);
    };

    // Periodic cache cleanup
    setInterval(() => {
        if (window.dataCache.cache.size > 150) {
            Array.from(window.dataCache.cache.keys()).slice(0, -150).forEach(k => window.dataCache.delete(k));
        }
        if (window.featureCache.cache.size > 375) {
            Array.from(window.featureCache.cache.keys()).slice(0, -375).forEach(k => window.featureCache.delete(k));
        }
    }, 60000);

    window.switchTab(window.DEFAULT_ACTIVE_TAB);

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        const m = { '1': 'stress', '2': 'puncture', '3': 'tear', '4': 'cling' };
        if (m[e.key]) { e.preventDefault(); window.switchTab(m[e.key]); }
        if (e.key.toLowerCase() === 'a') {
            e.preventDefault();
            const allSelected = window.appState[window.activeTabId].tests.every(t => t.selected);
            window.appState[window.activeTabId].tests.forEach(t => t.selected = !allSelected);
            window.updateUI();
        }
        if (e.key.toLowerCase() === 'l') { e.preventDefault(); document.getElementById('toggle-legend-btn').click(); }
        if (e.key.toLowerCase() === 'e') { e.preventDefault(); exportExcel(); }
    });

    // ========== PWA Service Worker Registration ==========
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then((registration) => {
                    console.log('Service Worker registered with scope:', registration.scope);
                    
                    // Check for updates
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                // New content available - notify user
                                if (confirm('A new version is available. Reload to update?')) {
                                    window.location.reload();
                                }
                            }
                        });
                    });
                })
                .catch((error) => {
                    console.error('Service Worker registration failed:', error);
                });
        });

        // Handle app install prompt (optional - shows custom install button)
        let deferredPrompt;
        window.addEventListener('beforeinstallprompt', (e) => {
            // Prevent Chrome 67+ from automatically showing the prompt
            e.preventDefault();
            // Stash the event so it can be triggered later
            deferredPrompt = e;
            
            // Show a custom install button
            const installBtn = document.getElementById('pwa-install-btn');
            if (installBtn) {
                installBtn.classList.remove('hidden');
                installBtn.addEventListener('click', () => {
                    deferredPrompt.prompt();
                    deferredPrompt.userChoice.then((choiceResult) => {
                        if (choiceResult.outcome === 'accepted') {
                            console.log('User accepted the install prompt');
                        }
                        deferredPrompt = null;
                    });
                });
            }
        });

        // Track when app was installed
        window.addEventListener('appinstalled', () => {
            console.log('App was installed');
            window.showToast('App installed successfully!', 'success');
        });
    }


};
