'use strict';
/**
 * Sends finished logs to the member's garage on TuneInspect when the car has internet.
 * One file at a time, oldest first; without internet it just tries again later. A sent file is renamed
 * .sent and stays until the log folder needs the room.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');
const dns = require('dns');

const HOST = 'inspect.kingkongtuning.se';
const URL_PATH = '/api/car-app/logs';
const TIMEOUT_MS = 60000;
const MAX_BYTES = 4 * 1048576;

class Uploader {
    /**
     * The head unit's own name lookup can't reach the internet: names are resolved through the DNS servers
     * mgu-uplink gives this app. Its file exists only while the car is online.
     */
    _lookup() {
        let lease;
        try { lease = JSON.parse(fs.readFileSync(this.leaseFile, 'utf8')); } catch (e) { return null; }
        if (!lease || !Array.isArray(lease.dns) || !lease.dns.length) return null;
        const resolver = new dns.Resolver();
        resolver.setServers(lease.dns);
        return (host, options, cb) => resolver.resolve4(host, (e, addresses) => (e ? cb(e) : cb(null, addresses[0], 4)));
    }

    /** opts: { store, token, leaseFile, log } */
    constructor(opts) { Object.assign(this, opts); this.busy = false; this.stopped = false; }

    waiting() {
        const current = this.store.file ? path.basename(this.store.file) : null;
        return this.store.list().filter((f) => f.name.endsWith('.csv') && f.name !== current);
    }

    tick() {
        if (this.busy || this.stopped || !this.token) return Promise.resolve();
        const next = this.waiting()[0];
        if (!next) return Promise.resolve();
        const lookup = this._lookup();
        if (!lookup) return Promise.resolve();
        this.busy = true;
        const file = path.join(this.store.dir, next.name);
        return this._send(file, next.name, lookup)
            .catch((e) => { this.log.info('upload: ' + e.message); })
            .then(() => { this.busy = false; });
    }

    _send(file, name, lookup) {
        return new Promise((resolve, reject) => {
            const body = zlib.gzipSync(fs.readFileSync(file));
            if (body.length > MAX_BYTES) { fs.renameSync(file, file + '.sent'); resolve(); return; }
            const req = https.request({ host: HOST, path: URL_PATH + '?name=' + encodeURIComponent(name), method: 'POST', timeout: TIMEOUT_MS, lookup,
                headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/gzip', 'Content-Length': body.length } }, (res) => {
                res.resume();
                if (res.statusCode === 200 || res.statusCode === 413) fs.renameSync(file, file + '.sent');
                if (res.statusCode === 401) { this.stopped = true; this.log.warn('upload: licence refused'); }
                resolve();
            });
            req.on('timeout', () => req.abort());
            req.on('error', reject);
            req.end(body);
        });
    }
}

module.exports = { Uploader };
