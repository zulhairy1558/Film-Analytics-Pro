// Dexie‑based IndexedDB for storing raw file JSON data
// Keeps appState light, enables lazy loading of curve points

(function () {
    const db = new Dexie('FilmAnalyticsDB');
    db.version(1).stores({
        files: '++id, _uid, name, data'   // data is the original JSON object
    });

    // Store a file in IndexedDB and return its uid
    async function storeFile(fileItem) {
        const uid = fileItem._uid;
        await db.files.put({
            _uid: uid,
            name: fileItem.name,
            data: fileItem.data
        });
    }

    // Remove a file from IndexedDB
    async function removeFile(uid) {
        await db.files.where('_uid').equals(uid).delete();
    }

    // Load a file’s JSON data from IndexedDB (lazy loading)
    async function loadFileData(uid) {
        const record = await db.files.where('_uid').equals(uid).first();
        return record ? record.data : null;
    }

    // Clear all stored files
    async function clearAll() {
        await db.files.clear();
    }

    // Expose to global scope
    window.fileDB = {
        storeFile,
        removeFile,
        loadFileData,
        clearAll
    };
})();