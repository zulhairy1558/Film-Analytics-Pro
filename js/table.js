// Table intelligence and stress summary update
window.tableUpdateCounter = 0;

window.updateTableFull = function() {
    const requestId = ++window.tableUpdateCounter;
    const capturedTabId = window.activeTabId;
    const state = window.appState[capturedTabId];
    const cfg = window.TAB_CONFIG[capturedTabId];
    const tbody = document.getElementById('analysis-table-body');
    const headerRow = document.getElementById('analysis-header-row');
    const stressSummaryContainer = document.getElementById('stress-summary-container');
    const stressSummaryBody = document.getElementById('stress-summary-body');
    const metrics = cfg.metrics.filter(m => state.activeMetrics.includes(m.id));
    const refs = state.dbs.filter(d => d.selected);
    const tests = state.tests.filter(t => t.selected);

    let extraColumns = [];
    if (capturedTabId === 'puncture') extraColumns = ['Ref Max Force', 'Test Max Force'];
    else if (capturedTabId === 'tear') extraColumns = ['Ref Peak Force', 'Test Peak Force', 'Ref Break Time', 'Test Break Time'];
    else if (capturedTabId === 'cling') extraColumns = ['Ref Cling Force', 'Test Cling Force'];

    let headerHTML = `<th class="px-5 py-3">Sample</th><th class="px-5 py-3">Reference</th><th class="px-5 py-3">Metric</th><th class="px-5 py-3 text-right">Ref Energy</th><th class="px-5 py-3 text-right">Test Energy</th><th class="px-5 py-3 text-center">Similarity</th>`;
    extraColumns.forEach(col => headerHTML += `<th class="px-5 py-3 text-right">${col}</th>`);
    headerHTML += `<th class="px-5 py-3 text-left">QC Remarks</th><th class="px-5 py-3 text-right">Status</th>`;
    headerRow.innerHTML = headerHTML;

    if (!tests.length || !refs.length) {
        tbody.innerHTML = `<tr><td colspan="${8 + extraColumns.length}" class="py-10 text-center text-gray-400 italic">${!tests.length ? 'Add testing samples' : 'Select reference database'} to begin</td></tr>`;
        stressSummaryContainer.classList.add('hidden');
        return;
    }

    tbody.innerHTML = `<tr><td colspan="${8 + extraColumns.length}" class="py-6 text-center text-blue-500 font-semibold italic">Computing robust comparisons (DTW)...</td></tr>`;
    stressSummaryContainer.classList.add('hidden');

    const comparisonJobs = [], rowMeta = [], stressPairs = [];
    let jobId = 0;

    tests.forEach(test => {
        window.getFilteredRefsForTest(test, refs).forEach(ref => {
            if (capturedTabId === 'stress') {
                if (!stressPairs.find(p => p.testName === test.name && p.refName === ref.name)) {
                    stressPairs.push({ test, ref, testName: test.name, refName: ref.name });
                }
            }
            metrics.forEach(m => {
                const tPts = window.processFileData(test, m.id, 'none');
                const rPts = window.processFileData(ref, m.id, 'none');
                const job = {
                    id: jobId,
                    testPts: tPts,
                    refPts: rPts,
                    tabId: capturedTabId,
                    upperTol: state.upperTol,
                    lowerTol: state.lowerTol,
                    options: {}
                };
                if (capturedTabId === 'stress') {
                    job.testUltStrain = test.data?.calculation?.ultimate_strain || 100;
                    job.refUltStrain = ref.data?.calculation?.ultimate_strain || 100;
                    job.ultStrainTol = state.ultStrainTol || 10;
                    job.forceDevTol = state.forceDevTol || 7;
                }
                if (capturedTabId === 'tear') {
                    job.options.breakTimeTol = state.breakTimeTol || 10;
                    job.options.testBreakTime = test.data?.calculation?.time_to_break;
                    job.options.refBreakTime = ref.data?.calculation?.time_to_break;
                }
                comparisonJobs.push(job);
                rowMeta.push({
                    test,
                    ref,
                    metric: m,
                    refAUC: cfg.hasAUC ? window.calculateAUC(rPts, capturedTabId) : null,
                    testAUC: cfg.hasAUC ? window.calculateAUC(tPts, capturedTabId) : null
                });
                jobId++;
            });
        });
    });

    window.compareCurvesBatchAsync(comparisonJobs).then(results => {
        if (requestId !== window.tableUpdateCounter) return;
        const resultMap = {};
        results.forEach(r => resultMap[r.id] = r.result);
        let html = '';
        rowMeta.forEach((meta, i) => {
            const comp = resultMap[i] || window.failureResult();
            const isPass = comp.similarity >= 75;
            const simClass = comp.similarity >= 90 ? 'text-green-600' : comp.similarity >= 75 ? 'text-orange-500' : 'text-red-600';

            html += `<tr class="hover:bg-slate-50 transition-colors">
                <td class="px-5 py-3 font-bold">${meta.test.name}</td>
                <td class="px-5 py-3 text-slate-500">${meta.ref.name}</td>
                <td class="px-5 py-3 text-slate-400">${meta.metric.label}</td>
                <td class="px-5 py-3 text-right font-medium text-slate-500">${meta.refAUC !== null ? window.formatAUC(meta.refAUC, capturedTabId) : '-'}</td>
                <td class="px-5 py-3 text-right font-medium">${meta.testAUC !== null ? window.formatAUC(meta.testAUC, capturedTabId) : '-'}</td>
                <td class="px-5 py-3 text-center font-bold ${simClass}" title="Overlap Sim: ${comp.overlapSimilarity}% | Coverage: ${comp.coverageFactor}">${comp.similarity}%</td>`;

            if (capturedTabId === 'puncture') {
                const rMax = meta.ref.data?.calculation?.maximum;
                const tMax = meta.test.data?.calculation?.maximum;
                html += `<td class="px-5 py-3 text-right font-medium">${typeof rMax === 'number' ? rMax.toFixed(2) : '-'}</td>`;
                html += `<td class="px-5 py-3 text-right font-medium">${typeof tMax === 'number' ? tMax.toFixed(2) : '-'}</td>`;
            } else if (capturedTabId === 'tear') {
                const rPeak = meta.ref.data?.calculation?.max_force;
                const tPeak = meta.test.data?.calculation?.max_force;
                const rTime = meta.ref.data?.calculation?.time_to_break;
                const tTime = meta.test.data?.calculation?.time_to_break;
                html += `<td class="px-5 py-3 text-right font-medium">${typeof rPeak === 'number' ? rPeak.toFixed(2) : '-'}</td>`;
                html += `<td class="px-5 py-3 text-right font-medium">${typeof tPeak === 'number' ? tPeak.toFixed(2) : '-'}</td>`;
                html += `<td class="px-5 py-3 text-right font-medium">${typeof rTime === 'number' ? rTime.toFixed(3) : '-'}</td>`;
                html += `<td class="px-5 py-3 text-right font-medium">${typeof tTime === 'number' ? tTime.toFixed(3) : '-'}</td>`;
            } else if (capturedTabId === 'cling') {
                const rMed = meta.ref.data?.calculation?.median;
                const tMed = meta.test.data?.calculation?.median;
                html += `<td class="px-5 py-3 text-right font-medium">${typeof rMed === 'number' ? rMed.toFixed(4) : '-'}</td>`;
                html += `<td class="px-5 py-3 text-right font-medium">${typeof tMed === 'number' ? tMed.toFixed(4) : '-'}</td>`;
            }

            html += `<td class="px-5 py-3 text-left text-[11px] text-slate-500 whitespace-normal min-w-[160px]">${comp.remarks.map(r => `<span class="block">• ${r}</span>`).join('')}</td>
                <td class="px-5 py-3 text-right"><span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${isPass ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${isPass ? 'PASS' : 'FAIL'}</span></td></tr>`;
        });
        tbody.innerHTML = html;

        if (capturedTabId === 'stress') {
            stressSummaryContainer.classList.remove('hidden');
            stressSummaryBody.innerHTML = stressPairs.map(pair => {
                const tSum = window.extractStressSummary(pair.test.data);
                const rSum = window.extractStressSummary(pair.ref.data);
                if (!tSum || !rSum) return '';
                return `<tr class="hover:bg-slate-50"><td class="px-4 py-2 font-bold" rowspan="2">${pair.testName} vs ${pair.refName}</td>
                    <td class="px-4 py-2 font-semibold text-blue-600">REFERENCE</td>
                    <td class="px-4 py-2 text-right">${rSum.ultStrain.toFixed(1)}</td>
                    <td class="px-4 py-2 text-right">${rSum.ultStretchForce.toFixed(2)}</td>
                    <td class="px-4 py-2 text-right">${rSum.ultWindForce.toFixed(2)}</td>
                    <td class="px-4 py-2 text-right">${rSum.ndrVal !== null ? rSum.ndrVal.toFixed(1) : '-'}</td>
                    <td class="px-4 py-2 text-right">${rSum.stretchAtNDR !== null ? rSum.stretchAtNDR.toFixed(2) : '-'}</td>
                    <td class="px-4 py-2 text-right">${rSum.windAtNDR !== null ? rSum.windAtNDR.toFixed(2) : '-'}</td></tr>
                    <tr class="hover:bg-slate-50">
                    <td class="px-4 py-2 font-semibold text-orange-600">SAMPLE</td>
                    <td class="px-4 py-2 text-right">${tSum.ultStrain.toFixed(1)}</td>
                    <td class="px-4 py-2 text-right">${tSum.ultStretchForce.toFixed(2)}</td>
                    <td class="px-4 py-2 text-right">${tSum.ultWindForce.toFixed(2)}</td>
                    <td class="px-4 py-2 text-right">${tSum.ndrVal !== null ? tSum.ndrVal.toFixed(1) : '-'}</td>
                    <td class="px-4 py-2 text-right">${tSum.stretchAtNDR !== null ? tSum.stretchAtNDR.toFixed(2) : '-'}</td>
                    <td class="px-4 py-2 text-right">${tSum.windAtNDR !== null ? tSum.windAtNDR.toFixed(2) : '-'}</td></tr>`;
            }).join('') || '<tr><td colspan="8" class="py-4 text-center text-gray-400 italic">No data</td></tr>';
        } else {
            stressSummaryContainer.classList.add('hidden');
        }
    }).catch(err => {
        if (requestId === window.tableUpdateCounter) {
            tbody.innerHTML = `<tr><td colspan="${8 + extraColumns.length}" class="py-6 text-center text-red-500 font-semibold">Comparison error. Please retry.</td></tr>`;
            console.error(err);
        }
    });
};