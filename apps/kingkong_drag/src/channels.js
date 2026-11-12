'use strict';
/**
 * What the app reads from the engine unit (DME, address 0x12) with ReadDataByIdentifier.
 * Identifiers and scalings: the DME8FF catalog in idrive7-apps (MIT). A unit that doesn't have one
 * refuses it when probed, and that channel stays empty.
 *
 * head: the column in the log, named so that TuneInspect recognises it. slow: read every SLOW_EVERY cycles.
 */
const SIZE = { u8: 1, s8: 1, u16: 2, s16: 2 };
const SLOW_EVERY = 20;
const MAX_PER_REQUEST = 8;

const CHANNELS = [
    { key: 'rpm', did: 0x4807, type: 's16', k: 0.5, head: 'RPM', d: 0, min: 0, max: 10000 },
    { key: 'pedal', did: 0x5814, type: 's16', k: 0.01220703, head: 'Accelerator Pedal (%)', d: 1, min: -5, max: 105 },
    { key: 'throttle', did: 0x4600, type: 's16', k: 0.0078125, head: 'Throttle Position (%)', d: 1, min: -5, max: 105 },
    { key: 'gear', did: 0x5881, type: 'u8', k: 1, head: 'Gear', d: 0, min: 0, max: 10 },
    { key: 'boost', did: 0x4205, type: 'u16', k: 0.0078125, head: 'Boost Pressure Actual (kPaa)', d: 1, min: 20, max: 600 },
    { key: 'boostTarget', did: 0x4AB0, type: 'u16', k: 0.00390625, head: 'Boost Target (kPaa)', d: 1, min: 20, max: 600 },
    { key: 'ambient', did: 0x4201, type: 'u16', k: 0.00390625, head: 'Ambient Pressure (kPa)', d: 1, min: 50, max: 120, slow: true },
    { key: 'lambda', did: 0x5889, type: 'u16', k: 0.000244140625, head: 'Lambda Actual', d: 3, min: 0.4, max: 2,
        alt: [{ did: 0x5640, type: 'u16', k: 0.00024414 },                     // S58 alternate DID (from IterioDev's cardash catalog)
            { obd: 0x34, type: 'u16', k: 1 / 32768 }] },                       // last resort: OBD-II PID 34 (O2S1 wide-range lambda, first 2 bytes)
    { key: 'lambdaTarget', did: 0x5816, type: 'u16', k: 0.000244140625, head: 'Lambda Target', d: 3, min: 0.4, max: 2 },
    { key: 'rail', did: 0x58EF, type: 'u16', k: 0.0005, head: 'Rail Pressure Actual (MPa)', d: 2, min: 0, max: 60,
        alt: [{ did: 0x5658, type: 'u16', k: 0.002 },                    // S58 alternate DID (MPa)
            { obd: 0x23, type: 'u16', k: 0.01 }] },                      // last resort: OBD-II PID 23 (kPa*10) -> MPa
    { key: 'lpfp', did: 0x58F3, type: 'u16', k: 0.1, head: 'Low Pressure Fuel (kPa)', d: 0, min: 0, max: 2000 },
    { key: 'ignition', did: 0x59FA, type: 's8', k: 0.75, head: 'Ignition Timing (deg)', d: 2, min: -60, max: 90 },
    { key: 'knock', did: 0x554C, type: 's8', k: 0.375, head: 'Timing Correction (deg)', d: 2, min: -48, max: 48, retard: true },
    { key: 'torque', did: 0x5891, type: 's16', k: 0.5, head: 'Engine Torque (Nm)', d: 0, min: -500, max: 3000 },
    { key: 'wastegate', did: 0x5927, type: 'u8', k: 0.390625, head: 'Wastegate Position (%)', d: 1, min: 0, max: 100 },
    { key: 'iat', did: 0x580F, type: 'u8', k: 0.75, o: -48, head: 'Intake Air Temp (C)', d: 1, min: -45, max: 145 },
    { key: 'chargeAir', did: 0x59D4, type: 'u16', k: 0.0234375, o: -273.15, head: 'Charge Air Temp (C)', d: 1, min: -45, max: 200, slow: true },
    { key: 'oil', did: 0x4402, type: 'u16', k: 0.75, o: -48, head: 'Oil Temp (C)', d: 0, min: -45, max: 200, slow: true },
    { key: 'coolant', did: 0x4300, type: 's16', k: 0.1, o: -273.14, head: 'Coolant Temp (C)', d: 0, min: -45, max: 200, slow: true,
        alt: [{ did: 0x5805, type: 's16', k: 0.1, o: -273.14 },                 // S58 alternate DID
            { obd: 0x05, type: 'u8', k: 1, o: -40 }] },                         // last resort: OBD-II PID 05 (coolant temp, A-40)
    { key: 'ethanol', did: 0x550D, type: 'u8', k: 0.39215686, head: 'Ethanol Content (%)', d: 0, min: 0, max: 100, slow: true,
        alt: [{ obd: 0x52, type: 'u8', k: 100 / 255, min: 0, max: 100 }] },   // OBD-II PID 52 (ethanol %), for engines that refuse 550D (e.g. S58)
];

/** The identifiers to try for a channel, best first: its own DID, then any alternates (DID or OBD PID). */
function readers(ch) {
    const prim = Object.assign({}, ch); delete prim.alt;
    const alts = (ch.alt || []).map((a) => {
        const r = Object.assign({}, ch, a); delete r.alt;
        if (a.obd != null) delete r.did;
        return r;
    });
    return [prim, ...alts];
}

function value(ch, b, at) {
    let raw = 0;
    const n = SIZE[ch.type];
    for (let i = 0; i < n; i++) raw = raw * 256 + b[at + i];
    if (ch.type[0] === 's' && raw >= Math.pow(2, 8 * n - 1)) raw -= Math.pow(2, 8 * n);
    const v = raw * ch.k + (ch.o || 0);
    if (v < ch.min || v > ch.max) return null;
    // the retard is always logged as a negative number, whichever sign the unit uses
    return ch.retard ? -Math.abs(v) : v;
}

/** The request bytes for 22 <did> <did> ... */
function request(group) {
    const out = [];
    group.forEach((ch) => out.push(ch.did >> 8, ch.did & 0xFF));
    return out;
}

/** 62 <did> <data> <did> <data> ... -> { key: value }, null if the reply doesn't match the request. */
function parse(uds, group) {
    if (!uds || uds[0] !== 0x62) return null;
    const out = {};
    let i = 1;
    for (const ch of group) {
        if (uds[i] !== ch.did >> 8 || uds[i + 1] !== (ch.did & 0xFF)) return null;
        i += 2;
        if (i + SIZE[ch.type] > uds.length) return null;
        out[ch.key] = value(ch, uds, i);
        i += SIZE[ch.type];
    }
    return out;
}

/** The request bytes for OBD-II service 01: the PID of each reader. */
function obdRequest(group) {
    return group.map((ch) => ch.obd & 0xFF);
}

/** 41 <pid> <data> <pid> <data> ... -> { key: value }, null if the reply doesn't match the request. */
function obdParse(resp, group) {
    if (!resp || resp[0] !== 0x41) return null;
    const out = {};
    let i = 1;
    for (const ch of group) {
        if (resp[i] !== (ch.obd & 0xFF)) return null;
        i += 1;
        if (i + SIZE[ch.type] > resp.length) return null;
        out[ch.key] = value(ch, resp, i);
        i += SIZE[ch.type];
    }
    return out;
}

/** Split into requests of at most MAX_PER_REQUEST identifiers. */
function batches(list) {
    const out = [];
    for (let i = 0; i < list.length; i += MAX_PER_REQUEST) out.push(list.slice(i, i + MAX_PER_REQUEST));
    return out;
}

module.exports = { CHANNELS, SLOW_EVERY, MAX_PER_REQUEST, readers, request, parse, obdRequest, obdParse, batches };
