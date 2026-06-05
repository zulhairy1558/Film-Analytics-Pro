// UI: file list rendering, metric toggles, file selection with lazy data loading

window.updateFileList = function() {
    const state = window.appState[window.activeTabId];
    const render = (containerId, items, type) => {
        document.getElementById(containerId).innerHTML = items.map((item, i) => 
            `<div onclick="window.toggleFileSelection('${type}', ${i}, event)" class="file-item flex items-center gap-2 p-2 rounded cursor-pointer ${item.selected ? 'selected' : ''}">
                <div class="w-1.5 h-1.5 rounded-full" style="background-color:${item.color}"></div>
                <div class="flex-1 min-w-0"><p class="text-[10px] font-bold truncate ${item.selected ? 'text-blue-700' : 'text-slate-600'}">${item.name}</p></div>
                <div class="flex items-center gap-2" onclick="event.stopPropagation()">
                    <input type="color" value="${item.color}" onchange="window.changeColor('${type}', ${i}, this.value)">
                    <button onclick="window.removeFile('${type}', ${i})" class="text-slate-300 hover:text-red-500 text-xs font-bold px-1">×</button>
                </div>
            </div>`).join('');
    };
    render('test-file-list', state.tests, 'test');
    render('db-file-list', state.dbs, 'db');
};

// Toggle selection and manage data loading/unloading
window.toggleFileSelection = function(type, i, event) {
    const list = type === 'test' ? window.appState[window.activeTabId].tests : window.appState[window.activeTabId].dbs;
    const item = list[i];
    const lastIndexKey = type === 'test' ? '_lastSelectedTestIndex' : '_lastSelectedDbIndex';

    if (event && event.shiftKey && window[lastIndexKey] !== undefined) {
        const start = Math.min(window[lastIndexKey], i), end = Math.max(window[lastIndexKey], i);
        for (let j = start; j <= end; j++) {
            const file = list[j];
            file.selected = !item.selected;  // toggle all to same state
            if (file.selected && !file.data) {
                // Load data from IndexedDB asynchronously
                window.fileDB.loadFileData(file._uid).then(data => {
                    file.data = data;
                    window.updateUI();
                });
            } else if (!file.selected && file.data) {
                delete file.data;   // free memory
            }
        }
    } else {
        const willBeSelected = !item.selected;
        item.selected = willBeSelected;
        window[lastIndexKey] = i;
        if (willBeSelected && !item.data) {
            window.fileDB.loadFileData(item._uid).then(data => {
                item.data = data;
                window.updateUI();
            });
        } else if (!willBeSelected && item.data) {
            delete item.data;
        }
    }
    window.scheduleProgressiveUpdate();
};

window.changeColor = function(type, i, color) {
    (type === 'test' ? window.appState[window.activeTabId].tests : window.appState[window.activeTabId].dbs)[i].color = color;
    window.scheduleProgressiveUpdate();
};

window.removeFile = function(type, i) {
    const list = type === 'test' ? window.appState[window.activeTabId].tests : window.appState[window.activeTabId].dbs;
    const file = list[i];
    if (file && file._uid) {
        Object.keys(window.TAB_CONFIG).forEach(tabId => {
            window.dataCache.deleteByPrefix(tabId + '_' + file._uid);
            window.featureCache.deleteByPrefix(file._uid);
        });
        window.fileDB.removeFile(file._uid);
    }
    list.splice(i, 1);
    const lastIndexKey = type === 'test' ? '_lastSelectedTestIndex' : '_lastSelectedDbIndex';
    if (window[lastIndexKey] === i) window[lastIndexKey] = undefined;
    else if (window[lastIndexKey] > i) window[lastIndexKey]--;
    window.globalFeatureStats = null;
    window.scheduleProgressiveUpdate();
};

window.buildMetricsUI = function() {
    document.getElementById('metrics-container').innerHTML = window.TAB_CONFIG[window.activeTabId].metrics.map(m =>
        `<label class="flex items-center justify-between p-2 hover:bg-slate-50 rounded cursor-pointer group">
            <div class="flex items-center gap-2">
                <input type="checkbox" onchange="window.toggleMetric('${m.id}')" ${window.appState[window.activeTabId].activeMetrics.includes(m.id) ? 'checked' : ''} class="w-4 h-4 accent-blue-600">
                <span class="text-sm font-medium text-slate-700">${m.label}</span>
            </div>
        </label>`).join('');
};

window.toggleMetric = function(id) {
    const m = window.appState[window.activeTabId].activeMetrics;
    window.appState[window.activeTabId].activeMetrics = m.includes(id) ? m.filter(x => x !== id) : [...m, id];
    window.scheduleProgressiveUpdate();
};