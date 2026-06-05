// Global application state and related helpers

// 1. INITIALIZE STATE IMMEDIATELY
window.appState = JSON.parse(JSON.stringify(window.INITIAL_STATE));
window.activeTabId = window.DEFAULT_ACTIVE_TAB;
window.globalFeatureStats = null;

// 2. FEATURE EXTRACTION
window.computeFeatureVector = function(fileData, tabId) {
    const cacheKey = fileData._uid + '_' + tabId;
    if (window.featureCache.get(cacheKey)) return window.featureCache.get(cacheKey);
    if (!fileData) return null;   // guard against missing data (lazy loading)
    const table = fileData.entries?.table || [];
    if (!table.length) return null;
    let pts = [];
    if (tabId === 'stress') {
        const ultStrain = fileData.calculation?.ultimate_strain || 100;
        const maxID = Math.max(...table.map(e => e.target_id || 0)) || 1;
        pts = table.map(e => ({ x: ((e.target_id || 0) / maxID) * ultStrain, y: e.stretch_force_median || 0 }));
    } else if (tabId === 'tear' || tabId === 'cling') {
        pts = table.map(e => ({ x: e.time_stamp || 0, y: e.force || 0 }));
    } else if (tabId === 'puncture') {
        pts = table.map(e => ({ x: e.position || 0, y: e.force || 0 }));
    }
    pts.sort((a, b) => a.x - b.x);
    const features = window.computeAdvancedFeatures(pts, fileData, tabId);
    if (features) window.featureCache.set(cacheKey, features);
    return features;
};

window.computeAdvancedFeatures = function(pts, fileData, tabId) {
    if (!pts.length) return null;
    const auc = window.calculateAUC(pts, tabId);
    const peak = Math.max(...pts.map(p => p.y));
    const centroidX = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const centroidY = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const variance = pts.reduce((s, p) => s + Math.pow(p.y - centroidY, 2), 0) / pts.length;
    const firstQuarter = pts.slice(0, Math.floor(pts.length / 4));
    const lastQuarter = pts.slice(-Math.floor(pts.length / 4));
    const slopeEarly = firstQuarter.length > 1
        ? (firstQuarter[firstQuarter.length - 1].y - firstQuarter[0].y) / (firstQuarter[firstQuarter.length - 1].x - firstQuarter[0].x)
        : 0;
    const slopeLate = lastQuarter.length > 1
        ? (lastQuarter[lastQuarter.length - 1].y - lastQuarter[0].y) / (lastQuarter[lastQuarter.length - 1].x - lastQuarter[0].x)
        : 0;
    const curvatures = [];
    for (let i = 2; i < pts.length; i++) {
        const h = pts[i].x - pts[i - 1].x;
        if (h === 0) continue;
        curvatures.push(Math.abs((pts[i].y - 2 * pts[i - 1].y + pts[i - 2].y) / (h * h)));
    }
    const curvatureEntropy = curvatures.length
        ? -curvatures.reduce((s, c) => s + (c > 0 ? c * Math.log(c + 1e-9) : 0), 0) / curvatures.length
        : 0;
    const inflections = [];
    for (let i = 2; i < pts.length; i++) {
        const h = pts[i].x - pts[i - 1].x;
        if (h === 0) continue;
        const deriv = (pts[i].y - pts[i - 1].y) / h;
        const prevDeriv = (pts[i - 1].y - pts[i - 2].y) / h;
        if (deriv * prevDeriv < 0) inflections.push(i);
    }
    const inflectionDensity = inflections.length / Math.max(1, pts.length);
    let derivativeEnergy = 0;
    for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        const dy = pts[i].y - pts[i - 1].y;
        derivativeEnergy += (dy / dx) * (dy / dx) * dx;
    }
    return {
        auc, peak, centroidX, centroidY, variance,
        slopeEarly, slopeLate,
        rangeX: pts[pts.length - 1].x - pts[0].x,
        curvatureEntropy, inflectionDensity, derivativeEnergy
    };
};

// 3. PRE-FILTERING / GLOBAL STATS
window.computeGlobalFeatureStats = function() {
    const allFeatures = [];
    for (const tabId of Object.keys(window.TAB_CONFIG)) {
        const tab = window.appState[tabId];
        if (!tab) continue;
        [...tab.tests, ...tab.dbs].forEach(file => {
            const features = window.featureCache.get(file._uid + '_' + tabId);
            if (features) allFeatures.push(features);
        });
    }
    if (allFeatures.length === 0) return null;
    const keys = ['auc', 'peak', 'centroidX', 'centroidY', 'variance', 'slopeEarly', 'slopeLate', 'curvatureEntropy', 'derivativeEnergy'];
    const stats = {};
    keys.forEach(key => {
        const values = allFeatures.map(f => f[key]).filter(v => isFinite(v) && v !== null);
        if (values.length === 0) { stats[key] = { mean: 0, std: 1 }; return; }
        const m = window.mean(values);
        const std = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - m, 2), 0) / values.length);
        stats[key] = { mean: m, std: std || 1 };
    });
    return stats;
};

window.normalizedVectorDistance = function(f1, f2) {
    if (!f1 || !f2) return Infinity;
    if (!window.globalFeatureStats) window.globalFeatureStats = window.computeGlobalFeatureStats();
    if (!window.globalFeatureStats) return Infinity;
    const keys = ['auc', 'peak', 'centroidX', 'slopeEarly', 'slopeLate', 'curvatureEntropy', 'derivativeEnergy'];
    let sumSq = 0;
    keys.forEach(key => {
        const stats = window.globalFeatureStats[key];
        const z1 = (f1[key] - stats.mean) / stats.std;
        const z2 = (f2[key] - stats.mean) / stats.std;
        sumSq += Math.pow(z1 - z2, 2);
    });
    return Math.sqrt(sumSq / keys.length);
};

window.getFilteredRefsForTest = function(test, allRefs) {
    if (!window.appState.usePrefilter || allRefs.length <= 5) return allRefs;
    const testFeat = window.featureCache.get(test._uid + '_' + window.activeTabId);
    if (!testFeat) return allRefs;
    if (!window.globalFeatureStats || Math.random() < 0.1) window.globalFeatureStats = window.computeGlobalFeatureStats();
    return allRefs.map(ref => ({
        ref,
        dist: window.featureCache.get(ref._uid + '_' + window.activeTabId)
            ? window.normalizedVectorDistance(testFeat, window.featureCache.get(ref._uid + '_' + window.activeTabId))
            : 999
    })).sort((a, b) => a.dist - b.dist).slice(0, 5).map(s => s.ref);
};

// 4. NDR CALCULATION
window.calculateNDR = function(fileData) {
    if (!fileData) return null;
    const table = fileData.entries?.table || [];
    if (!table.length) return null;
    const ultStrain = fileData.calculation?.ultimate_strain || 100;
    const maxID = Math.max(...table.map(e => e.target_id || 0)) || 1;
    const data = table
        .map(e => ({ x: ((e.target_id || 0) / maxID) * ultStrain, y: e.stretch_force_median || 0 }))
        .filter(p => isFinite(p.x) && isFinite(p.y))
        .sort((a, b) => a.x - b.x);
    if (data.length < 20) return null;
    const getLine = d => {
        const n = d.length;
        if (n < 2) return { m: 0, c: 0 };
        let sX = 0, sY = 0, sXY = 0, sX2 = 0;
        d.forEach(p => { sX += p.x; sY += p.y; sXY += p.x * p.y; sX2 += p.x * p.x; });
        const m = (n * sXY - sX * sY) / (n * sX2 - sX * sX);
        return { m, c: (sY - m * sX) / n };
    };
    const windowSize = Math.max(5, Math.floor(data.length * 0.05));
    let slopes = [];
    let startIndex = Math.max(0, data.findIndex(p => p.x >= Math.min(10, ultStrain * 0.15)));
    for (let i = startIndex; i <= data.length - windowSize; i++) {
        const line = getLine(data.slice(i, i + windowSize));
        slopes.push({ index: i, m: line.m, c: line.c });
    }
    if (slopes.length < 2) return null;
    let minSlopeObj = slopes[0];
    for (let i = 0; i < slopes.length; i++) if (slopes[i].m < minSlopeObj.m) minSlopeObj = slopes[i];
    let maxSlopeObj = null;
    const searchStartIndex = slopes.indexOf(minSlopeObj) + Math.floor(windowSize / 2);
    if (searchStartIndex < slopes.length) {
        maxSlopeObj = slopes[searchStartIndex];
        for (let i = searchStartIndex; i < slopes.length; i++) if (slopes[i].m > maxSlopeObj.m) maxSlopeObj = slopes[i];
    }
    if (!maxSlopeObj || minSlopeObj.m === maxSlopeObj.m) return null;
    const ix = (maxSlopeObj.c - minSlopeObj.c) / (minSlopeObj.m - maxSlopeObj.m);
    return (ix > 0 && ix <= ultStrain * 1.05) ? ix : null;
};

// 5. CURVE PROCESSING (assumes file.data is already loaded for selected files)
window.processFileData = function(file, metric, tolMode = 'none') {
    if (!file || !file.data) return [];   // skip if data not loaded yet
    if (tolMode !== 'none') {
        const basePts = window.processFileData(file, metric, 'none');
        const tol = window.appState[window.activeTabId];
        if (!tol) return basePts;
        const factor = tolMode === 'upper' ? (1 + tol.upperTol / 100) : (1 - tol.lowerTol / 100);
        return basePts.map(p => ({ x: p.x, y: p.y * factor }));
    }
    const cacheKey = window.activeTabId + '_' + file._uid + '_' + metric + '_base';
    if (window.dataCache.get(cacheKey)) return window.dataCache.get(cacheKey);

    const table = file.data.entries?.table || [];
    if (!table.length) return [];
    let pts = [];
    if (window.activeTabId === 'stress') {
        const ultStrain = file.data.calculation?.ultimate_strain || 100;
        const maxID = Math.max(...table.map(e => e.target_id || 0)) || 1;
        pts = table.map(e => ({ x: ((e.target_id || 0) / maxID) * ultStrain, y: e[metric] || 0 }));
    } else if (window.activeTabId === 'tear' || window.activeTabId === 'cling') {
        pts = table.map(e => ({ x: e.time_stamp || 0, y: e[metric] || e.force || 0 }));
    } else if (window.activeTabId === 'puncture') {
        pts = table.map(e => ({ x: e.position || 0, y: e[metric] || e.force || 0 })).sort((a, b) => a.x - b.x);
        const maxY = Math.max(...pts.map(p => p.y));
        const onsetIndex = pts.findIndex(p => p.y >= maxY * 0.02);
        if (onsetIndex > -1) {
            const onsetX = pts[onsetIndex].x;
            pts = pts.map(p => ({ x: p.x - onsetX, y: p.y })).filter(p => p.x >= -5);
        }
    }
    if (window.activeTabId !== 'puncture') pts.sort((a, b) => a.x - b.x);
    if (pts.length > 800) pts = window.lttbDownsample(pts, 800);
    window.dataCache.set(cacheKey, pts);
    return pts;
};

window.extractStressSummary = function(fileData) {
    if (!fileData) return null;
    const table = fileData.entries?.table || [];
    if (!table.length) return null;
    const ultStrain = fileData.calculation?.ultimate_strain || 100;
    const maxID = Math.max(...table.map(e => e.target_id || 0)) || 1;
    const stretchCurve = table
        .map(e => ({ x: ((e.target_id || 0) / maxID) * ultStrain, y: e.stretch_force_median || 0 }))
        .sort((a, b) => a.x - b.x);
    const windCurve = table
        .map(e => ({ x: ((e.target_id || 0) / maxID) * ultStrain, y: e.wind_force_median || 0 }))
        .sort((a, b) => a.x - b.x);
    const ultStretchForce = Math.max(...stretchCurve.map(p => p.y), 0);
    const ultWindForce = Math.max(...windCurve.map(p => p.y), 0);
    const ndrVal = window.calculateNDR(fileData);
    return {
        ultStrain, ultStretchForce, ultWindForce, ndrVal,
        stretchAtNDR: ndrVal !== null ? window.interpolateCurve(stretchCurve, ndrVal) : null,
        windAtNDR: ndrVal !== null ? window.interpolateCurve(windCurve, ndrVal) : null
    };
};