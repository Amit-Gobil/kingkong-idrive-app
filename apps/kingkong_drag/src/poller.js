'use strict';
/**
 * Bus: one diagnostic job at a time, commands ahead of the polling.
 * Poller: reads the DME channels while should() is true. should() is the engine-running guard: it is
 * checked again right before every request, so nothing is sent to the DME once the engine has stopped
 * (a flash with MHD or ISTA is done with the engine off).
 */
const { replyTo } = require('./diag.js');
const { CHANNELS, SLOW_EVERY, readers, request, parse, obdRequest, obdParse, batches } = require('./channels.js');

const DME = 0x12;
const GAP_MS = 25;
const TIMEOUT_MS = 1500;
const OBD_TIMEOUT_MS = 400;     // OBD is only a fallback; never let a non-answer slow the bus
const REPROBE_AFTER_FAILS = 5;
const REPROBE_WAIT_MS = 10000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Bus {
    constructor() { this.q = []; this.busy = false; }

    run(fn, urgent) {
        return new Promise((resolve, reject) => {
            const job = { fn, resolve, reject };
            if (urgent) this.q.unshift(job); else this.q.push(job);
            this._next();
        });
    }

    _next() {
        if (this.busy || !this.q.length) return;
        this.busy = true;
        const job = this.q.shift();
        Promise.resolve().then(job.fn).then(job.resolve, job.reject).then(() => {
            this.busy = false;
            setTimeout(() => this._next(), GAP_MS);
        });
    }
}

class Poller {
    /** opts: { diag, bus, should(), onSample(values, now), log, now() } */
    constructor(opts) {
        Object.assign(this, opts);
        this.now = opts.now || Date.now;
        this.values = {};
        this.supported = null;
        this.missing = [];
        this.hz = 0;
        this.stopped = false;
        this.fails = 0;
        this.cycle = 0;
        this.noBatch = false;   // set once we learn the DME refuses multi-DID reads (e.g. the S58), so we stop paying the group timeout
    }

    start() { this._loop().catch((e) => this.log.warn('poller: ' + (e && e.message))); }

    stop() { this.stopped = true; }

    /** One UDS read request; null when it wasn't sent, wasn't answered or was refused. */
    _ask(group) {
        return this.bus.run(() => {
            if (!this.should()) return null;
            const data = request(group);
            return this.diag.physical(DME, 0x22, data, TIMEOUT_MS, replyTo(0x22, data), { maxRetries: 0 });
        }).catch(() => null);
    }

    /** One OBD-II service-01 read request. Kept on a short leash so a DME that ignores OBD can't
     *  stall the bus (no long wait, no pending-response hold). */
    _askObd(group) {
        return this.bus.run(() => {
            if (!this.should()) return null;
            const data = obdRequest(group);
            return this.diag.physical(DME, 0x01, data, OBD_TIMEOUT_MS, replyTo(0x01, data),
                { maxRetries: 0, hardTimeoutMs: OBD_TIMEOUT_MS, pendingTimeoutMs: OBD_TIMEOUT_MS });
        }).catch(() => null);
    }

    /** Does a reader answer? True on a matching reply (its value need not be in range yet — the
     *  engine may be idling), so a channel the car has is never dropped at probe time. */
    async _try(r) {
        if (r.obd != null) { const got = await this._askObd([r]); return !!(got && got[0] === 0x41 && obdParse(got, [r])); }
        const uds = await this._ask([r]); return !!(uds && uds[0] === 0x62 && parse(uds, [r]));
    }

    async _probe() {
        const found = [], missing = [];
        for (const ch of CHANNELS) {
            if (!this.should()) return;
            let use = null;
            for (const r of readers(ch)) {
                if (await this._try(r)) { use = r; break; }   // the car's own DID first, OBD only as a fallback
            }
            ch.use = use;
            if (use) found.push(ch); else missing.push(ch);
        }
        this.supported = found;
        this.missing = missing.map((c) => c.key);
        this.log.info('channels: ' + found.length + ' found, missing ' + this.missing.join(' '));
    }

    async _readAll() {
        const slowTurn = this.cycle % SLOW_EVERY === 0;
        this.cycle++;
        const list = this.supported.filter((c) => !c.slow || slowTurn).map((c) => c.use);
        let answered = 0;
        const uds = list.filter((r) => r.obd == null);
        // some DMEs (the S58) refuse a multi-DID request; once we see that, read one at a time so we
        // never pay the group timeout again (that was dragging the rate down to ~0.3 Hz)
        const groups = this.noBatch ? uds.map((r) => [r]) : batches(uds);
        for (const group of groups) {
            if (!this.should()) return;
            const got = parse(await this._ask(group), group);
            if (got) { Object.assign(this.values, got); answered++; continue; }
            if (group.length > 1) {
                this.noBatch = true;    // the group was refused: switch to single reads from now on
                for (const r of group) {
                    if (!this.should()) return;
                    const one = parse(await this._ask([r]), [r]);
                    if (one) { Object.assign(this.values, one); answered++; }
                }
            }
        }
        for (const r of list.filter((r) => r.obd != null)) {
            if (!this.should()) return;
            const got = obdParse(await this._askObd([r]), [r]);
            if (got) { Object.assign(this.values, got); answered++; }
        }
        if (!this.should()) return;
        if (!answered) {
            if (++this.fails >= REPROBE_AFTER_FAILS) { this.fails = 0; this.supported = null; await sleep(REPROBE_WAIT_MS); }
            return;
        }
        this.fails = 0;
        const t = this.now();
        if (this.lastAt) this.hz = this.hz ? this.hz * 0.9 + 100 / (t - this.lastAt) : 1000 / (t - this.lastAt);
        this.lastAt = t;
        this.onSample(this.values, t);
    }

    async _loop() {
        while (!this.stopped) {
            if (!this.should()) { this.lastAt = 0; await sleep(200); continue; }
            if (!this.supported) {
                await this._probe();
                if (this.supported && !this.supported.length) { this.supported = null; await sleep(REPROBE_WAIT_MS); }
                continue;
            }
            await this._readAll();
            await sleep(GAP_MS);
        }
    }
}

module.exports = { Bus, Poller, DME };
