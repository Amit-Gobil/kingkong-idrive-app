'use strict';
/* KingKong v1 tests: channel reads (native + OBD fallbacks), details/trans decode, the poller's
 * single-read fallback, and that every tab renders without throwing. Run: node tests/test_all.js */
const assert = require('assert'), fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'apps/kingkong_drag/src');
const OUT = process.argv[2] || path.join(__dirname, '..', 'preview');
try { fs.mkdirSync(OUT); } catch (e) { /* exists */ }
const view = require(path.join(SRC, 'view.js'));
const kit = require(path.join(SRC, 'kit_record.js'));
const { Canvas } = require(path.join(SRC, 'kit_canvas.js'));
const channels = require(path.join(SRC, 'channels.js'));

/* ---- channels: native reads and the S58 OBD fallbacks ---- */
(function channelsTest() {
    const find = (k) => channels.CHANNELS.find((c) => c.key === k);
    // native coolant 0x4300 s16 k0.1 o-273.14: 3621 -> 89.0
    const cool = channels.parse([0x62, 0x43, 0x00, 0x0E, 0x25], [find('coolant')]);
    assert(Math.abs(cool.coolant - 89.0) < 0.2, 'native coolant ' + cool.coolant);
    // each tricky channel has an OBD-II fallback the S58 answers
    const obd = (key, i, pid, reply, want, d) => {
        const r = channels.readers(find(key))[i];
        assert(r.obd === pid, key + ' OBD PID ' + pid.toString(16));
        const got = channels.obdParse(reply, [r]);
        assert(Math.abs(got[key] - want) < (d || 0.5), key + ' via OBD = ' + got[key]);
    };
    obd('rpm', 1, 0x0C, [0x41, 0x0C, 0x0F, 0xA0], 1000);            // (0x0FA0=4000)/4
    obd('boost', 1, 0x0B, [0x41, 0x0B, 0x96], 150);                 // 150 kPa MAP
    obd('ambient', 1, 0x33, [0x41, 0x33, 0x65], 101);               // 101 kPa baro
    obd('coolant', 2, 0x05, [0x41, 0x05, 0x7A], 82);                // 122-40
    obd('lambda', 2, 0x34, [0x41, 0x34, 0x66, 0x66, 0x80, 0], 0.8, 0.01);
    obd('rail', 2, 0x23, [0x41, 0x23, 0x0D, 0xAC], 35, 0.2);
    obd('ethanol', 1, 0x52, [0x41, 0x52, 0xBE], 74.5, 1);
    obd('battery', 0, 0x42, [0x41, 0x42, 0x36, 0xB0], 14.0, 0.1);   // battery is OBD-only (primary reader)
    console.log('ok channels');
}());

/* ---- details catalog decode ---- */
(function detailsTest() {
    const { scaled, flatItems } = require(path.join(SRC, 'details.js'));
    // ignition cyl 1 0x4A49 s16 k0.1: 108 -> 10.8
    assert(Math.abs(scaled({ did: 0x4A49, t: 's16', k: 0.1 }, [0x00, 0x6C]) - 10.8) < 0.01, 'details decode');
    assert(flatItems().length > 50, 'catalog has the groups');
    console.log('ok details');
}());

/* ---- transmission decode (EGS maps) ---- */
(function transTest() {
    const { TransReader } = require(path.join(SRC, 'trans.js'));
    const tr = new TransReader({ diag: null, bus: null, should: () => false, log: console });
    tr.data = { 0x6000: [0x76], 0xDA2E: [0x06, 0x03], 0xDA2A: [0x09, 0x92, 0x09, 0x9C], 0xDA34: [0x09, 0xC4], 0xDA22: [0x00, 0x04] };
    tr.answered = true;
    const m = tr.model();
    assert(m.oilTemp === 78 && m.gear === '4' && m.program === 'D' && m.lockup === 'LOCK HIGH', 'trans model ' + JSON.stringify(m));
    assert(m.engineRpm === 2500 && m.inputRpm === 2450 && m.slip === 50, 'trans rpm/slip ' + JSON.stringify(m));
    console.log('ok transmission');
}());

/* ---- poller: a DME that refuses a group gives up each read on its own, then stays single ---- */
(function pollerTest() {
    const { Poller, Bus } = require(path.join(SRC, 'poller.js'));
    const rpm = channels.CHANNELS.find((c) => c.key === 'rpm');
    const knock = channels.CHANNELS.find((c) => c.key === 'knock');
    const diag = { physical: (ecu, sid, data) => {
        if (data.length > 2) return Promise.resolve([0x7F, 0x22, 0x31]);
        const did = (data[0] << 8) | data[1];
        if (did === rpm.did) return Promise.resolve([0x62, data[0], data[1], 0x17, 0x70]);   // 6000 -> 3000
        if (did === knock.did) return Promise.resolve([0x62, data[0], data[1], 0x08]);        // -3.0
        return Promise.resolve([0x7F, 0x22, 0x31]);
    } };
    let sample = null;
    const p = new Poller({ diag, bus: new Bus(), should: () => true, onSample: (v) => { sample = Object.assign({}, v); },
        log: { info() {}, warn() {} }, now: () => 1000 });
    rpm.use = channels.readers(rpm)[0]; knock.use = channels.readers(knock)[0];
    p.supported = [rpm, knock];
    return p._readAll().then(() => {
        assert(sample && Math.abs(sample.rpm - 3000) < 1 && Math.abs(sample.knock + 3.0) < 0.01, 'read individually: ' + JSON.stringify(sample));
        assert(p.noBatch === true, 'switched to single reads');
        console.log('ok poller');
    });
}());

/* ---- every tab renders without throwing ---- */
(function screensTest() {
    const { DetailsReader } = require(path.join(SRC, 'details.js'));
    const vals = { rpm: 1003, boost: 140, ambient: 101, boostTarget: 150, torque: 35, oil: 84, coolant: 96,
        chargeAir: 58, iat: 58, lambda: 1.086, lambdaTarget: 1.0, knock: 0, battery: 13.9, ethanol: null, rail: 12.4, lpfp: 580, wastegate: 18 };
    const peaks = { rpm: 6420, boost: 1.9, power: 712, torque: 940 };
    const dr = new DetailsReader({ diag: null, bus: null, should: () => false, log: console });
    dr.text = { 'Engine speed': '1003 rpm', Coolant: '96 °C', Lambda: '1.086' }; dr.read = 40;
    const models = {
        engine: { tab: 'live', hz: 2.4, speed: 0, values: vals, peaks },
        fuelair: { tab: 'fuelair', hz: 2.4, values: vals },
        transmission: { tab: 'transmission', trans: { ok: true, gear: '4', program: 'D', oilTemp: 84, inputRpm: 2450, outputRpm: 2460, engineRpm: 2500, slip: 50, lockup: 'LOCK HIGH' } },
        details: { tab: 'details', details: dr.model() },
        settings: { tab: 'settings', hz: 2.4, found: 16, total: 23 },
        waiting: { tab: 'live', hz: 0, values: {}, peaks: {} },
    };
    Object.keys(models).forEach((name) => {
        const rec = new kit.Recorder(view.DESIGN.w, view.DESIGN.h, { textScale: 1 });
        view.draw(rec, models[name]);
        const cv = new Canvas(view.DESIGN.w, view.DESIGN.h); kit.play(rec.words(), cv);
        fs.writeFileSync(path.join(OUT, name + '.png'), cv.png());
    });
    // tab taps map to the right tab id; settings has the reset-peaks button
    assert.strictEqual(view.hit({ tab: 'live' }, 900, 50), 'tab:live', 'first tab is ENGINE');
    assert.strictEqual(view.hit({ tab: 'settings' }, 100, 350), 'set:peaks', 'settings reset button');
    console.log('ok screens in', OUT);
}());
