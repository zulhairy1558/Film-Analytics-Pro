// Chart initialization and update logic
window.mainChart = null;

window.initChart = function() {
    const customCanvasBackgroundColor = {
        id: 'customCanvasBackgroundColor',
        beforeDraw: (chart, args, options) => {
            const ctx = chart.ctx; ctx.save(); ctx.globalCompositeOperation='destination-over';
            ctx.fillStyle = options.color || '#ffffff'; ctx.fillRect(0,0,chart.width,chart.height); ctx.restore();
        }
    };
    window.mainChart = new Chart(document.getElementById('mainChart'), {
        type: 'line',
        data: { datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    type:'linear',
                    title:{display:true,font:{size:10,weight:'bold'}},
                    grid:{color:'#f1f5f9'}
                },
                y: {
                    min: 0,               // force y-axis to start at zero
                    suggestedMin: 0,
                    title:{display:true,font:{size:10,weight:'bold'}},
                    grid:{color:'#f1f5f9'}
                }
            },
            plugins: {
                customCanvasBackgroundColor: { color: 'white' },
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 8,
                        font: { size:11, family:"'Montserrat', sans-serif" },
                        filter: (item) => !item.text.includes('-Low') && !item.text.includes('-Range') && !item.text.includes('Deviation')
                    }
                },
                annotation: { annotations: {} }
            }
        },
        plugins: [customCanvasBackgroundColor]
    });
};

window.updateChartFull = function() {
    const state = window.appState[window.activeTabId];
    const cfg = window.TAB_CONFIG[window.activeTabId];
    const activeMetrics = cfg.metrics.filter(m => state.activeMetrics.includes(m.id));
    const datasets = [], ann = {};
    const activeRefs = state.dbs.filter(d => d.selected);
    const activeTests = state.tests.filter(t => t.selected);
    const renderedTests = new Set(), renderedRefs = new Set();
    const ndrDisplayArray = [];

    if (window.activeTabId === 'stress' && window.appState.showOptimum) {
        [...activeRefs, ...activeTests].forEach((item, idx) => {
            const ndrVal = window.calculateNDR(item.data);
            if (ndrVal) {
                ndrDisplayArray.push(
                    `<span class="ndr-legend-item" style="--ndr-color:${item.color}">
                        <span class="ndr-dot" style="background:${item.color}"></span>
                        ${item.name}: ${ndrVal.toFixed(1)}%
                    </span>`
                );
                ann['ndrLine_' + item._uid] = {
                    type: 'line',
                    xMin: ndrVal,
                    xMax: ndrVal,
                    borderColor: item.color,
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    label: {
                        display: false            // <--- disable the on‑chart label
                    }
                };
            }
        });
    }
    document.getElementById('ndr-value-display').innerHTML =
        ndrDisplayArray.length > 0
            ? '<span class="text-white font-semibold mr-3">NDR Legend:</span>' + ndrDisplayArray.join('')
            : '';

    activeRefs.forEach(ref => {
        if (!renderedRefs.has(ref._uid)) {
            renderedRefs.add(ref._uid);
            activeMetrics.forEach(m => {
                datasets.push({label:ref.name+'-'+m.label+'-Low', data:window.processFileData(ref,m.id,'lower'), pointRadius:0, borderColor:'transparent', backgroundColor:'transparent', fill:false});
                datasets.push({label:ref.name+'-'+m.label+'-Range', data:window.processFileData(ref,m.id,'upper'), pointRadius:0, borderColor:'transparent', backgroundColor:ref.color+'18', fill:'-1'});
                datasets.push({label:'[REF] '+ref.name+' ('+m.label+')', data:window.processFileData(ref,m.id,'none'), borderColor:ref.color, borderWidth:1.5, borderDash:m.dash, pointRadius:0});
            });
        }
    });
    activeTests.forEach(test => {
        if (!renderedTests.has(test._uid)) {
            renderedTests.add(test._uid);
            activeMetrics.forEach(m => {
                datasets.push({label:'[TEST] '+test.name+' ('+m.label+')', data:window.processFileData(test,m.id,'none'), borderColor:test.color, borderWidth:2, borderDash:m.dash, pointRadius:1});
            });
        }
    });
    if (window.appState.showAnomalies && activeRefs.length>0) {
        const anomalies = [];
        activeTests.forEach(test => {
            const bestRef = window.getFilteredRefsForTest(test, activeRefs)[0];
            if (bestRef) {
                activeMetrics.forEach(m => {
                    const data = window.processFileData(test,m.id,'none'), up = window.processFileData(bestRef,m.id,'upper'), low = window.processFileData(bestRef,m.id,'lower');
                    data.forEach((p,idx) => {
                        if ((p.y>window.lerp(up,p.x)||p.y<window.lerp(low,p.x)) && idx%10===0) anomalies.push(p);
                    });
                });
            }
        });
        if (anomalies.length>0) datasets.push({label:'Deviation',data:anomalies,type:'scatter',backgroundColor:'#ef4444',borderColor:'#fff',borderWidth:1,pointRadius:4,order:-1});
    }
    window.mainChart.options.plugins.annotation.annotations = ann;
    window.mainChart.data.datasets = datasets;
    window.mainChart.update();
    window.updateTableFull();
    window.updateFileList();
};