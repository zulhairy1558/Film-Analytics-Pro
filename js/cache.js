// LRU Cache and feature caching
window.LRUCache = class {
    constructor(maxSize = 100) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }
    get(key) {
        if (!this.cache.has(key)) return undefined;
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }
    set(key, value) {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.maxSize) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, value);
    }
    delete(key) { this.cache.delete(key); }
    deleteByPrefix(prefix) {
        for (const key of this.cache.keys()) if (key.startsWith(prefix)) this.cache.delete(key);
    }
    clear() { this.cache.clear(); }
};

window.dataCache = new LRUCache(200);
window.featureCache = new LRUCache(500);