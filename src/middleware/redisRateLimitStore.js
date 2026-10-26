const { getClient } = require('../config/redis');

// A rate-limit store that keeps its counters in Redis (shared by every API
// server). The real store (rate-limit-redis) is created the first time Redis is
// connected, not at start-up, so a Redis that is down while the API boots - or
// goes away later - never crashes the process: the limiter's `passOnStoreError`
// lets the request through and the store is retried on the next one.
class LazyRedisStore {
    constructor(prefix) {
        this.prefix = prefix;
        this.inner = null;
        this.options = null;
        this.localKeys = false; // counters are shared, not per process
    }

    init(options) {
        this.options = options;
    }

    async real() {
        const client = getClient();
        if (!client || !client.isReady) throw new Error('Redis is not connected');
        // A new connection (after Redis was restarted and the client replaced) needs its own store.
        if (!this.inner || this.client !== client) {
            const RedisStore = require('rate-limit-redis').default || require('rate-limit-redis');
            this.client = client;
            this.inner = new RedisStore({ sendCommand: (...args) => client.sendCommand(args), prefix: this.prefix });
            if (this.inner.init) this.inner.init(this.options);
        }
        return this.inner;
    }

    async get(key) {
        return (await this.real()).get(key);
    }

    async increment(key) {
        return (await this.real()).increment(key);
    }

    async decrement(key) {
        return (await this.real()).decrement(key);
    }

    async resetKey(key) {
        return (await this.real()).resetKey(key);
    }
}

module.exports = { LazyRedisStore };
