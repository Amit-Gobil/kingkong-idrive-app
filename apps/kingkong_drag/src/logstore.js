'use strict';
/**
 * The logs on the head unit: one CSV per engine run, written in batches (the unit's flash memory should
 * not get a write for every row), the oldest removed when the folder is over its limit.
 */
const fs = require('fs');
const path = require('path');

const MIN_SECONDS = 30;          // a shorter run is thrown away
const FLUSH_MS = 10000;
const MAX_FILE_BYTES = 10 * 1048576;   // a longer run continues in a new file, so the folder limit holds during a run

const two = (n) => String(n).padStart(2, '0');
function stamp(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

class LogStore {
    /** opts: { dir, maxBytes, columns: [{ key, head, d }], log } */
    constructor(opts) {
        Object.assign(this, opts);
        this.file = null;
        this.rows = [];
        try { fs.mkdirSync(this.dir); } catch (e) { /* it exists */ }
    }

    get active() { return !!this.file; }

    begin(now) {
        if (this.file) return;
        this.file = path.join(this.dir, `kingkong_${stamp(Date.now())}.csv`);
        this.startedAt = now;
        this.flushedAt = now;
        this.written = 0;
        this.rows = ['Time (s),' + this.columns.map((c) => c.head).join(',')];
    }

    row(now, values) {
        if (!this.file) return;
        const cells = this.columns.map((c) => {
            const v = values[c.key];
            return typeof v === 'number' && isFinite(v) ? v.toFixed(c.d) : '';
        });
        this.rows.push(((now - this.startedAt) / 1000).toFixed(3) + ',' + cells.join(','));
        if (now - this.flushedAt >= FLUSH_MS) this._flush(now);
    }

    _flush(now) {
        if (!this.rows.length) return;
        const text = this.rows.join('\n') + '\n';
        this.rows = [];
        this.flushedAt = now;
        const file = this.file;
        fs.appendFile(file, text, (e) => { if (e) this.log.warn('log write: ' + e.message); });
        this.written += text.length;
        if (this.written >= MAX_FILE_BYTES) { this.end(now); this.begin(now); }
    }

    /** Ends the run. Synchronous, so it also works in the last moments before the head unit shuts down. */
    end(now) {
        if (!this.file) return;
        const file = this.file;
        const seconds = (now - this.startedAt) / 1000;
        this.file = null;
        try {
            if (this.rows.length) fs.appendFileSync(file, this.rows.join('\n') + '\n');
            if (seconds < MIN_SECONDS) fs.unlinkSync(file);
        } catch (e) { this.log.warn('log end: ' + e.message); }
        this.rows = [];
        this.prune();
    }

    list() {
        let names = [];
        try { names = fs.readdirSync(this.dir).filter((n) => /^kingkong_.*\.csv(\.sent)?$/.test(n)).sort(); } catch (e) { /* none yet */ }
        return names.map((name) => {
            let size = 0;
            try { size = fs.statSync(path.join(this.dir, name)).size; } catch (e) { /* gone */ }
            return { name, size };
        });
    }

    prune() {
        const files = this.list();
        let total = files.reduce((n, f) => n + f.size, 0);
        for (const f of files) {
            if (total <= this.maxBytes) break;
            try { fs.unlinkSync(path.join(this.dir, f.name)); total -= f.size; } catch (e) { /* leave it */ }
        }
    }
}

module.exports = { LogStore };
