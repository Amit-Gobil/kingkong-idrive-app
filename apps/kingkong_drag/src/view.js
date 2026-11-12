'use strict';
/**
 * KingKong — the screens, drawn in design pixels (the iDrive 8 app area).
 * No I/O: draw(rec, model) records a frame, hit(model, x, y) says which button a touch is on.
 * Five tabs: Engine, Fuel & Air, Transmission, Details, Settings. Gold/black.
 */
const kit = require('./kit_record.js');
const LOGO = require('./logo.js');

const DESIGN = { w: 2880, h: 764 };
const GOLD = '#d4af37', GOLD_DIM = '#6e5b1e', WHITE = '#f4f1e8', DIM = '#8a8578', BG = '#0a0a0a',
    GO = '#f7d774', BAD = '#e8604c', AMBER = '#f7b733', GREEN = '#7bd47a';
const E_TRACK = '#201c12', E_RED = '#3a140f', E_LINE = '#1d1a12';
const eClamp = (f) => Math.max(0, Math.min(1, f));

const TABS = [['live', 'ENGINE'], ['fuelair', 'FUEL & AIR'], ['transmission', 'TRANSMISSION'], ['details', 'DETAILS'], ['settings', 'SETTINGS']];
const TAB_X = 740, TAB_W = 428, TAB_H = 100;

/* The logo as one cached layer. The runs overlap a little so no hairlines show when the screen scales it. */
let logoLayer = null;
function logo() {
    if (!logoLayer) {
        logoLayer = kit.makeLayer(LOGO.w, LOGO.h, (r) => {
            for (let i = 0; i < LOGO.runs.length; i += 4) r.fillRect(LOGO.runs[i + 1], LOGO.runs[i], LOGO.runs[i + 2] + 0.5, 1.5, LOGO.colors[LOGO.runs[i + 3]]);
        });
    }
    return logoLayer;
}

function placement(w, h) {
    const scale = Math.min(w / DESIGN.w, h / DESIGN.h);
    return { scale, ox: Math.round((w - DESIGN.w * scale) / 2), oy: Math.round((h - DESIGN.h * scale) / 2) };
}

/* The buttons of the screen in front: { id, x, y, w, h, label, size, on }. */
function buttons(m) {
    const out = TABS.map(([id, label], i) => ({ id: 'tab:' + id, tab: true, x: TAB_X + i * TAB_W, y: 0, w: TAB_W, h: TAB_H, label, on: m.tab === id }));
    if (m.tab === 'settings') {
        out.push({ id: 'set:peaks', x: 60, y: 300, w: 760, h: 150, label: 'RESET PEAKS', size: 56 });
    }
    return out;
}

function hit(m, x, y) {
    const b = buttons(m).find((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h);
    return b ? b.id : null;
}

function drawButton(rec, b) {
    if (b.tab) {
        rec.text(b.label, b.x + b.w / 2, 70, 50, b.on ? GOLD : DIM, { font: 'bold', align: 'center' });
        if (b.on) rec.fillRect(b.x + 60, b.h - 8, b.w - 120, 6, GOLD);
        return;
    }
    rec.roundRect(b.x, b.y, b.w, b.h, 6, b.on ? GOLD : '#0b0b0d');
    rec.strokeRoundRect(b.x, b.y, b.w, b.h, 6, 2, b.on ? GOLD : GOLD_DIM);
    rec.text(b.label, b.x + b.w / 2, b.y + b.h / 2 + b.size * 0.36, b.size, b.on ? BG : GO, { font: 'bold', align: 'center' });
}

/* ---- shared drawing helpers ---- */
function efmt(v, d) { return (typeof v !== 'number' || !isFinite(v)) ? '–' : v.toFixed(d || 0); }
function eStatus(rec, m) {
    const live = m.hz > 0;
    rec.roundRect(60, 152, 15, 15, 7, live ? GREEN : DIM);
    const s = live ? ('LIVE FROM DME  ·  ' + m.hz.toFixed(1) + ' Hz') : 'WAITING FOR DATA…  ·  start the engine';
    rec.text(s, 86, 166, 26, DIM, { font: 'mono' });
}
function eKv(rec, x, y, label, valStr, col) {
    rec.text(label, x, y, 28, DIM, { font: 'mono' });
    rec.text(valStr, x, y + 70, 60, col, { font: 'num' });
}
function eBar(rec, x, y, w, label, valStr, unit, frac, peak, redStart, col, ticks) {
    rec.text(label, x, y, 30, DIM, { font: 'mono' });
    rec.text(unit, x, y + 32, 24, '#6b6450', { font: 'mono' });
    rec.text(valStr, x + w, y + 10, 72, col, { font: 'num', align: 'right' });
    const h = 18, by = y + 62;
    rec.roundRect(x, by, w, h, h / 2, E_TRACK);
    if (redStart != null && redStart < 1) rec.roundRect(x + w * redStart, by, w * (1 - redStart), h, h / 2, E_RED);
    if (typeof frac === 'number' && isFinite(frac)) rec.roundRect(x, by, Math.max(h, w * eClamp(frac)), h, h / 2, frac >= (redStart || 1) ? BAD : col);
    if (peak != null) rec.fillRect(x + w * eClamp(peak) - 2, by - 7, 4, h + 14, WHITE);
    if (ticks) ticks.forEach((t) => rec.text(String(t.l), x + w * t.f, by + h + 32, 22, '#544d3a', { font: 'mono', align: 'center' }));
}

/* ---- ENGINE tab ---- */
function drawEngine(rec, m) {
    const v = m.values || {}, pk = m.peaks || {};
    eStatus(rec, m);
    const rpm = v.rpm, boost = (v.boost != null && v.ambient != null) ? (v.boost - v.ambient) / 100 : null;
    const tq = v.torque, power = (tq != null && rpm != null) ? tq * rpm / 9549 * 1.341 : null;
    const intake = (v.chargeAir != null ? v.chargeAir : v.iat);
    const pkBoost = (pk.boost != null && pk.boost > 0) ? ' · peak ' + efmt(pk.boost, 2) : '';
    const pkRpm = pk.rpm ? ' · peak ' + efmt(pk.rpm) : '';
    const pkPwr = pk.power ? ' · peak ' + efmt(pk.power) : '';
    const pkTq = pk.torque ? ' · peak ' + efmt(pk.torque) : '';

    const L = 60, LW = 1180;
    eBar(rec, L, 210, LW, 'ENGINE SPEED', efmt(rpm), 'rpm' + pkRpm, rpm != null ? rpm / 8000 : null, pk.rpm ? pk.rpm / 8000 : null, 7000 / 8000, GOLD,
        [{ l: 0, f: 0 }, { l: 2, f: .25 }, { l: 4, f: .5 }, { l: 6, f: .75 }, { l: 8, f: 1 }]);
    eBar(rec, L, 370, LW, 'BOOST', efmt(boost, 2), 'bar' + pkBoost, boost != null ? boost / 2.5 : null, pk.boost ? pk.boost / 2.5 : null, 2.2 / 2.5, AMBER,
        [{ l: 0, f: 0 }, { l: '1.0', f: .4 }, { l: '2.0', f: .8 }, { l: '2.5', f: 1 }]);
    rec.fillRect(L, 520, LW, 1, E_LINE);
    const temps = [['OIL', v.oil, '°C', 150, BAD], ['COOLANT', v.coolant, '°C', 130, '#5aa9e8'],
        ['INTAKE', intake, '°C', 90, AMBER], ['BATTERY', v.battery, 'V', 15, GREEN]];
    temps.forEach(([lab, val, u, max, c], i) => {
        const x = L + i * 300, d = (u === 'V') ? 1 : 0;
        rec.text(lab, x, 580, 28, DIM, { font: 'mono' });
        rec.text(efmt(val, d), x, 646, 60, WHITE, { font: 'num' });
        rec.text(u, x + 150, 646, 28, DIM, { font: 'mono' });
        rec.roundRect(x, 672, 250, 8, 4, E_TRACK);
        if (typeof val === 'number') rec.roundRect(x, 672, 250 * eClamp(val / max), 8, 4, c);
    });

    rec.fillRect(1270, 150, 1, DESIGN.h - 190, E_LINE);
    const M = 1310, MW = 540;
    rec.text('SPEED', M, 210, 30, DIM, { font: 'mono' });
    rec.text(efmt(m.speed), M + MW / 2, 440, 300, WHITE, { font: 'num', align: 'center' });
    rec.text('km/h', M + MW / 2, 510, 44, DIM, { font: 'mono', align: 'center' });

    rec.fillRect(1880, 150, 1, DESIGN.h - 190, E_LINE);
    const R = 1930, RW = 890;
    eBar(rec, R, 210, RW, 'POWER', efmt(power), 'hp' + pkPwr, power != null ? power / 800 : null, pk.power ? pk.power / 800 : null, null, GO,
        [{ l: 0, f: 0 }, { l: 200, f: .25 }, { l: 400, f: .5 }, { l: 600, f: .75 }, { l: 800, f: 1 }]);
    eBar(rec, R, 370, RW, 'TORQUE', efmt(tq), 'Nm' + pkTq, tq != null ? tq / 1000 : null, pk.torque ? pk.torque / 1000 : null, null, GO,
        [{ l: 0, f: 0 }, { l: 250, f: .25 }, { l: 500, f: .5 }, { l: 750, f: .75 }, { l: 1000, f: 1 }]);
    rec.fillRect(R, 520, RW, 1, E_LINE);
    const kv = [['LAMBDA', efmt(v.lambda, 3), GO], ['KNOCK', efmt(v.knock, 1) + '°', GO], ['ETHANOL', v.ethanol != null ? efmt(v.ethanol) + '%' : '–', v.ethanol != null ? GO : DIM]];
    kv.forEach(([lab, val, c], i) => {
        const x = R + i * 300;
        rec.text(lab, x, 580, 28, DIM, { font: 'mono' });
        rec.text(val, x, 650, 60, c, { font: 'num' });
    });
}

/* ---- FUEL & AIR tab ---- */
function drawFuelAir(rec, m) {
    const v = m.values || {};
    eStatus(rec, m);
    const L = 60, LW = 1180;
    rec.text('FUEL', L, 235, 34, GOLD, { font: 'bold' });
    eBar(rec, L, 300, LW, 'RAIL PRESSURE', efmt(v.rail, 1), 'MPa (HPFP)', v.rail != null ? v.rail / 40 : null, null, null, GOLD,
        [{ l: 0, f: 0 }, { l: 10, f: .25 }, { l: 20, f: .5 }, { l: 30, f: .75 }, { l: 40, f: 1 }]);
    eBar(rec, L, 440, LW, 'LOW-PRESSURE FUEL', efmt(v.lpfp), 'kPa (LPFP)', v.lpfp != null ? v.lpfp / 700 : null, null, null, AMBER,
        [{ l: 0, f: 0 }, { l: 350, f: .5 }, { l: 700, f: 1 }]);
    rec.fillRect(L, 560, LW, 1, E_LINE);
    eKv(rec, L, 620, 'LAMBDA', efmt(v.lambda, 3), GO);
    eKv(rec, L + 400, 620, 'TARGET', efmt(v.lambdaTarget, 3), WHITE);
    eKv(rec, L + 800, 620, 'ETHANOL', v.ethanol != null ? efmt(v.ethanol) + '%' : '–', v.ethanol != null ? GO : DIM);

    rec.fillRect(1440, 150, 1, DESIGN.h - 190, E_LINE);
    const R = 1500, RW = 1320;
    rec.text('AIR', R, 235, 34, GOLD, { font: 'bold' });
    const boost = (v.boost != null && v.ambient != null) ? (v.boost - v.ambient) / 100 : null;
    const bTarget = (v.boostTarget != null && v.ambient != null) ? (v.boostTarget - v.ambient) / 100 : null;
    eBar(rec, R, 300, RW, 'BOOST', efmt(boost, 2), 'bar' + (bTarget != null ? '  ·  target ' + efmt(bTarget, 2) : ''), boost != null ? boost / 2.5 : null, bTarget != null ? bTarget / 2.5 : null, 2.2 / 2.5, GO,
        [{ l: 0, f: 0 }, { l: '1.0', f: .4 }, { l: '2.0', f: .8 }, { l: '2.5', f: 1 }]);
    eBar(rec, R, 440, RW, 'WASTEGATE', efmt(v.wastegate), '%', v.wastegate != null ? v.wastegate / 100 : null, null, null, GO,
        [{ l: 0, f: 0 }, { l: 50, f: .5 }, { l: 100, f: 1 }]);
    rec.fillRect(R, 560, RW, 1, E_LINE);
    eKv(rec, R, 620, 'INTAKE', efmt(v.iat) + '°C', WHITE);
    eKv(rec, R + 440, 620, 'CHARGE AIR', efmt(v.chargeAir) + '°C', WHITE);
    eKv(rec, R + 900, 620, 'AMBIENT', v.ambient != null ? efmt(v.ambient) + ' kPa' : '–', WHITE);
}

/* ---- DETAILS tab: the engine unit's values in groups, four columns ---- */
function drawDetails(rec, m) {
    const det = m.details;
    const reading = det && det.read > 0;
    rec.roundRect(60, 152, 15, 15, 7, reading ? GREEN : DIM);
    rec.text(det ? ('ENGINE UNIT VALUES  ·  ' + det.read + ' of ' + det.of + ' read') : 'Reading the engine unit… · start the engine',
        86, 166, 26, DIM, { font: 'mono' });
    if (!det) return;
    const byGroup = {}; det.groups.forEach((g) => { byGroup[g.group] = g.rows; });
    const cols = [['Engine', 'Oil'], ['Temperatures', 'Fuel'], ['Ignition and knock', 'VANOS'], ['Injector corrections']];
    const X = [60, 760, 1460, 2160], CW = 636, STEP = 25, MAXY = 750;
    cols.forEach((groups, ci) => {
        let y = 206; const x = X[ci];
        groups.forEach((gname) => {
            const rows = byGroup[gname] || [];
            if (y + 40 > MAXY) return;
            rec.text(gname.toUpperCase(), x, y, 30, GOLD, { font: 'bold' }); y += 40;
            for (let r = 0; r < rows.length; r++) {
                if (y > MAXY - STEP) { rec.text('… ' + (rows.length - r) + ' more', x, y, 24, GOLD_DIM, { font: 'mono' }); y += STEP; break; }
                rec.text(rows[r][0], x, y, 24, DIM, { font: 'mono' });
                rec.text(rows[r][1], x + CW, y, 24, WHITE, { font: 'num', align: 'right' });
                y += STEP;
            }
            y += 18;
        });
    });
}

/* ---- TRANSMISSION tab: read-only ZF 8HP gearbox data ---- */
function drawTransmission(rec, m) {
    const t = m.trans;
    rec.roundRect(60, 152, 15, 15, 7, (t && t.ok) ? GREEN : DIM);
    rec.text((t && t.ok) ? 'LIVE FROM GEARBOX  ·  EGS (ZF 8HP)' : 'GEARBOX NOT ANSWERING — IGNITION ON / DRIVING', 86, 166, 26, DIM, { font: 'mono' });
    if (!t) return;
    const L = 60;
    rec.text('GEAR', L, 250, 30, DIM, { font: 'mono' });
    rec.text(t.gear || '–', 400, 500, 300, GOLD, { font: 'num', align: 'center' });
    rec.text('PROGRAM', L, 600, 30, DIM, { font: 'mono' });
    rec.text(t.program || '–', L, 668, 60, WHITE, { font: 'num' });
    rec.text('LOCK-UP', L + 460, 600, 30, DIM, { font: 'mono' });
    rec.text(t.lockup || '–', L + 460, 668, 54, (t.lockup && t.lockup.indexOf('LOCK') >= 0) ? GO : WHITE, { font: 'num' });
    rec.fillRect(1270, 150, 1, DESIGN.h - 190, E_LINE);
    const R = 1310, RW = 1510;
    eBar(rec, R, 260, RW, 'GEARBOX OIL', efmt(t.oilTemp), '°C', t.oilTemp != null ? t.oilTemp / 150 : null, null, 130 / 150, GO,
        [{ l: 0, f: 0 }, { l: 50, f: .33 }, { l: 100, f: .66 }, { l: 150, f: 1 }]);
    rec.fillRect(R, 452, RW, 1, E_LINE);
    eKv(rec, R, 512, 'INPUT (TURBINE)', t.inputRpm != null ? efmt(t.inputRpm) + ' rpm' : '–', WHITE);
    eKv(rec, R + 520, 512, 'OUTPUT', t.outputRpm != null ? efmt(t.outputRpm) + ' rpm' : '–', WHITE);
    eKv(rec, R + 1040, 512, 'ENGINE', t.engineRpm != null ? efmt(t.engineRpm) + ' rpm' : '–', WHITE);
    eKv(rec, R, 662, 'TORQUE-CONVERTER SLIP', t.slip != null ? efmt(t.slip) + ' rpm' : '–', (t.slip != null && Math.abs(t.slip) > 200) ? AMBER : GO);
}

/* ---- SETTINGS tab ---- */
function drawSettings(rec, m) {
    rec.text('SETTINGS', 60, 180, 32, GOLD, { font: 'bold' });
    const info = [
        ['Channels found', m.found != null ? (m.found + ' / ' + m.total) : '—'],
        ['Live rate', m.hz > 0 ? m.hz.toFixed(1) + ' Hz' : '—'],
    ];
    let y = 520;
    info.forEach(([k, val]) => {
        rec.text(k, 60, y, 30, DIM, { font: 'mono' });
        rec.text(val, 760, y, 30, WHITE, { font: 'mono' });
        y += 54;
    });
    rec.text('KINGKONG  ·  live data from your BMW', 60, 735, 28, GOLD_DIM, { font: 'mono' });
}

function draw(rec, m) {
    rec.fillRect(0, 0, DESIGN.w, DESIGN.h, BG);
    rec.blit(logo(), 70, 5);
    rec.fillRect(0, TAB_H, DESIGN.w, 2, GOLD_DIM);
    if (m.tab === 'fuelair') drawFuelAir(rec, m);
    else if (m.tab === 'transmission') drawTransmission(rec, m);
    else if (m.tab === 'details') drawDetails(rec, m);
    else if (m.tab === 'settings') drawSettings(rec, m);
    else drawEngine(rec, m);
    buttons(m).forEach((b) => drawButton(rec, b));
}

module.exports = { draw, hit, buttons, placement, DESIGN, TABS };
