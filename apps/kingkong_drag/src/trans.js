'use strict';
/**
 * TRANSMISSION reader: read-only live data from the gearbox unit (EGS, 0x18) of a ZF 8HP, with UDS 22.
 * Identifiers and scalings are the gearbox unit's standard measurement blocks (facts); the code is ours.
 *   6000 oil temperature (u8, −40 °C)   DA2E gear code + selector (2×u8)   DA2A turbine + output rpm (2×s16 BE)
 *   DA34 engine rpm at the gearbox (u16 BE)   DA22 torque-converter lock-up state
 */
const { replyTo } = require('./diag.js');
const EGS = 0x18;
const DIDS = [0x6000, 0xDA2E, 0xDA2A, 0xDA34, 0xDA22];
const GEARS = { 0: 'P', 1: 'R', 2: 'N', 3: '1', 4: '2', 5: '3', 6: '4', 7: '5', 8: '6', 9: '7', 16: '8' };
const SELECTOR = { 0: 'P', 1: 'R', 2: 'N', 3: 'D', 4: 'M' };
const TCC = { 0: 'OPEN', 1: 'REG LOW', 2: 'REG HIGH', 3: 'LOCK LOW', 4: 'LOCK HIGH', 5: 'SLIP' };

class TransReader {
    /** opts: { diag, bus, should(), log } */
    constructor(opts) { Object.assign(this, opts); this.data = {}; this.answered = false; }

    _ask(did) {
        const d = [did >> 8, did & 0xFF];
        return this.bus.run(() => {
            if (!this.should()) return null;
            return this.diag.physical(EGS, 0x22, d, 1200, replyTo(0x22, d), { maxRetries: 0 });
        }).catch(() => null);
    }

    async tick() {
        for (const did of DIDS) {
            if (!this.should()) return;
            const uds = await this._ask(did);
            if (uds && uds[0] === 0x62 && uds[1] === (did >> 8) && uds[2] === (did & 0xFF)) {
                this.data[did] = uds.slice(3);
                this.answered = true;
            }
        }
    }

    model() {
        const d = this.data;
        const u8 = (did, at) => (d[did] && d[did].length > at ? d[did][at] : null);
        const u16 = (did, at) => (d[did] && d[did].length >= at + 2 ? d[did][at] * 256 + d[did][at + 1] : null);
        const s16 = (did, at) => { const v = u16(did, at); return v == null ? null : (v >= 32768 ? v - 65536 : v); };
        const gc = u8(0xDA2E, 0), sc = u8(0xDA2E, 1), ot = u8(0x6000, 0), engine = u16(0xDA34, 0), turbine = s16(0xDA2A, 0);
        return {
            ok: this.answered,
            gear: gc == null ? null : (GEARS[gc] || '–'),
            program: sc == null ? null : (SELECTOR[sc] || '–'),
            oilTemp: ot == null ? null : ot - 40,
            inputRpm: turbine,
            outputRpm: s16(0xDA2A, 2),
            engineRpm: engine,
            slip: (engine != null && turbine != null) ? engine - turbine : null,
            lockup: (u16(0xDA22, 0) == null) ? null : (TCC[u16(0xDA22, 0)] || '–'),
        };
    }
}

module.exports = { EGS, GEARS, SELECTOR, TCC, TransReader };
