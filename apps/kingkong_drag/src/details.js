'use strict';
/**
 * DETAILS catalog + reader: the engine unit's measurement values in groups, read from the DME (0x12)
 * with UDS 22, one identifier at a time, progressively (like a scan tool). The identifiers, scalings
 * and groupings are facts about the BMW engine unit (the DME8FF measurement blocks); the code here is
 * our own. Scalings are folded so each value comes out already in the shown unit.
 *
 * Item: { name, unit, d (decimals), c: [reader...], minus, lin, bad, e }.
 *   reader: { did, t ('u8'|'s8'|'u16'|'s16'|'u32'), at (byte offset, default 0), k (scale), o (offset) }
 *   minus: [readerA, readerB] -> (A - B); lin: [a, b] -> a + b*value; bad: raw values meaning "no data";
 *   e: enum table { raw: text }.
 */
const { replyTo } = require('./diag.js');
const DME = 0x12;
const SIZE = { u8: 1, s8: 1, u16: 2, s16: 2, u32: 4 };

const GROUPS = [
    { group: 'Engine', items: [
        { name: 'Engine speed', unit: 'rpm', d: 0, c: [{ did: 0x4807, t: 's16', k: 0.5 }] },
        { name: 'Accelerator pedal', unit: '%', d: 0, c: [{ did: 0x5814, t: 's16', k: 0.01220703 }, { did: 0x480B, t: 's16', k: 0.01220703 }] },
        { name: 'Throttle', unit: '%', d: 0, c: [{ did: 0x4600, t: 's16', k: 0.0078125 }, { did: 0x5858, t: 's16', k: 0.0078125 }] },
        { name: 'Engine torque', unit: 'Nm', d: 0, c: [{ did: 0x5891, t: 's16', k: 0.5 }, { did: 0x5717, t: 's16', k: 0.1 }] },
        { name: 'Vehicle speed', unit: 'km/h', d: 0, c: [{ did: 0x4AB1, t: 's16', k: 0.01 }] },
        { name: 'Gear', unit: '', d: 0, c: [{ did: 0x5881, t: 'u8', k: 1 }, { did: 0x564F, t: 'u8', k: 1 }] },
    ] },
    { group: 'Temperatures', items: [
        { name: 'Coolant', unit: '°C', d: 0, c: [{ did: 0x4300, t: 's16', k: 0.1, o: -273.14 }, { did: 0x5805, t: 's16', k: 0.1, o: -273.14 }] },
        { name: 'Coolant, radiator outlet', unit: '°C', d: 0, c: [{ did: 0x5890, t: 'u8', k: 0.75, o: -48 }] },
        { name: 'Engine oil (after filter)', unit: '°C', d: 0, c: [{ did: 0x4402, t: 'u16', k: 0.75, o: -48 }, { did: 0x5822, t: 'u8', k: 1, o: -60 }] },
        { name: 'Engine oil in the sump', unit: '°C', d: 0, c: [{ did: 0x4425, t: 's16', k: 0.1 }, { did: 0x4408, t: 's16', k: 0.1, o: -273.14 }] },
        { name: 'Intake air', unit: '°C', d: 0, c: [{ did: 0x580F, t: 'u8', k: 0.75, o: -48 }] },
        { name: 'Charge air', unit: '°C', d: 0, c: [{ did: 0x59D4, t: 'u16', k: 0.0234375, o: -273.15 }] },
        { name: 'Outside', unit: '°C', d: 1, c: [{ did: 0x5817, t: 's16', k: 0.1, o: -273.14 }, { did: 0x5512, t: 'u8', k: 0.5, o: -40 }] },
        { name: 'Gearbox', unit: '°C', d: 0, c: [{ did: 0x4650, t: 'u8', k: 0.75, o: -48 }] },
        { name: 'Fuel', unit: '°C', d: 0, c: [{ did: 0x4AD5, t: 'u8', k: 0.75, o: -48 }] },
        { name: 'Exhaust (model)', unit: '°C', d: 0, c: [{ did: 0x5896, t: 's16', k: 0.1, o: -273.14 }, { did: 0x582F, t: 's16', k: 0.1, o: -273.14 }] },
    ] },
    { group: 'Oil', items: [
        { name: 'Oil pressure', unit: 'bar', d: 2, mul: 0.001, minus: [{ did: 0x4436, t: 'u16', k: 1 }, { did: 0x4201, t: 'u16', k: 0.0390625 }] },
        { name: 'Oil pressure (abs)', unit: 'bar', d: 2, c: [{ did: 0x586F, t: 's16', k: 0.001 }, { did: 0x4436, t: 'u16', k: 0.001 }] },
        { name: 'Oil above minimum', unit: 'l', d: 2, bad: [255], c: [{ did: 0x5811, t: 'u8', k: 0.01 }, { did: 0x442F, t: 'u8', k: 0.01 }] },
        { name: 'Oil level', unit: 'mm', d: 1, c: [{ did: 0x4409, t: 's16', k: 0.004 }] },
        { name: 'Oil life (hours)', unit: '%', d: 0, c: [{ did: 0x411A, at: 0, t: 'u16', k: 0.001953125 }] },
        { name: 'Oil life (fuel)', unit: '%', d: 0, c: [{ did: 0x411A, at: 2, t: 'u16', k: 0.001953125 }] },
        { name: 'Distance on oil', unit: 'km', d: 0, c: [{ did: 0x4404, t: 'u16', k: 10 }] },
        { name: 'Fuel in the oil', unit: 'g', d: 0, c: [{ did: 0x593A, t: 'u16', k: 0.02133333 }] },
    ] },
    { group: 'Fuel', items: [
        { name: 'Fuel in the tank', unit: 'l', d: 0, c: [{ did: 0x583B, t: 'u8', k: 1 }] },
        { name: 'Tank, left', unit: 'l', d: 1, c: [{ did: 0x5949, t: 'u8', k: 0.5 }] },
        { name: 'Tank, right', unit: 'l', d: 1, c: [{ did: 0x594A, t: 'u8', k: 0.5 }] },
        { name: 'Rail pressure', unit: 'bar', d: 0, c: [{ did: 0x58EF, t: 'u16', k: 0.005 }, { did: 0x5658, t: 'u16', k: 0.02 }] },
        { name: 'Rail target', unit: 'bar', d: 0, c: [{ did: 0x5837, t: 'u16', k: 0.005 }, { did: 0x56C1, t: 'u16', k: 0.02 }] },
        { name: 'Low-pressure fuel', unit: 'bar', d: 2, c: [{ did: 0x58F3, t: 'u16', k: 0.001 }] },
        { name: 'Fuel mass flow', unit: 'kg/h', d: 1, c: [{ did: 0x4521, t: 'u16', k: 0.1 }] },
        { name: 'Ethanol', unit: '%', d: 0, c: [{ did: 0x550D, t: 'u8', k: 0.39215686 }] },
        { name: 'Fuel quality', unit: 'RON', d: 1, lin: [98, -7], c: [{ did: 0x5776, t: 'u8', k: 0.00390625 }] },
    ] },
    { group: 'Ignition and knock', items: [
        { name: 'Ignition angle', unit: '°', d: 1, c: [{ did: 0x59FA, t: 's8', k: 0.75 }] },
        { name: 'Ignition cyl 1', unit: '°', d: 1, c: [{ did: 0x4A49, t: 's16', k: 0.1 }] },
        { name: 'Ignition cyl 2', unit: '°', d: 1, c: [{ did: 0x4A4A, t: 's16', k: 0.1 }] },
        { name: 'Ignition cyl 3', unit: '°', d: 1, c: [{ did: 0x4A4C, t: 's16', k: 0.1 }] },
        { name: 'Ignition cyl 4', unit: '°', d: 1, c: [{ did: 0x4A4D, t: 's16', k: 0.1 }] },
        { name: 'Ignition cyl 5', unit: '°', d: 1, c: [{ did: 0x4A4E, t: 's16', k: 0.1 }] },
        { name: 'Ignition cyl 6', unit: '°', d: 1, c: [{ did: 0x4A4F, t: 's16', k: 0.1 }] },
        { name: 'Knock detected', unit: '', d: 0, e: { 0: 'no', 1: 'yes' }, c: [{ did: 0x4A36, t: 'u8', k: 1 }] },
        { name: 'Knock retard (mean)', unit: '°', d: 1, c: [{ did: 0x554C, t: 's8', k: 0.375 }] },
        { name: 'Knock adaptation', unit: '°', d: 1, c: [{ did: 0x554A, t: 's16', k: 0.1 }] },
        { name: 'Rough run cyl 1', unit: '', d: 1, c: [{ did: 0x4A30, t: 's16', k: 0.0625 }] },
        { name: 'Rough run cyl 2', unit: '', d: 1, c: [{ did: 0x4A31, t: 's16', k: 0.0625 }] },
        { name: 'Rough run cyl 3', unit: '', d: 1, c: [{ did: 0x4A32, t: 's16', k: 0.0625 }] },
        { name: 'Rough run cyl 4', unit: '', d: 1, c: [{ did: 0x4A33, t: 's16', k: 0.0625 }] },
        { name: 'Rough run cyl 5', unit: '', d: 1, c: [{ did: 0x4A34, t: 's16', k: 0.0625 }] },
        { name: 'Rough run cyl 6', unit: '', d: 1, c: [{ did: 0x4A35, t: 's16', k: 0.0625 }] },
    ] },
    { group: 'VANOS', items: [
        { name: 'Intake cam', unit: '°', d: 1, c: [{ did: 0x452E, t: 's16', k: 0.1 }] },
        { name: 'Intake cam target', unit: '°', d: 1, c: [{ did: 0x452B, t: 's16', k: 0.1 }] },
        { name: 'Exhaust cam', unit: '°', d: 1, c: [{ did: 0x452C, t: 's16', k: 0.1 }] },
        { name: 'Exhaust cam target', unit: '°', d: 1, c: [{ did: 0x452A, t: 's16', k: 0.1 }] },
    ] },
    { group: 'Injector corrections', items: [
        { name: 'Lambda', unit: '', d: 3, bad: [65535], c: [{ did: 0x5889, t: 'u16', k: 0.000244140625 }, { did: 0x5640, t: 'u16', k: 0.00024414 }] },
        { name: 'Lambda target', unit: '', d: 3, bad: [65535], c: [{ did: 0x5816, t: 'u16', k: 0.000244140625 }] },
        { name: 'Mixture adaptation', unit: '', d: 3, c: [{ did: 0x4A9D, t: 'u16', k: 0.000030517578 }] },
        { name: 'Injector flow (mean)', unit: '', d: 3, c: [{ did: 0x546E, t: 'u16', k: 0.00003052 }] },
        { name: 'Injector cyl 1', unit: '', d: 3, c: [{ did: 0x55B4, t: 'u16', k: 0.00003052 }] },
        { name: 'Injector cyl 2', unit: '', d: 3, c: [{ did: 0x55B5, t: 'u16', k: 0.00003052 }] },
        { name: 'Injector cyl 3', unit: '', d: 3, c: [{ did: 0x55B6, t: 'u16', k: 0.00003052 }] },
        { name: 'Injector cyl 4', unit: '', d: 3, c: [{ did: 0x55B7, t: 'u16', k: 0.00003052 }] },
        { name: 'Injector cyl 5', unit: '', d: 3, c: [{ did: 0x55B8, t: 'u16', k: 0.00003052 }] },
        { name: 'Injector cyl 6', unit: '', d: 3, c: [{ did: 0x55B9, t: 'u16', k: 0.00003052 }] },
    ] },
];

/** Raw integer from reply bytes `data` (after 62 did did) at the reader's offset. */
function raw(r, data) {
    const n = SIZE[r.t], at = r.at || 0;
    if (!data || at + n > data.length) return null;
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + data[at + i];
    if (r.t[0] === 's' && v >= Math.pow(2, 8 * n - 1)) v -= Math.pow(2, 8 * n);
    return v;
}
/** One reader's scaled value from reply bytes, or null. */
function scaled(r, data) {
    const v = raw(r, data);
    return v == null ? null : v * (r.k == null ? 1 : r.k) + (r.o || 0);
}
/** Format an item's value for display (applies enum, decimals). */
function fmt(item, val) {
    if (val == null) return '–';
    if (item.e) return item.e[val] != null ? item.e[val] : String(val);
    return val.toFixed(item.d || 0) + (item.unit ? ' ' + item.unit : '');
}

/** All items flattened, each tagged with its group, for round-robin reading. */
function flatItems() {
    const out = [];
    GROUPS.forEach((g) => g.items.forEach((it) => out.push(Object.assign({ group: g.group }, it))));
    return out;
}

/**
 * Reads the catalog from the DME, a few identifiers per tick, round-robin. Call tick() repeatedly
 * (main.js drives it while the Details tab is open). Keeps `values` (name -> number|null),
 * `text` (name -> display string), and read/of counts.
 */
class DetailsReader {
    /** opts: { diag, bus, should(), log, perTick } */
    constructor(opts) {
        Object.assign(this, opts);
        this.items = flatItems();
        this.of = this.items.length;
        this.read = 0;
        this.values = {};
        this.text = {};
        this.i = 0;
        this.perTick = opts.perTick || 3;
    }

    _ask(did) {
        const data = [did >> 8, did & 0xFF];
        return this.bus.run(() => {
            if (!this.should()) return null;
            return this.diag.physical(DME, 0x22, data, 1200, replyTo(0x22, data), { maxRetries: 0 });
        }).catch(() => null);
    }

    /** Read one identifier; returns { v, raw } when the DME answered it, else undefined. */
    async _read(r) {
        const uds = await this._ask(r.did);
        if (uds && uds[0] === 0x62 && uds[1] === (r.did >> 8) && uds[2] === (r.did & 0xFF)) {
            const body = uds.slice(3);
            return { v: scaled(r, body), raw: raw(r, body) };
        }
        return undefined;
    }

    async tick() {
        for (let n = 0; n < this.perTick; n++) {
            if (!this.should()) return;
            const item = this.items[this.i];
            this.i = (this.i + 1) % this.items.length;
            let got = null;
            if (item.minus) {
                const a = await this._read(item.minus[0]), b = await this._read(item.minus[1]);
                got = (!a || !b || a.v == null || b.v == null) ? null : (a.v - b.v) * (item.mul || 1);
            } else {
                for (const r of (item._use ? [item._use] : item.c)) {   // stick to the candidate that answered
                    const ans = await this._read(r);
                    if (ans !== undefined) {
                        item._use = r;
                        if (item.bad && item.bad.indexOf(ans.raw) >= 0) got = null;
                        else { got = ans.v; if (got != null && item.lin) got = item.lin[0] + item.lin[1] * got; }
                        break;
                    }
                }
            }
            const had = this.values[item.name] !== undefined;
            this.values[item.name] = got;
            this.text[item.name] = fmt(item, got);
            if (!had && got != null) this.read++;
        }
    }

    model() { return { groups: GROUPS.map((g) => ({ group: g.group, rows: g.items.map((it) => [it.name, this.text[it.name] || '–']) })), read: this.read, of: this.of }; }
}

module.exports = { GROUPS, DetailsReader, flatItems, scaled, raw, fmt };
