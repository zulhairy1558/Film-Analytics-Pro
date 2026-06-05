// Application-wide configuration constants
window.TAB_CONFIG = {
    'stress': {
        id: 'stress',
        title: 'Stress-Strain',
        subTitle: 'Force & Peel Angle Analysis',
        xAxis: 'Strain [%]',
        yAxis: 'Value [N / °]',
        metrics: [
            { id: 'stretch_force_median', label: 'Stretch Force', dash: [] },
            { id: 'unwind_force_median', label: 'Unwind Force', dash: [8,4] },
            { id: 'wind_force_median', label: 'Wind Force', dash: [2,3] },
            { id: 'peel_angle_median', label: 'Peel Angle', dash: [5,5,1,5] }
        ],
        hasAUC: true,
        aucUnit: 'J/m³'
    },
    'puncture': {
        id: 'puncture',
        title: 'Puncture',
        subTitle: 'Force vs. Position Profile',
        xAxis: 'Displacement [mm]',
        yAxis: 'Force [N]',
        metrics: [{ id: 'force', label: 'Force', dash: [] }],
        hasAUC: true,
        aucUnit: 'N·mm'
    },
    'tear': {
        id: 'tear',
        title: 'Tear Propagation',
        subTitle: 'Force vs. Time (5mm/s)',
        xAxis: 'Time [s]',
        yAxis: 'Force [N]',
        metrics: [{ id: 'force', label: 'Force', dash: [] }],
        hasAUC: true,
        aucUnit: 'N·mm'
    },
    'cling': {
        id: 'cling',
        title: 'Cling',
        subTitle: 'Force vs. Time',
        xAxis: 'Time [s]',
        yAxis: 'Force [N]',
        metrics: [{ id: 'force', label: 'Force', dash: [] }],
        hasAUC: false,
        aucUnit: ''
    }
};

window.PALETTE = ['#2563eb','#dc2626','#16a34a','#d97706','#7c3aed','#db2777','#0891b2','#4f46e5'];
window.DEFAULT_ACTIVE_TAB = 'stress';

// Initial empty app state structure (will be populated by state.js)
window.INITIAL_STATE = {
    showOptimum: true,
    showAnomalies: true,
    usePrefilter: true,
    showLegend: true,
    stress: { tests:[], dbs:[], activeMetrics:['stretch_force_median','unwind_force_median','wind_force_median','peel_angle_median'], upperTol:10, lowerTol:10, ultStrainTol:10, forceDevTol:7 },
    puncture: { tests:[], dbs:[], activeMetrics:['force'], upperTol:10, lowerTol:10 },
    tear: { tests:[], dbs:[], activeMetrics:['force'], upperTol:10, lowerTol:10, breakTimeTol:10 },
    cling: { tests:[], dbs:[], activeMetrics:['force'], upperTol:10, lowerTol:10 }
};