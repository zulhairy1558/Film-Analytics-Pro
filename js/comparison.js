// Comparison algorithms: stress-specific and generic
// Now with Sakoe-Chiba band for DTW (20% of curve length)

function calculateStressSimilarity(testPts, refPts, testUltStrain, refUltStrain, ultStrainTol, forceDevTol) {
    if (!testPts.length || !refPts.length) return failureResult();

    const strainDevPct = Math.abs(testUltStrain - refUltStrain) / Math.max(refUltStrain, 1e-9) * 100;
    let coverageScore = 100;
    if (strainDevPct > ultStrainTol) {
        const maxPenaltyRange = 50;
        coverageScore = Math.max(0, 100 - (strainDevPct - ultStrainTol) * (100 / (maxPenaltyRange - ultStrainTol)));
    }

    const minUltStrain = Math.min(testUltStrain, refUltStrain);
    const sampleCount = 100;
    let violationCount = 0;
    for (let i = 0; i < sampleCount; i++) {
        const strain = (i / (sampleCount - 1)) * minUltStrain;
        const testForce = interpolateCurve(testPts, strain);
        const refForce = interpolateCurve(refPts, strain);
        const devPct = Math.abs(testForce - refForce) / Math.max(Math.abs(refForce), 1e-9) * 100;
        if (devPct > forceDevTol) violationCount++;
    }
    const forceScore = 100 * (1 - violationCount / sampleCount);

    const testVals = [], refVals = [];
    for (let i = 0; i <= sampleCount; i++) {
        const strain = (i / sampleCount) * minUltStrain;
        testVals.push(interpolateCurve(testPts, strain));
        refVals.push(interpolateCurve(refPts, strain));
    }

    // ----- Sakoe-Chiba band DTW (20% of length) -----
    const band = Math.max(1, Math.floor(sampleCount * 0.2));
    let dtwMat = [new Float32Array(sampleCount + 1).fill(Infinity)];
    dtwMat[0][0] = 0;
    for (let i = 1; i <= sampleCount; i++) {
        dtwMat[i] = new Float32Array(sampleCount + 1).fill(Infinity);
        const jStart = Math.max(1, i - band);
        const jEnd = Math.min(sampleCount, i + band);
        for (let j = jStart; j <= jEnd; j++) {
            const cost = Math.abs(testVals[i-1] - refVals[j-1]);
            dtwMat[i][j] = cost + Math.min(
                dtwMat[i-1][j],
                dtwMat[i][j-1],
                dtwMat[i-1][j-1]
            );
        }
    }
    const maxRefVal = Math.max(...refVals, 1e-9);
    const normalizedDTW = (dtwMat[sampleCount][sampleCount] / sampleCount) / maxRefVal * 100;
    const shapeScore = Math.max(0, 100 - normalizedDTW);

    const similarity = (coverageScore / 100) * (forceScore / 100) * (shapeScore / 100) * 100;

    let remarks = [];
    if (strainDevPct > ultStrainTol) remarks.push(`Ult strain deviation ${strainDevPct.toFixed(1)}%`);
    if (forceScore < 90) remarks.push(`Force out of tolerance (${(100 - forceScore).toFixed(1)}% points)`);
    if (shapeScore < 80) remarks.push(`Shape divergence (DTW: ${normalizedDTW.toFixed(1)})`);
    if (remarks.length === 0 && similarity >= 80) remarks.push('Strong reference match');
    else if (remarks.length === 0) remarks.push('Minor accumulated deviations');

    return {
        similarity: Number(similarity.toFixed(1)),
        overlapSimilarity: Number(shapeScore.toFixed(1)),
        coverageFactor: Number((coverageScore / 100).toFixed(2)),
        bandViolationPct: 0,
        meanAbsPct: 0,
        aucDiffPct: 0,
        corr: 0,
        remarks: remarks
    };
}

function calculateGenericComparison(testPts, refPts, upperTol, lowerTol, tabId, options = {}) {
    if (!testPts.length || !refPts.length) return failureResult();

    const minX = Math.max(testPts[0].x, refPts[0].x);
    const maxX = Math.min(testPts[testPts.length - 1].x, refPts[refPts.length - 1].x);
    if (!isFinite(minX) || !isFinite(maxX) || maxX <= minX) return failureResult();

    const testVals = [], refVals = [];
    let sumSq = 0, sumAbsPct = 0, outside = 0;
    let aucTest = 0, aucRef = 0;
    let prevTest = interpolateCurve(testPts, minX), prevRef = interpolateCurve(refPts, minX), prevX = minX;
    let maxLocalAbsPct = 0;
    const samples = 200;
    const localWindowSize = 10;
    let localErrors = [];

    for (let i = 0; i <= samples; i++) {
        const x = minX + (maxX - minX) * (i / samples);
        const t = interpolateCurve(testPts, x);
        const r = interpolateCurve(refPts, x);
        testVals.push(t); refVals.push(r);
        const diff = t - r;
        sumSq += diff * diff;
        const denom = Math.max(Math.abs(r), 1e-9);
        const absPct = (Math.abs(diff) / denom) * 100;
        sumAbsPct += absPct;

        localErrors.push(absPct);
        if (localErrors.length > localWindowSize) localErrors.shift();
        if (localErrors.length === localWindowSize) {
            const localAvg = localErrors.reduce((a, b) => a + b, 0) / localWindowSize;
            if (localAvg > maxLocalAbsPct) maxLocalAbsPct = localAvg;
        }

        const upper = r * (1 + upperTol / 100);
        const lower = r * (1 - lowerTol / 100);
        if (t > upper || t < lower) outside++;

        if (i > 0) {
            const dx = x - prevX;
            aucTest += ((prevTest + t) / 2) * dx;
            aucRef += ((prevRef + r) / 2) * dx;
        }
        prevX = x; prevTest = t; prevRef = r;
    }

    // ----- Sakoe-Chiba band DTW (20% of samples) -----
    const band = Math.max(1, Math.floor(samples * 0.2));
    let dtwMat = [new Float32Array(samples + 1).fill(Infinity)];
    dtwMat[0][0] = 0;
    for (let i = 1; i <= samples; i++) {
        dtwMat[i] = new Float32Array(samples + 1).fill(Infinity);
        const jStart = Math.max(1, i - band);
        const jEnd = Math.min(samples, i + band);
        for (let j = jStart; j <= jEnd; j++) {
            const cost = Math.abs(testVals[i-1] - refVals[j-1]);
            dtwMat[i][j] = cost + Math.min(
                dtwMat[i-1][j],
                dtwMat[i][j-1],
                dtwMat[i-1][j-1]
            );
        }
    }
    const maxRefVal = Math.max(...refVals, 1e-9);
    const normalizedDTW = (dtwMat[samples][samples] / samples) / maxRefVal * 100;

    const n = testVals.length;
    const meanAbsPct = sumAbsPct / n;
    const bandViolationPct = (outside / n) * 100;
    const aucDiffPct = Math.abs(aucTest - aucRef) / Math.max(Math.abs(aucRef), Math.abs(aucTest), 1e-9) * 100;
    const corr = pearsonCorrelation(testVals, refVals);

    const WEIGHTS = {
        tear: { force: 0.20, shape: 0.25, band: 0.15, energy: 0.40 },
        puncture: { force: 0.40, shape: 0.25, band: 0.10, energy: 0.25 },
        cling: { force: 0.60, shape: 0.20, band: 0.20, energy: 0.00 }
    };
    const wp = WEIGHTS[tabId] || WEIGHTS.puncture;

    const shapeScore = Math.max(0, 100 - normalizedDTW);
    const forceMatch = Math.max(0, 100 - meanAbsPct);
    const bandFit = Math.max(0, 100 - bandViolationPct);
    const energyMatch = Math.max(0, 100 - aucDiffPct);
    let overlapSimilarity = (shapeScore * wp.shape) + (forceMatch * wp.force) + (bandFit * wp.band) + (energyMatch * wp.energy);

    const testMaxX = testPts[testPts.length - 1].x, refMaxX = refPts[refPts.length - 1].x;
    const extentRatio = Math.min(testMaxX, refMaxX) / Math.max(testMaxX, refMaxX, 1e-9);
    let extentCoverage = 100;
    if (extentRatio < 0.90) {
        extentCoverage = 100 - ((0.90 - extentRatio) * 120);
        extentCoverage = Math.max(40, extentCoverage);
    }
    let breakTimeCoverage = 100;
    if (tabId === 'tear' && options.breakTimeTol !== undefined && options.testBreakTime != null && options.refBreakTime != null) {
        const btTol = options.breakTimeTol / 100;
        const refBT = options.refBreakTime, testBT = options.testBreakTime;
        const btDeviation = Math.abs(testBT - refBT) / Math.max(refBT, 1e-9);
        if (btDeviation > btTol) {
            const penalty = Math.min(100, (btDeviation - btTol) * 60);
            breakTimeCoverage = Math.max(0, 100 - penalty);
        }
        extentCoverage = (extentCoverage * 0.5) + (breakTimeCoverage * 0.5);
    }

    let localDefectPenalty = 0;
    if (maxLocalAbsPct > 20) {
        localDefectPenalty = Math.min(25, (maxLocalAbsPct - 20) * 0.5);
    }
    let finalSimilarity = (overlapSimilarity * 0.85) + (extentCoverage * 0.15) - localDefectPenalty;
    finalSimilarity = Math.max(0, Math.min(100, finalSimilarity));

    let remarks = [];
    if (bandViolationPct > 15) remarks.push('>15% of curve out of band');
    if (aucDiffPct > 15) remarks.push(`Energy deviation (${aucDiffPct.toFixed(1)}%)`);
    if (normalizedDTW > 20) remarks.push(`Shape divergence (DTW: ${normalizedDTW.toFixed(1)})`);
    if (maxLocalAbsPct > 20) remarks.push(`⚠️ Local anomaly detected (${maxLocalAbsPct.toFixed(1)}% error)`);
    if (tabId === 'tear' && breakTimeCoverage < 80) remarks.push(`Break time mismatch`);
    if (extentRatio < 0.85) remarks.push(`Extent mismatch (${(extentRatio * 100).toFixed(0)}% overlap)`);
    if (remarks.length === 0 && finalSimilarity >= 80) remarks.push('Strong reference match');
    else if (remarks.length === 0) remarks.push('Minor accumulated deviations');

    return {
        similarity: Number(finalSimilarity.toFixed(1)),
        overlapSimilarity: Number(overlapSimilarity.toFixed(1)),
        coverageFactor: Number((extentCoverage / 100).toFixed(2)),
        bandViolationPct: Number(bandViolationPct.toFixed(1)),
        meanAbsPct: Number(meanAbsPct.toFixed(1)),
        aucDiffPct: Number(aucDiffPct.toFixed(1)),
        corr: Number(corr.toFixed(3)),
        remarks: remarks
    };
}

// Expose to global scope for main thread usage
window.calculateStressSimilarity = calculateStressSimilarity;
window.calculateGenericComparison = calculateGenericComparison;