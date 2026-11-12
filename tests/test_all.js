'use strict';
// Runs without a head unit: the timer, every screen to PNG, and the whole app against a simulated car.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), Module = require('module'), EventEmitter = require('events');
const SRC = path.join(__dirname, '..', 'apps/kingkong_drag/src');
const OUT = process.argv[2] || path.join(__dirname, '..', 'preview');
try { fs.mkdirSync(OUT); } catch (e) { /* exists */ }
const { RunTimer } = require(path.join(SRC, 'timer.js'));
const view = require(path.join(SRC, 'view.js'));
const kit = require(path.join(SRC, 'kit_record.js'));
const { Canvas } = require(path.join(SRC, 'kit_canvas.js'));
const channels = require(path.join(SRC, 'channels.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- timer: constant 7.2 m/s² from standstill, known answers ---- */
(function timer() {
    const a = 7.2; let done = null; const t = new RunTimer(view.SPLITS, { onDone: (r) => { done = r; } });
    let now = 0; t.feed(now, 0); for (; now < 2000; now += 50) t.idle(now); assert.strictEqual(t.state, 'ready');
    const t0 = now; let v = 0;
    while (v < 215) { now += 20; v = (now - t0) / 1000 * a * 3.6; t.feed(now, v); t.idle(now); }
    now += 50; t.feed(now, 150);
    assert(done, 'run finished');
    const near = (x, want, tol, n) => assert(Math.abs(x - want) <= tol, n + ': ' + x + ' want ' + want);
    near(done.result.ft60, Math.sqrt(2 * 18.288 / a), 0.02, '60 ft');
    near(done.result.kmh100, 100 / 3.6 / a, 0.02, '0-100');
    near(done.result.kmh200, 100 / 3.6 / a, 0.03, '100-200');
    near(done.result.m201, Math.sqrt(2 * 201.168 / a), 0.02, '201 m');
    near(done.trap.m201, Math.sqrt(2 * 201.168 * a) * 3.6, 0.5, 'trap');
    console.log('ok timer');
}());

/* ---- race: tree, reaction and the 201 m time, plus a jump start ---- */
(function race() {
    const { Race } = require(path.join(SRC, 'race.js'));
    let clk = 0; const r = new Race(view.SPLITS, { now: () => clk });
    assert.strictEqual(r.phase, 'idle');
    assert(!r.canStart(true, 10) && r.canStart(true, 0) && !r.canStart(false, 0), 'staging needs a standing car with signal');
    r.start(); assert.strictEqual(r.phase, 'ready');
    for (clk = 0; r.phase === 'ready' && clk < 20000; clk += 50) { r.feed(clk, 0); r.tick(clk); }   // 6 s get-ready
    assert.strictEqual(r.phase, 'count', 'tree starts after the ready countdown');
    assert(clk >= 6000, 'ready lasts about 6 s, was ' + clk);
    for (; r.phase === 'count' && clk < 40000; clk += 50) { r.feed(clk, 0); r.tick(clk); }   // stand still to green
    assert.strictEqual(r.phase, 'armed'); assert(r.lights.green, 'green lit');
    const green = r.greenAt;
    clk = green + 400; r.feed(clk, 0); r.tick(clk);                              // 0.4 s reaction, still stopped
    const a = 7.2, t0 = clk; let v = 0;
    while (v < 215 && clk < t0 + 20000) { clk += 20; v = (clk - t0) / 1000 * a * 3.6; r.feed(clk, v); r.tick(clk); }
    clk += 50; r.feed(clk, 150); r.tick(clk);
    assert.strictEqual(r.phase, 'result', 'race finished: ' + r.phase);
    assert(Math.abs(r.result.m201 - Math.sqrt(2 * 201.168 / a)) < 0.05, 'race 201 m ' + r.result.m201);
    assert(r.reaction >= 0.35 && r.reaction <= 0.55, 'reaction ' + r.reaction);
    let c2 = 0; const r2 = new Race(view.SPLITS, { now: () => c2 }); r2.start();
    c2 = 120; r2.feed(c2, 3); r2.tick(c2); assert.strictEqual(r2.phase, 'foul', 'moving before green is a foul');
    console.log('ok race');
}());

/* ---- cluster theme: rev bar fills toward the redline, and the right target/frame per generation ---- */
(function cluster() {
    const { KingKongCluster, drawTheme, drawThemeId8, TARGETS } = require(path.join(SRC, 'cluster.js'));
    // rev bar lights up toward the redline, on both the full panel (ID7) and the ID8 window
    [[drawTheme, TARGETS.panel], [drawThemeId8, TARGETS.map]].forEach(([draw, g]) => {
        const o = { w: g.w, h: g.h, redline: 7000 };
        const litBar = (model) => {
            const rec = new kit.Recorder(o.w, o.h, { textScale: 1 });
            draw(rec, model, o);
            const cv = new Canvas(o.w, o.h); kit.play(rec.words(), cv);
            let lit = 0, y1 = Math.round(o.h * 0.10);
            for (let y = 0; y < y1; y++) for (let x = 0; x < o.w; x++) { const i = (y * o.w + x) * 4; if (cv.d[i] > 60 || cv.d[i + 1] > 60) lit++; }
            return lit;
        };
        assert(litBar({ rpm: 1500, gear: 3 }) < litBar({ rpm: 6900, gear: 4 }), 'the rev bar fills toward the redline');
    });

    // make a stub that reports a given set of targets and records the image layer it was asked for
    const run = (targets) => {
        const calls = { image: [], pixels: [] };
        const stub = { targets, image: (o) => { calls.image.push(o); return 7; }, on: function (ev, fn) { this['_' + ev] = fn; return this; },
            connect() {}, pixels: (ref, rects, buf) => calls.pixels.push({ ref, len: buf.length }), set() {}, close() {} };
        const c = new KingKongCluster({ make: () => stub, get: () => ({ rpm: 7000, speed: 120, gear: 5, boost: 150, knock: -2, oil: 100, coolant: 95, ethanol: 70 }) });
        c.start(); stub._ready();
        return { c, calls };
    };

    // iDrive 7 offers 'panel' -> we take it and push a full 1920x720 frame
    const id7 = run('map,panel,hud');
    assert.strictEqual(id7.c.target, 'panel', 'iDrive 7: draws on the whole panel');
    assert.strictEqual(id7.calls.image.length, 1, 'one image layer');
    assert(id7.calls.pixels[0].ref === 7 && id7.calls.pixels[0].len === TARGETS.panel.w * TARGETS.panel.h * 4, 'pushes a full-panel frame');

    // iDrive 8 has no 'panel' -> we fall back to the 'map' window (874x749)
    const id8 = run('map,hud,guide,widget');
    assert.strictEqual(id8.c.target, 'map', 'iDrive 8: draws on the centre map window, not panel');
    assert(id8.calls.image[0].w === TARGETS.map.w && id8.calls.image[0].h === TARGETS.map.h, 'the map layer is the verified ID8 size');
    assert(id8.calls.pixels[0].len === TARGETS.map.w * TARGETS.map.h * 4, 'pushes a map-sized frame');

    console.log('ok cluster');
}());

/* ---- channels ---- */
(function parsing() {
    const boost = channels.CHANNELS.find((c) => c.key === 'boost'), eth = channels.CHANNELS.find((c) => c.key === 'ethanol'), knock = channels.CHANNELS.find((c) => c.key === 'knock');
    const v = channels.parse([0x62, 0x42, 0x05, 0x4E, 0x20, 0x55, 0x0D, 0x80, 0x55, 0x4C, 0x08], [boost, eth, knock]);
    assert(Math.abs(v.boost - 156.25) < 0.01, 'boost ' + v.boost);          // 0x4E20 = 20000 * 0.078125 hPa = 1562.5 hPa
    assert(Math.abs(v.ethanol - 50.2) < 0.1, 'ethanol ' + v.ethanol);
    assert(Math.abs(v.knock + 3) < 0.01, 'knock ' + v.knock);
    assert.strictEqual(channels.parse([0x62, 0x42, 0x06, 0, 0], [boost]), null, 'wrong identifier is refused');
    assert.strictEqual(channels.parse([0x7F, 0x22, 0x31], [boost]), null);
    assert(channels.batches(channels.CHANNELS).every((b) => b.length <= 8));
    // OBD-II fallback for engines (S58) that refuse the B58 DIDs, verified against the owner's MHD values
    const railR = channels.readers(channels.CHANNELS.find((c) => c.key === 'rail'));
    assert(railR.length === 2 && railR[0].did === 0x58EF && railR[1].obd === 0x23 && railR[1].did === undefined, 'rail has an OBD fallback');
    assert.deepStrictEqual(channels.obdRequest([railR[1]]), [0x23]);
    const rv = channels.obdParse([0x41, 0x23, 0x0D, 0xAC], [railR[1]]);          // 0x0DAC=3500 -> *0.01 = 35.0 MPa
    assert(Math.abs(rv.rail - 35.0) < 0.05, 'rail via OBD ' + rv.rail);
    const ethR = channels.readers(channels.CHANNELS.find((c) => c.key === 'ethanol'))[1];
    const ev = channels.obdParse([0x41, 0x52, 0xBE], [ethR]);                    // 0xBE=190 -> *100/255 = 74.5 %
    assert(ev.ethanol > 73 && ev.ethanol < 76, 'ethanol via OBD ' + ev.ethanol);
    assert.strictEqual(channels.obdParse([0x7F, 0x01, 0x12], [ethR]), null, 'a refused OBD read is null');
    console.log('ok channels');
}());

/* ---- log folder: a long run is split, the folder limit holds ---- */
(function logs() {
    const { LogStore } = require(path.join(SRC, 'logstore.js'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kklog'));
    const store = new LogStore({ dir, maxBytes: 25 * 1048576, columns: [{ key: 'a', head: 'A', d: 0 }], log: console });
    store.begin(0);
    store.written = 11 * 1048576;                      // pretend the first file is full
    store.row(11000, { a: 1 });
    assert(store.active, 'still logging'); assert.strictEqual(store.written, 0, 'new file');
    store.end(100000);
    console.log('ok log rotation');
}());

/* ---- screens ---- */
function shot(name, model) {
    const rec = new kit.Recorder(view.DESIGN.w, view.DESIGN.h, { textScale: 1 }); view.draw(rec, model);
    const cv = new Canvas(view.DESIGN.w, view.DESIGN.h); kit.play(rec.words(), cv); fs.writeFileSync(path.join(OUT, name + '.png'), cv.png());
}
const base = { tab: 'drag', state: 'ready', elapsed: 0, speed: 0, signal: true, result: {}, trap: {}, best: {}, newBest: {}, peakG: 0, values: {}, hz: 0, running: false, found: null, total: 20, missing: [],
    map: { current: null, cooling: null, message: '' }, fel: { rows: [], page: 0, message: '' }, log: { auto: true, manual: false, active: false, count: 0, bytes: 0 } };
const m = (o) => Object.assign({}, base, o);
shot('drag', m({ state: 'wait', elapsed: 7.21, speed: 171, canShare: true, result: { ft60: 2.18, kmh100: 3.05, m201: 7.21 }, trap: { m201: 184.6 }, best: { m201: { s: 7.21 } }, newBest: { m201: true }, peakG: 1.31 }));
shot('live', m({ tab: 'live', running: true, hz: 6.4, values: { ethanol: 62, boost: 330, boostTarget: 335, ambient: 101, lambda: 0.82, oil: 104, coolant: 92, chargeAir: 41, knock: -1.5 } }));
shot('map', m({ tab: 'map', map: { current: 2, cooling: false, message: 'Bilen bekräftade map 2' } }));
shot('fel', m({ tab: 'fel', fel: { page: 0, message: '2 felkoder i 41 enheter', rows: [{ ecu: 'DME motor', code: '12A4F0', status: 'AKTIV', active: true }, { ecu: 'DSC bromsar', code: '4818B2', status: 'SPARAD' }] } }));
shot('logg', m({ tab: 'logg', running: true, hz: 6.4, found: 18, missing: ['chargeAir', 'wastegate'], log: { auto: true, active: true, count: 12, bytes: 9 * 1048576 } }));
shot('race_lobby', m({ tab: 'race', race: { phase: 'idle', code: 'KK7Q', lights: { amber: [], green: false }, canStart: true } }));
shot('race_ready', m({ tab: 'race', race: { phase: 'ready', code: 'KK7Q', ready: 5, lights: { amber: [false, false, false], green: false } } }));
shot('race_tree', m({ tab: 'race', race: { phase: 'count', code: 'KK7Q', lights: { amber: [true, true, false], green: false } } }));
shot('race_green', m({ tab: 'race', race: { phase: 'armed', lights: { amber: [true, true, true], green: true } } }));
shot('race_result', m({ tab: 'race', race: { phase: 'result', reaction: 0.19, result: { kmh100: 3.05, m201: 6.84 }, trap: { m201: 231 }, lights: { amber: [], green: false } } }));
assert.strictEqual(view.hit(m({ tab: 'map' }), 100, 200), 'map:1');
assert.strictEqual(view.hit(m({ tab: 'map' }), 900, 50), 'tab:drag');
assert.strictEqual(view.hit(m({ tab: 'race', race: { phase: 'idle', canStart: true } }), 400, 620), 'race:start');
shot('anpassa', m({ tab: 'anpassa', clusterOn: false }));
assert.strictEqual(view.hit(m({ tab: 'anpassa' }), 100, 180), 'cust:ethanol');
console.log('ok screens in', OUT);

/* ---- the app against a simulated car ---- */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kkdrag'));
const sent = [], lifecycle = [], handlers = {};
let tasuResponse = null, dmeMap = 'mhd', carVin = 'WBS31HN080CB12345', dmeVin = null;
const VIN = 'WBS31HN080CB12345';
const posts = [];
function dmeReply(target, sid, d) {
    if (sid === 0x22 && d[0] === 0xF1 && d[1] === 0x90) return [0x62, 0xF1, 0x90].concat(((target === 0x12 && dmeVin) || carVin).split('').map((c) => c.charCodeAt(0)));
    if (sid === 0x22) {
        const out = [0x62];
        for (let i = 0; i < d.length; i += 2) {
            const ch = channels.CHANNELS.find((c) => c.did === (d[i] << 8 | d[i + 1]));
            if (!ch || ch.key === 'wastegate' || ch.key === 'rail' || ch.key === 'ethanol') return [0x7F, 0x22, 0x31]; // S58: BMW DIDs for rail/ethanol refused -> OBD fallback

            out.push(d[i], d[i + 1]);
            const n = ch.type.endsWith('16') ? 2 : 1;
            const raw = ch.key === 'boost' ? 20000 : ch.key === 'rpm' ? 6000 : ch.key === 'lambda' ? 3400 : ch.key === 'ambient' ? 25600 : ch.key === 'boostTarget' ? 40000 : ch.key === 'iat' ? 100 : ch.key === 'pedal' ? 4096 : ch.key === 'lambdaTarget' ? 4096 : ch.key === 'chargeAir' ? 12934 : ch.key === 'oil' ? 184 : ch.key === 'coolant' ? 3631 : ch.key === 'rail' ? 50000 : ch.key === 'ethanol' ? 180 : 0;
            if (n === 2) out.push(raw >> 8 & 255, raw & 255); else out.push(raw & 255);
        }
        return out;
    }
    if (sid === 0x01) {   // OBD-II service 01: rail (PID 23) and ethanol (PID 52)
        if (d[0] === 0x23) return [0x41, 0x23, 0x0D, 0xAC];   // 3500 -> 35.0 MPa
        if (d[0] === 0x52) return [0x41, 0x52, 0xBE];          // 190 -> 74.5 %
        return [0x7F, 0x01, 0x12];
    }
    if (sid === 0x2F) return dmeMap === 'mhd' ? [0x6F].concat(d) : [0x7F, 0x2F, 0x31];
    return null;
}
const tasuProxy = {
    init: () => Promise.resolve(), waitUntilAvailable: () => Promise.resolve(),
    sendTasuResponse: { subscribe: (fn) => { tasuResponse = fn; return Promise.resolve(); } },
    sendTasuRequest: (r) => {
        const data = Array.from(r.udsData); sent.push({ t: r.targetAddress, s: r.serviceID, d: data, rpm: currentRpm });
        const answer = (ecu, uds) => setImmediate(() => tasuResponse({ errorCode: 'NO_ERROR', udsResponse: [0, 0, 0, 0, 0, 0, ecu, 0, 0].concat(uds) }));
        if (r.targetAddress === 0xDF && r.serviceID === 0x19) { answer(0x12, [0x59, 0x02, 0x0C, 0x12, 0xA4, 0xF0, 0x09]); answer(0x29, [0x59, 0x02, 0x0C]); return Promise.resolve({ TasuErrorEnum: 'NO_ERROR' }); }
        if (r.targetAddress === 0xDF && r.serviceID === 0x14) { answer(0x12, [0x54]); return Promise.resolve({ TasuErrorEnum: 'NO_ERROR' }); }
        const uds = dmeReply(r.targetAddress, r.serviceID, data); if (uds) answer(r.targetAddress, uds);
        return Promise.resolve({ TasuErrorEnum: 'NO_ERROR' });
    },
};
let currentRpm = 0, speedRead = 0;
class FakeApp extends EventEmitter {
    start() { setImmediate(() => this.emit('initialized')); return Promise.resolve(); }
    get rhmiApplication() { return this._rh || (this._rh = Object.assign(new EventEmitter(), {
        getByName: (n) => (n.startsWith('ST_') ? { n } : Object.assign(new EventEmitter(), { n })),
        mapEntryState: () => Promise.resolve(), openEntryState: (u) => { lifecycle.push('open ' + u); return Promise.resolve(); } })); }
    get appDescription() { return { application: { entryPoints: [{ uuid: 'U' }] } }; }
    getEntryPoints() { return [{ getDescription: () => ({ uuid: 'U' }), init: () => Promise.resolve(), setAvailability: (s) => { lifecycle.push(s); return Promise.resolve(); } }]; }
    registerActive() {} initialized() { lifecycle.push('initialized'); return Promise.resolve(); }
    getVisibilityData() { return { reason: 'ENTRY_POINT' }; } getLastExecutedEntryPointUuid() { return 'U'; }
    registerHmiVisible() { return Promise.resolve(); } unregisterHmiVisible() { return Promise.resolve(); }
}
const fakeHttps = { request: (o, cb) => { const req = new EventEmitter(); req.abort = () => {}; req.end = (b) => { posts.push({ o, size: b.length }); setImmediate(() => cb({ statusCode: 200, resume() {} })); }; return req; } };
const stubs = { https: fakeHttps, 'oap-sdk/src/core/OnlineApp.js': FakeApp, 'oap-sdk/src/logging/logging': { getSDKLogger: () => ({ info() {}, warn: () => {}, error: console.log }) },
    'oap-sdk/src/someip/someipBuilders': { buildTypedProxy: (i) => Promise.resolve(/InternalTasu/.test(i) ? tasuProxy : new Proxy({}, { get: (_, k) => {
        if (k === 'then') return undefined; if (k === 'init' || k === 'waitUntilAvailable') return () => Promise.resolve();
        return { subscribe: (fn) => { handlers[k] = fn; return Promise.resolve(); }, getValue: () => (speedRead === 'fail' ? Promise.reject(new Error('x')) : Promise.resolve({ speedVehicleCentreOfGravity: speedRead })) }; } })) } };
const orig = Module._load;
Module._load = function (r, ...x) { return stubs[r] || orig.call(this, r, ...x); };
// the app keeps its data two folders up from its code: run a copy of the code there
const CODE = path.join(DATA, 'pkg', 'javascript'); fs.mkdirSync(path.join(DATA, 'pkg')); fs.mkdirSync(CODE);
fs.readdirSync(SRC).forEach((f) => fs.copyFileSync(path.join(SRC, f), path.join(CODE, f)));
fs.copyFileSync(path.join(SRC, '..', 'mgu-app.json'), path.join(DATA, 'pkg', 'mgu-app.json'));
const crypto = require('crypto');
const { hashVin } = require(path.join(SRC, 'license.js'));
const KEY = fs.readFileSync(process.argv[3], 'utf8');
const payload = JSON.stringify({ v: 1, vin: hashVin(VIN), token: 'tok123' });
fs.writeFileSync(path.join(DATA, 'pkg', 'license.json'), JSON.stringify({ payload, sig: crypto.createSign('SHA256').update(payload).sign(KEY, 'base64') }));

(async function car() {
    const app = require(path.join(CODE, 'main.js'));
    const logDir = path.join(DATA, 'data', 'logs');
    await sleep(3400);
    assert(lifecycle.indexOf('initialized') >= 0 && lifecycle.indexOf('ENABLED') >= 0 && lifecycle.indexOf('open U') >= 0, lifecycle.join());
    assert(handlers.statusEngineSpeed2 && handlers.statusCarSpeed2, 'subscribed');
    assert.strictEqual(app._lock, 'needvin', 'locked until the car is checked'); await app._act('map:1'); assert.strictEqual(sent.length, 0, 'locked: no commands');
    assert.strictEqual(sent.filter((s) => s.s === 0x22).length, 0, 'nothing read from the DME before the engine runs');
    console.log('ok start, nothing sent with the engine off');

    /* engine on: autolog starts, channels are probed and polled */
    const rpm = (v) => { currentRpm = v; handlers.statusEngineSpeed2({ actualValueRPMEngineCrankshaft: v * 4 }); };
    rpm(3000); handlers.statusCarSpeed2({ speedVehicleCentreOfGravity: 64 * 50 });
    const keep = setInterval(() => { if (currentRpm) rpm(currentRpm); }, 200);
    await sleep(2500);
    assert.strictEqual(app._lock, null, 'the right car unlocks');
    assert(sent.filter((s) => s.s === 0x22).length > 20, 'polling ' + sent.length);
    assert(sent.filter((s) => s.s === 0x22 && s.d[0] !== 0xF1).every((s) => s.d.length <= 16 && s.t === 0x12), 'reads only the DME, 8 identifiers at most');
    assert(app._poller.supported.length === channels.CHANNELS.length - 1 && app._poller.missing[0] === 'wastegate', 'probe ' + app._poller.missing);
    const railCh = app._poller.supported.find((c) => c.key === 'rail'), ethCh = app._poller.supported.find((c) => c.key === 'ethanol');
    assert(railCh.use && railCh.use.obd === 0x23 && ethCh.use && ethCh.use.obd === 0x52, 'rail and ethanol fell back to OBD');
    assert(Math.abs(app._poller.values.rail - 35) < 0.2, 'rail via OBD ' + app._poller.values.rail);
    assert(app._poller.values.ethanol > 73 && app._poller.values.ethanol < 76, 'ethanol via OBD ' + app._poller.values.ethanol);
    assert(app._store.active, 'autolog running');
    assert(Math.abs(app._poller.values.boost - 156.25) < 0.01, 'value read');
    console.log('ok autolog polling at ' + app._poller.hz.toFixed(1) + ' Hz in the simulation');

    /* map switch while driving */
    await app._act('map:2');
    const mapReq = sent.filter((s) => s.s === 0x2F);
    assert.deepStrictEqual(mapReq[0].d, [0x01, 0x01], 'map 2 is 2F 01 01');
    assert.strictEqual(app._map.current, 2);
    dmeMap = 'stock'; await app._act('map:3'); assert.strictEqual(app._map.current, 2, 'refused keeps the map'); assert(app._map.bad, 'refusal shown'); dmeMap = 'mhd';
    await app._act('cool:1'); assert.deepStrictEqual(sent.filter((s) => s.s === 0x2F).pop().d, [0x03, 0x01]); assert.strictEqual(app._map.cooling, true);
    console.log('ok map switch and cooling');

    /* touch, with the phase names the renderer client sends */
    app._tab = 'live'; app._gpu.emit('touch', 1, 900, 50); app._gpu.emit('touch', 3, 900, 50); assert.strictEqual(app._tab, 'drag', 'tab by touch');

    /* faults */
    await app._act('fel:read'); assert.strictEqual(app._fel.rows.length, 1); assert.strictEqual(app._fel.rows[0].code, '12A4F0');
    await app._act('fel:clear'); assert.strictEqual(sent.filter((s) => s.s === 0x14).length, 0, 'moving: not cleared'); assert(app._fel.bad);
    handlers.statusCarSpeed2({ speedVehicleCentreOfGravity: 0 });
    await app._act('fel:clear'); assert.strictEqual(sent.filter((s) => s.s === 0x14).length, 0, 'first press only arms');
    speedRead = 64 * 30; await app._act('fel:clear'); assert.strictEqual(sent.filter((s) => s.s === 0x14).length, 0, 'moved since the press: not cleared');
    speedRead = 'fail'; await app._act('fel:clear'); await app._act('fel:clear'); assert.strictEqual(sent.filter((s) => s.s === 0x14).length, 0, 'unknown speed: not cleared');
    speedRead = 0; await app._act('fel:clear');
    await app._act('fel:clear'); assert.strictEqual(sent.filter((s) => s.s === 0x14).length, 1, 'second press clears');
    console.log('ok faults');

    /* drag + share */
    app._lastRun = { at: Date.parse('2026-11-09T10:00:00Z'), result: { kmh100: 3.05, m201: 7.21 }, trap: { m201: 184.6 } };
    assert.strictEqual(app._shareUrl(), 'https://inspect.kingkongtuning.se/car-time?k100=3.05&e=7.21&t=184.6&d=2026-11-09');
    await app._act('drag:qr'); assert(app._qr && app._qr.size > 20, 'qr'); const qrShot = app._model(); shot('qr', qrShot); await app._act('qr:close');
    console.log('ok share');

    /* cluster toggle: on builds the layer, off tears it down (no drawing without cluster-render present) */
    assert(!app._cluster, 'cluster off by default');
    await app._act('cluster:toggle'); assert(app._cluster && app._settings.cluster === true, 'cluster on');
    await app._act('cluster:toggle'); assert(!app._cluster && app._settings.cluster === false, 'cluster off again');
    console.log('ok cluster toggle');

    /* Anpassa: add and remove LIVE values, capped at 8 */
    await app._act('cust:knock'); assert(app._settings.live.indexOf('knock') < 0 && app._settings.live.length === 7, 'removed a value');
    await app._act('cust:rail'); assert(app._settings.live.indexOf('rail') >= 0 && app._settings.live.length === 8, 'added a value');
    await app._act('cust:gear'); assert(app._settings.live.indexOf('gear') < 0, 'a 9th is capped');
    await app._act('cust:rail'); assert(app._settings.live.indexOf('rail') < 0, 'removed again');
    console.log('ok anpassa');

    /* engine off: everything to the DME stops, the log is closed */
    app._store.startedAt -= 60000;                     // pretend the run was long enough to keep
    clearInterval(keep); rpm(0); await sleep(600);
    const writes = sent.filter((s) => s.s === 0x2F).length; await app._act('map:1'); await app._act('cool:1');
    assert.strictEqual(sent.filter((s) => s.s === 0x2F).length, writes, 'no map or cooling command with the engine off'); assert(app._map.bad);
    const before = sent.length; await sleep(1500);
    assert.strictEqual(sent.length, before, 'nothing sent after the engine stopped');
    assert(!app._store.active, 'log closed');
    const files = fs.readdirSync(logDir); assert.strictEqual(files.length, 1, 'one log'); const text = fs.readFileSync(path.join(logDir, files[0]), 'utf8');
    fs.copyFileSync(path.join(logDir, files[0]), path.join(OUT, 'sample_log.csv'));
    await app._uploader.tick();
    assert.strictEqual(posts.length, 0, 'no internet: nothing sent');
    fs.writeFileSync(path.join(DATA, 'data', 'uplink.json'), JSON.stringify({ dns: ['1.1.1.1'] }));
    await app._uploader.tick();
    assert.strictEqual(posts.length, 1, 'log sent'); assert.strictEqual(typeof posts[0].o.lookup, 'function', 'names through the DNS of the uplink'); assert.strictEqual(posts[0].o.headers.Authorization, 'Bearer tok123'); assert(/\.csv\.sent$/.test(fs.readdirSync(logDir)[0]), 'marked sent');
    await app._uploader.tick(); assert.strictEqual(posts.length, 1, 'sent once');
    assert(text.split('\n')[0].startsWith('Time (s),RPM,Vehicle Speed (km/h),'), text.split('\n')[0]); assert(text.split('\n').length > 5);
    console.log('ok engine off: DME left alone, log saved');

    /* a stale engine signal counts as engine off */
    currentRpm = 3000; handlers.statusEngineSpeed2({ actualValueRPMEngineCrankshaft: 12000 }); assert(app._engineRunning());
    app._rpmAt -= 6000; assert(!app._engineRunning(), 'stale signal'); currentRpm = 0;
    console.log('ok stale signal, upload');

    /* a replaced engine unit: the body controller still has the car's VIN */
    dmeVin = 'WBA5U000000DEMK00'; app._vinChecked = false; app._vinRetryAt = 0; currentRpm = 3000; rpm(3000);
    await sleep(800);
    assert.strictEqual(app._lock, null, 'owner with a replaced engine unit stays unlocked'); dmeVin = null;
    console.log('ok replaced engine unit');

    /* the file moved to another car */
    carVin = 'WBA5U000000DEMK00'; app._vinChecked = false; app._vinRetryAt = 0; currentRpm = 3000; rpm(3000);
    await sleep(800);
    assert.strictEqual(app._lock, 'wrongcar', 'another car is locked out'); assert(!app._store.active, 'no logging');
    const n = sent.filter((s) => s.s === 0x2F).length; await app._act('map:1'); assert.strictEqual(sent.filter((s) => s.s === 0x2F).length, n, 'no commands');
    shot('locked', app._model());
    const { readLicense } = require(path.join(SRC, 'license.js'));
    assert.strictEqual(readLicense({ payload: payload.replace('tok123', 'tok999'), sig: 'AAAA' }), null, 'forged licence refused');
    console.log('ok wrong car locked'); process.exit(0);
}()).catch((e) => { console.log('FAIL', e.stack); process.exit(1); });
