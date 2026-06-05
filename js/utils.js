// Mathematical and helper functions used across modules
// All functions are defined as named function declarations so they work both
// in the main thread and inside the Web Worker (via toString()).

function mean(arr) {
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function computeRange(arr) {
    return arr.length ? Math.max(...arr) - Math.min(...arr) : 0;
}

function pearsonCorrelation(a, b) {
    if (!a.length || a.length !== b.length) return 0;
    const ma = mean(a),
        mb = mean(b);
    let num = 0,
        da = 0,
        db = 0;
    for (let i = 0; i < a.length; i++) {
        const va = a[i] - ma,
            vb = b[i] - mb;
        num += va * vb;
        da += va * va;
        db += vb * vb;
    }
    const denom = Math.sqrt(da * db);
    return (denom === 0 || !isFinite(denom)) ? 0 : num / denom;
}

function binarySearchIndex(pts, targetX) {
    if (!pts.length) return 0;
    if (targetX <= pts[0].x) return 0;
    if (targetX >= pts[pts.length - 1].x) return pts.length - 1;
    let low = 0,
        high = pts.length - 1;
    while (low < high - 1) {
        const mid = Math.floor((low + high) / 2);
        if (pts[mid].x <= targetX) low = mid;
        else high = mid;
    }
    return low;
}

function interpolateCurve(pts, targetX) {
    if (!pts.length) return 0;
    if (targetX <= pts[0].x) return pts[0].y;
    if (targetX >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
    const i = binarySearchIndex(pts, targetX);
    const p1 = pts[i],
        p2 = pts[Math.min(i + 1, pts.length - 1)];
    const dx = p2.x - p1.x;
    if (dx === 0) return p2.y;
    return p1.y + ((targetX - p1.x) / dx) * (p2.y - p1.y);
}

function lerp(pts, x) {
    if (!pts.length) return 0;
    const i = binarySearchIndex(pts, x);
    const p1 = pts[i],
        p2 = pts[Math.min(i + 1, pts.length - 1)];
    return p1.y + (x - p1.x) * (p2.y - p1.y) / (p2.x - p1.x);
}

function lttbDownsample(data, threshold) {
    if (data.length <= threshold) return data;
    const sampled = [data[0]];
    const bucketSize = (data.length - 2) / (threshold - 2);
    for (let i = 0; i < threshold - 2; i++) {
        let avgX = 0,
            avgY = 0;
        const start = Math.floor((i + 1) * bucketSize) + 1;
        const end = Math.floor((i + 2) * bucketSize) + 1;
        const avgRange = data.slice(start, end);
        for (let j = 0; j < avgRange.length; j++) { avgX += avgRange[j].x;
            avgY += avgRange[j].y; }
        avgX /= avgRange.length;
        avgY /= avgRange.length;
        const rangeOffs = Math.floor(i * bucketSize) + 1;
        const rangeTo = Math.floor((i + 1) * bucketSize) + 1;
        const pointAX = data[rangeOffs].x,
            pointAY = data[rangeOffs].y;
        let maxArea = -1,
            maxAreaPoint = data[rangeOffs];
        for (let j = rangeOffs; j < rangeTo; j++) {
            let area = Math.abs((pointAX - avgX) * (data[j].y - pointAY) - (pointAX - data[j].x) * (avgY - pointAY));
            if (area > maxArea) { maxArea = area;
                maxAreaPoint = data[j]; }
        }
        sampled.push(maxAreaPoint);
    }
    sampled.push(data[data.length - 1]);
    return sampled;
}

function calculateAUC(pts, tabId) {
    let area = 0;
    for (let i = 1; i < pts.length; i++) {
        let dx = pts[i].x - pts[i - 1].x;
        if (tabId === 'tear') dx *= 5;
        area += ((pts[i].y + pts[i - 1].y) / 2) * dx;
    }
    return area;
}

function formatAUC(auc, tabId) {
    if (typeof auc !== 'number' || !isFinite(auc)) return '-';
    if (tabId === 'puncture' || tabId === 'tear') return (auc / 1000).toFixed(3) + ' J';
    else if (tabId === 'stress') return auc.toFixed(1) + ' J/m³';
    return auc.toFixed(2);
}

function validateJSONSchema(data) {
    if (!data || typeof data !== 'object' || !data.entries || !Array.isArray(data.entries.table) || data.entries.table.length === 0) return false;
    const row = data.entries.table[0];
    return (typeof row.target_id === 'number' || typeof row.time_stamp === 'number' || typeof row.position === 'number');
}

function failureResult() {
    return {
        similarity: 0,
        overlapSimilarity: 0,
        coverageFactor: 0,
        bandViolationPct: 100,
        meanAbsPct: 100,
        aucDiffPct: 100,
        corr: 0,
        remarks: ['Invalid or missing data']
    };
}

function showToast(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Attach to global scope for browser usage
window.mean = mean;
window.computeRange = computeRange;
window.pearsonCorrelation = pearsonCorrelation;
window.binarySearchIndex = binarySearchIndex;
window.interpolateCurve = interpolateCurve;
window.lerp = lerp;
window.lttbDownsample = lttbDownsample;
window.calculateAUC = calculateAUC;
window.formatAUC = formatAUC;
window.validateJSONSchema = validateJSONSchema;
window.failureResult = failureResult;
window.showToast = showToast;