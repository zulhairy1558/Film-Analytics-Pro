// Web Worker setup for offloading comparisons
// We build the worker script by embedding the source code of all needed
// functions as named function declarations.

window.comparisonWorker = (function () {
    // List of functions the worker needs. Each must be a named function declaration.
    // We get their source via .toString() and concatenate them, then add the
    // onmessage handler.
    const workerFunctions = [
        mean,
        computeRange,
        pearsonCorrelation,
        binarySearchIndex,
        interpolateCurve,
        failureResult,
        // from comparison.js
        calculateStressSimilarity,
        calculateGenericComparison
    ];

    const workerBlob = new Blob(
        [
            workerFunctions.map(fn => fn.toString()).join('\n\n'),
            // onmessage handler
            `
self.onmessage = function(e) {
    const batch = e.data;
    const results = [];
    for (var i = 0; i < batch.comparisons.length; i++) {
        var c = batch.comparisons[i];
        var result;
        if (c.tabId === 'stress') {
            result = calculateStressSimilarity(
                c.testPts, c.refPts,
                c.testUltStrain, c.refUltStrain,
                c.ultStrainTol, c.forceDevTol
            );
        } else {
            result = calculateGenericComparison(
                c.testPts, c.refPts,
                c.upperTol, c.lowerTol,
                c.tabId, c.options || {}
            );
        }
        results.push({ id: c.id, result: result });
    }
    self.postMessage({ batchId: batch.batchId, results: results });
};
`
        ],
        { type: 'application/javascript' }
    );

    return new Worker(URL.createObjectURL(workerBlob));
})();

window.workerBatchId = 0;
window.workerPendingResolvers = {};

window.comparisonWorker.onmessage = function (e) {
    const response = e.data;
    if (window.workerPendingResolvers[response.batchId]) {
        window.workerPendingResolvers[response.batchId](response.results);
        delete window.workerPendingResolvers[response.batchId];
    }
};

window.compareCurvesBatchAsync = function (comparisons) {
    return new Promise(resolve => {
        const batchId = ++window.workerBatchId;
        window.workerPendingResolvers[batchId] = resolve;
        window.comparisonWorker.postMessage({ batchId, comparisons });
    });
};