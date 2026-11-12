'use strict';
/**
 * KingKong Drag: the screens, drawn in design pixels (the iDrive 8 app area).
 * No I/O: draw(rec, model) records a frame, hit(model, x, y) says which button a touch is on.
 */
const kit = require('./kit_record.js');
const LOGO = require('./logo.js');
const DESIGN = { w: 2880, h: 764 };
const GOLD = '#d4af37', GOLD_DIM = '#6e5b1e', WHITE = '#f4f1e8', DIM = '#8a8578', BG = '#0a0a0a', PANEL = '#15130d', GO = '#f7d774', BAD = '#e8604c';
const AMBER = '#f7b733', AMBER_OFF = '#2a2410', GREEN = '#7bd47a', GREEN_OFF = '#10251a';

const SPLITS = [
    { key: 'ft60', label: '60 ft', dist: 18.288 },
    { key: 'kmh100', label: '0-100', from: 0, to: 100 },
    { key: 'kmh200', label: '100-200', from: 100, to: 200 },
    { key: 'm201', label: '201 m', dist: 201.168 },
];
const TABS = [['live', 'ENGINE'], ['fuelair', 'FUEL & AIR'], ['transmission', 'TRANSMISSION'], ['details', 'DETAILS'], ['settings', 'SETTINGS']];
const LIVE_TABS = ['live', 'fuelair', 'transmission', 'details'];   // tabs that need DME polling
const TAB_X = 740, TAB_W = 428, TAB_H = 100;
const STATUS = {
    nosignal: ['INGEN FARTSIGNAL', DIM],
    wait: ['STANNA BILEN', DIM],
    ready: ['REDO', GOLD],
    run: ['TIDTAGNING', GO],
};
// The full catalog of values the driver can put in LIVE, keyed by a stable id. The Anpassa tab
// toggles which ones show; drawLive renders the chosen ones (up to 8, what fits on the screen).
const LIVE_ALL = {
    ethanol: { label: 'Etanol', v: (x) => x.ethanol, d: 0, u: '%' },
    boost: { label: 'Boost', v: (x) => (x.boost != null && x.ambient != null ? (x.boost - x.ambient) / 100 : null), d: 2, u: 'bar' },
    boostTarget: { label: 'Boostmål', v: (x) => (x.boostTarget != null && x.ambient != null ? (x.boostTarget - x.ambient) / 100 : null), d: 2, u: 'bar' },
    lambda: { label: 'Lambda', v: (x) => x.lambda, d: 3, u: '' },
    lambdaTarget: { label: 'Lambdamål', v: (x) => x.lambdaTarget, d: 3, u: '' },
    oil: { label: 'Oljetemp', v: (x) => x.oil, d: 0, u: '°C' },
    coolant: { label: 'Kylvatten', v: (x) => x.coolant, d: 0, u: '°C' },
    chargeAir: { label: 'Laddluft', v: (x) => (x.chargeAir != null ? x.chargeAir : x.iat), d: 0, u: '°C' },
    iat: { label: 'Insugstemp', v: (x) => x.iat, d: 0, u: '°C' },
    knock: { label: 'Knock', v: (x) => x.knock, d: 2, u: '°' },
    ignition: { label: 'Tändning', v: (x) => x.ignition, d: 1, u: '°' },
    rail: { label: 'Rail-tryck', v: (x) => x.rail, d: 1, u: 'MPa' },
    lpfp: { label: 'Lågtryck', v: (x) => x.lpfp, d: 0, u: 'kPa' },
    rpm: { label: 'Varvtal', v: (x) => x.rpm, d: 0, u: '' },
    gear: { label: 'Växel', v: (x) => x.gear, d: 0, u: '' },
    throttle: { label: 'Trottel', v: (x) => x.throttle, d: 0, u: '%' },
    pedal: { label: 'Gaspedal', v: (x) => x.pedal, d: 0, u: '%' },
    torque: { label: 'Vridmoment', v: (x) => x.torque, d: 0, u: 'Nm' },
    wastegate: { label: 'Wastegate', v: (x) => x.wastegate, d: 0, u: '%' },
};
const LIVE_ORDER = ['ethanol', 'boost', 'boostTarget', 'lambda', 'lambdaTarget', 'oil', 'coolant', 'chargeAir', 'iat', 'knock', 'ignition', 'rail', 'lpfp', 'rpm', 'gear', 'throttle', 'pedal', 'torque', 'wastegate'];
const LIVE_DEFAULT = ['ethanol', 'boost', 'boostTarget', 'lambda', 'oil', 'coolant', 'chargeAir', 'knock'];
const LIVE_MAX = 8;
function liveSelection(m) {
    const sel = (m.liveSel && m.liveSel.length) ? m.liveSel : LIVE_DEFAULT;
    return sel.filter((id) => LIVE_ALL[id]);
}
const PER_PAGE = 7;
const CHANNEL_SV = { rpm: 'varvtal', pedal: 'gaspedal', throttle: 'gasspjäll', gear: 'växel', boost: 'boost', boostTarget: 'boostmål', ambient: 'lufttryck', lambda: 'lambda', lambdaTarget: 'lambdamål', rail: 'högtrycksbränsle', lpfp: 'lågtrycksbränsle', ignition: 'tändning', knock: 'knock', torque: 'moment', wastegate: 'wastegate', iat: 'insugsluft', chargeAir: 'laddluft', oil: 'oljetemp', coolant: 'kylvatten', ethanol: 'etanol' };

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

const secs = (s) => (typeof s === 'number' && isFinite(s) ? s.toFixed(2) : '–');
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '–');

/* The buttons of the screen in front: { id, x, y, w, h, label, size, on }. */
function buttons(m) {
    if (m.lock) return [];
    if (m.qr) return [{ id: 'qr:close', x: 0, y: 0, w: DESIGN.w, h: DESIGN.h, invisible: true }];
    const out = TABS.map(([id, label], i) => ({ id: 'tab:' + id, tab: true, x: TAB_X + i * TAB_W, y: 0, w: TAB_W, h: TAB_H, label, on: m.tab === id }));
    if (m.tab === 'drag') {
        out.push({ id: 'drag:reset', x: 80, y: 640, w: 400, h: 100, label: 'NOLLSTÄLL', size: 44 });
        if (m.canShare) out.push({ id: 'drag:qr', x: 500, y: 640, w: 400, h: 100, label: 'DELA', size: 44, on: true });
    }
    if (m.tab === 'map') {
        [1, 2, 3, 4].forEach((n, i) => out.push({ id: 'map:' + n, x: 60 + i * 700, y: 130, w: 680, h: 230, label: 'MAP ' + n, size: 96, on: m.map.current === n }));
        out.push({ id: 'cool:1', x: 60, y: 385, w: 680, h: 150, label: 'MAX COOLING PÅ', size: 56, on: m.map.cooling === true });
        out.push({ id: 'cool:0', x: 760, y: 385, w: 680, h: 150, label: 'MAX COOLING AV', size: 56, on: m.map.cooling === false });
    }
    if (m.tab === 'fel') {
        out.push({ id: 'fel:read', x: 60, y: 130, w: 400, h: 110, label: m.fel.busy ? 'LÄSER…' : 'LÄS', size: 56 });
        out.push({ id: 'fel:clear', x: 480, y: 130, w: 620, h: 110, label: m.fel.armed ? 'TRYCK IGEN' : 'RADERA', size: 56, on: m.fel.armed });
        if (m.fel.rows.length > PER_PAGE) out.push({ id: 'fel:next', x: 1120, y: 130, w: 300, h: 110, label: 'NÄSTA', size: 48 });
    }
    if (m.tab === 'logg') {
        out.push({ id: 'log:auto', x: 60, y: 130, w: 880, h: 170, label: m.log.auto ? 'AUTOLOGG PÅ' : 'AUTOLOGG AV', size: 72, on: m.log.auto });
        if (!m.log.auto) out.push({ id: 'log:manual', x: 960, y: 130, w: 880, h: 170, label: m.log.manual ? 'STOPPA LOGG' : 'STARTA LOGG', size: 72, on: m.log.manual });
        out.push({ id: 'cluster:toggle', x: 1960, y: 130, w: 860, h: 170, label: m.clusterOn ? 'CLUSTER PÅ' : 'CLUSTER AV', size: 72, on: m.clusterOn });
    }
    if (m.tab === 'race') {
        const r = m.race || {};
        if (r.phase === 'idle') out.push({ id: 'race:start', x: 80, y: 560, w: 640, h: 140, label: 'STARTA', size: 64, on: !!r.canStart });
        if (r.phase === 'foul' || r.phase === 'result') out.push({ id: 'race:again', x: 1980, y: 560, w: 640, h: 140, label: 'REVANSCH', size: 64, on: true });
    }
    if (m.tab === 'anpassa') {
        const sel = (m.liveSel && m.liveSel.length) ? m.liveSel : LIVE_DEFAULT;
        const gap = 16, cw = 446, ch = 100;
        LIVE_ORDER.forEach((id, i) => {
            const col = i % 6, row = Math.floor(i / 6);
            out.push({ id: 'cust:' + id, x: 60 + col * (cw + gap), y: 130 + row * (ch + gap), w: cw, h: ch, label: LIVE_ALL[id].label, size: 38, on: sel.indexOf(id) >= 0 });
        });
        out.push({ id: 'cust:cluster', x: 60, y: 680, w: 540, h: 72, label: m.clusterOn ? 'CLUSTER PÅ' : 'CLUSTER AV', size: 40, on: m.clusterOn });
    }
    return out;
}

function hit(m, x, y) {
    const b = buttons(m).find((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h);
    return b ? b.id : null;
}

function drawButton(rec, b) {
    if (b.invisible) return;
    if (b.tab) {
        rec.text(b.label, b.x + b.w / 2, 70, 50, b.on ? GOLD : DIM, { font: 'bold', align: 'center' });
        if (b.on) rec.fillRect(b.x + 60, b.h - 8, b.w - 120, 6, GOLD);
        return;
    }
    rec.roundRect(b.x, b.y, b.w, b.h, 6, b.on ? GOLD : '#0b0b0d');
    rec.strokeRoundRect(b.x, b.y, b.w, b.h, 6, 2, b.on ? GOLD : GOLD_DIM);
    rec.text(b.label, b.x + b.w / 2, b.y + b.h / 2 + b.size * 0.36, b.size, b.on ? BG : GO, { font: 'bold', align: 'center' });
}

function drawDrag(rec, m) {
    const st = STATUS[m.signal ? (m.state === 'run' ? 'run' : m.state === 'ready' ? 'ready' : 'wait') : 'nosignal'];
    const pill = rec.textWidth(st[0], 42, { font: 'bold' }) + 72;
    rec.strokeRoundRect(80, 124, pill, 74, 37, 3, st[1]);
    rec.text(st[0], 116, 176, 42, st[1], { font: 'bold' });
    rec.text(secs(m.elapsed || 0), 72, 440, 240, m.state === 'run' ? GO : WHITE, { font: 'num' });
    rec.text(Math.round(m.speed || 0) + ' km/h', 80, 590, 88, WHITE, { font: 'num' });
    if (m.peakG) rec.text(m.peakG.toFixed(2) + ' G', 760, 590, 60, DIM, { font: 'num' });
    rec.line(1280, 130, 1280, 720, 2, GOLD_DIM);
    const x0 = 1360, xT = 2240, xB = 2780;
    rec.text('TID', xT, 170, 40, DIM, { font: 'bold', align: 'right' });
    rec.text('REKORD', xB, 170, 40, DIM, { font: 'bold', align: 'right' });
    SPLITS.forEach((s, i) => {
        const y = 270 + i * 128;
        const isNew = m.newBest && m.newBest[s.key];
        const best = m.best && m.best[s.key];
        rec.text(s.label, x0, y, 68, WHITE, { font: 'label' });
        rec.text(secs(m.result && m.result[s.key]), xT, y, 88, isNew ? GO : WHITE, { font: 'num', align: 'right' });
        rec.text(secs(best && best.s), xB, y, 64, isNew ? GO : DIM, { font: 'num', align: 'right' });
        if (m.trap && m.trap[s.key] && s.key === 'm201') rec.text(m.trap[s.key].toFixed(1) + ' km/h', x0 + 320, y, 46, GOLD, { font: 'num' });
        rec.line(x0, y + 42, xB, y + 42, 2, PANEL);
    });
}

// A row of shift-light segments across a width, driven by rpm (Neon look, also used on LIVE).
function shiftBar(rec, x, y, w, h, rpm) {
    const n = 12, start = 4800, red = 7000, gap = 6, sw = (w - (n - 1) * gap) / n;
    for (let i = 0; i < n; i++) {
        const at = start + (i + 1) / n * (red - start);
        const lit = typeof rpm === 'number' && rpm >= at;
        const frac = i / n;
        const col = lit ? (frac >= 0.8 ? BAD : frac >= 0.55 ? AMBER : GREEN) : '#140a0a';
        rec.fillRect(x + i * (sw + gap), y, sw, h, col);
    }
}

// Faint telemetry grid behind the panels.
function gridBg(rec, x, y, w, h) {
    const c = '#d4af3712';
    for (let gx = x; gx <= x + w; gx += 80) rec.line(gx, y, gx, y + h, 1, c);
    for (let gy = y; gy <= y + h; gy += 80) rec.line(x, gy, x + w, gy, 1, c);
}

// A value drawn with a soft amber bloom behind it (the Neon glow).
function glowNum(rec, s, x, y, size, color, opts) {
    const halo = color + '2e';
    [[-5, 0], [5, 0], [0, -5], [0, 5], [-4, -4], [4, 4], [-4, 4], [4, -4]].forEach(([dx, dy]) => rec.text(s, x + dx, y + dy, size, halo, opts));
    rec.text(s, x, y, size, color, opts);
}

// A dark panel with a gold border and an angular notch cut from the bottom-right corner.
function neonPanel(rec, x, y, w, h, cut) {
    rec.fillRect(x, y, w, h, '#0b0b0d');
    const g = GOLD_DIM, wd = 2;
    rec.line(x, y, x + w, y, wd, g);
    rec.line(x, y, x, y + h, wd, g);
    rec.line(x, y + h, x + w - cut, y + h, wd, g);
    rec.line(x + w, y, x + w, y + h - cut, wd, g);
    rec.line(x + w - cut, y + h, x + w, y + h - cut, wd, GOLD);
}

/* ---- ENGINE tab: clean bar-gauge live view (KingKong gold/black, English) ---- */
const E_TRACK = '#201c12', E_RED = '#3a140f', E_LINE = '#1d1a12';
const eClamp = (f) => Math.max(0, Math.min(1, f));
function efmt(v, d) { return (typeof v !== 'number' || !isFinite(v)) ? '–' : v.toFixed(d || 0); }
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
function drawEngine(rec, m) {
    const v = m.values || {}, pk = m.peaks || {};
    rec.roundRect(60, 152, 15, 15, 7, m.running ? GREEN : DIM);
    const status = m.running ? ('LIVE FROM DME' + (m.hz ? '  ·  ' + m.hz.toFixed(1) + ' Hz' : '')) : 'ENGINE OFF — START THE ENGINE';
    rec.text(status, 86, 166, 26, DIM, { font: 'mono' });

    const rpm = v.rpm, boost = (v.boost != null && v.ambient != null) ? (v.boost - v.ambient) / 100 : null;
    const tq = v.torque, power = (tq != null && rpm != null) ? tq * rpm / 9549 * 1.341 : null;
    const intake = (v.chargeAir != null ? v.chargeAir : v.iat);
    const pkBoost = (pk.boost != null && pk.boost > 0) ? ' · peak ' + efmt(pk.boost, 2) : '';
    const pkRpm = pk.rpm ? ' · peak ' + efmt(pk.rpm) : '';
    const pkPwr = pk.power ? ' · peak ' + efmt(pk.power) : '';
    const pkTq = pk.torque ? ' · peak ' + efmt(pk.torque) : '';

    // LEFT: rpm + boost + temperatures
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

    // MIDDLE: speed hero
    rec.fillRect(1270, 150, 1, DESIGN.h - 190, E_LINE);
    const M = 1310, MW = 540;
    rec.text('SPEED', M, 210, 30, DIM, { font: 'mono' });
    rec.text(efmt(m.speed), M + MW / 2, 440, 300, WHITE, { font: 'num', align: 'center' });
    rec.text('km/h', M + MW / 2, 510, 44, DIM, { font: 'mono', align: 'center' });

    // RIGHT: power + torque + lambda/knock/ethanol
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

function eStatus(rec, m) {
    rec.roundRect(60, 152, 15, 15, 7, m.running ? GREEN : DIM);
    const s = m.running ? ('LIVE FROM DME' + (m.hz ? '  ·  ' + m.hz.toFixed(1) + ' Hz' : '')) : 'ENGINE OFF — START THE ENGINE';
    rec.text(s, 86, 166, 26, DIM, { font: 'mono' });
}
function eKv(rec, x, y, label, valStr, col) {
    rec.text(label, x, y, 28, DIM, { font: 'mono' });
    rec.text(valStr, x, y + 70, 60, col, { font: 'num' });
}
/* ---- FUEL & AIR tab ---- */
function drawFuelAir(rec, m) {
    const v = m.values || {};
    eStatus(rec, m);
    // LEFT: FUEL
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

    // RIGHT: AIR
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
    rec.roundRect(60, 152, 15, 15, 7, m.running ? GREEN : DIM);
    rec.text(det ? ('ENGINE UNIT VALUES  ·  ' + det.read + ' of ' + det.of + ' read') : (m.running ? 'Reading the engine unit…' : 'ENGINE OFF — START THE ENGINE'),
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
/* ---- placeholder for tabs not yet rebuilt ---- */
function drawSoon(rec, m, title, sub) {
    eStatus(rec, m);
    rec.text(title, DESIGN.w / 2, 360, 90, GOLD, { font: 'bold', align: 'center' });
    rec.text('Coming next', DESIGN.w / 2, 440, 44, GO, { font: 'mono', align: 'center' });
    rec.text(sub, DESIGN.w / 2, 510, 32, DIM, { font: 'mono', align: 'center' });
}

function drawLive(rec, m) {
    const ids = liveSelection(m).slice(0, LIVE_MAX);
    gridBg(rec, 0, 102, DESIGN.w, DESIGN.h - 102);
    shiftBar(rec, 60, 120, 2760, 30, m.values && m.values.rpm);
    const hero = ids[0], rest = ids.slice(1);
    if (hero) {
        const c = LIVE_ALL[hero];
        neonPanel(rec, 60, 172, 1120, 548, 46);
        rec.text(c.label.toUpperCase() + (c.u ? ' [' + c.u.trim() + ']' : ''), 100, 240, 34, DIM, { font: 'mono' });
        glowNum(rec, num(c.v(m.values), c.d), 100, 560, 210, GO, { font: 'num' });
        rec.gradientRect(100, 648, 1040, 22, [[0, '#6e5b1e'], [1, '#f7d774']]);
    }
    const gx = 1220, gw = 1600, cols = 2, rows = Math.max(1, Math.ceil(rest.length / cols));
    const cw = (gw - (cols - 1) * 4) / cols, chh = (548 - (rows - 1) * 4) / Math.max(rows, 1);
    rest.forEach((id, i) => {
        const c = LIVE_ALL[id], col = i % cols, row = Math.floor(i / cols);
        const x = gx + col * (cw + 4), y = 172 + row * (chh + 4);
        rec.fillRect(x, y, cw, chh, '#09090b');
        rec.text(c.label.toUpperCase() + (c.u ? ' ' + c.u : ''), x + 30, y + 44, 26, DIM, { font: 'mono' });
        rec.text(num(c.v(m.values), c.d), x + cw - 30, y + chh - 28, 76, GO, { font: 'num', align: 'right' });
    });
    rec.text(m.running ? `${m.hz.toFixed(1)} Hz · anpassa i ANPASSA` : 'Motorn står still. Livedata läses bara när motorn går.', 60, 756, 32, DIM, { font: 'label' });
}

function drawAnpassa(rec, m) {
    const sel = liveSelection(m);
    // the chips themselves are drawn as buttons() entries; here only the section label and hints
    rec.text('FUNKTIONER', 60, 635, 38, GOLD, { font: 'bold' });
    rec.text('Guld = visas i LIVE · max ' + LIVE_MAX + ' · ' + sel.length + ' valda', 640, 735, 34, DIM, { font: 'label' });
}

function drawMap(rec, m) {
    rec.text(m.map.message || 'Välj map', 60, 620, 60, m.map.bad ? BAD : WHITE, { font: 'bold' });
    rec.text('Kräver MHD. Bilen bekräftar bytet men kan inte visa vilken map som är aktiv.', 60, 690, 36, DIM, { font: 'label' });
}

function drawFel(rec, m) {
    const f = m.fel;
    rec.text(f.message || '', 1460, 205, 46, f.bad ? BAD : WHITE, { font: 'bold' });
    const page = f.rows.slice(f.page * PER_PAGE, (f.page + 1) * PER_PAGE);
    page.forEach((r, i) => {
        const y = 320 + i * 62;
        rec.text(r.ecu, 60, y, 44, WHITE, { font: 'label' });
        rec.text(r.code, 1200, y, 44, GOLD, { font: 'num' });
        rec.text(r.status, 1600, y, 40, r.active ? BAD : DIM, { font: 'bold' });
    });
    if (f.rows.length > PER_PAGE) rec.text(`Sida ${f.page + 1} av ${Math.ceil(f.rows.length / PER_PAGE)}`, 60, 750, 32, DIM, { font: 'label' });
}

function drawLogg(rec, m) {
    const l = m.log;
    const lines = [
        ['Status', l.active ? 'Loggar' : l.auto ? 'Väntar på att motorn startar' : 'Av'],
        ['Avläsningar', m.running ? m.hz.toFixed(1) + ' per sekund' : '–'],
        ['Kanaler', m.found == null ? 'Inte kontrollerat än' : `${m.found} av ${m.total} hittade`],
        ['Sparade loggar', `${l.count} st, ${(l.bytes / 1048576).toFixed(1)} MB`],
        ['Till TuneInspect', l.waiting ? `${l.waiting} väntar på internet` : 'Allt skickat'],
        ['Cluster', m.clusterOn ? 'På – framför ratten' : 'Av'],
    ];
    lines.forEach(([a, b], i) => {
        const y = 380 + i * 66;
        rec.text(a, 60, y, 50, DIM, { font: 'label' });
        rec.text(b, 720, y, 50, WHITE, { font: 'bold' });
    });
    if (m.missing && m.missing.length) rec.text('Saknas på bilen: ' + m.missing.map((k) => CHANNEL_SV[k] || k).join(', '), 60, 730, 32, DIM, { font: 'label' });
}

function bulb(rec, cx, cy, rad, on, onColor, offColor) {
    rec.roundRect(cx - rad, cy - rad, rad * 2, rad * 2, rad, on ? onColor : offColor);
}

function drawRace(rec, m) {
    const r = m.race || { phase: 'idle', lights: { amber: [], green: false } };
    if (r.phase === 'idle') {
        rec.text('KINGKONG', 80, 300, 150, WHITE, { font: 'bold' });
        rec.text('RACE', 80, 450, 150, GOLD, { font: 'bold' });
        rec.text('Head-to-head · 201 m', 90, 530, 50, DIM, { font: 'label' });
        rec.text('RUMSKOD', 1800, 230, 46, DIM, { font: 'bold' });
        rec.text(r.code || '––––', 1800, 400, 180, GOLD, { font: 'num' });
        rec.text('Solo-läge nu. Uppkopplat race mot en annan bil kommer.', 1800, 480, 40, DIM, { font: 'label' });
        rec.text(r.canStart ? 'Stå stilla och tryck STARTA.' : 'Stanna bilen och slå på fartsignalen för att starta.', 80, 740, 40, r.canStart ? DIM : BAD, { font: 'label' });
        return;
    }
    if (r.phase === 'ready') {
        rec.text('GÖR DIG REDO', DESIGN.w / 2, 190, 80, DIM, { font: 'bold', align: 'center' });
        rec.text(String(r.ready != null ? r.ready : ''), DESIGN.w / 2, 600, 340, GOLD, { font: 'num', align: 'center' });
        return;
    }
    if (r.phase === 'count' || r.phase === 'armed') {
        const green = r.phase === 'armed';
        rec.text(green ? 'KÖR!' : 'GÖR DIG REDO', DESIGN.w / 2, 200, 72, green ? GREEN : DIM, { font: 'bold', align: 'center' });
        const cx = DESIGN.w / 2, rad = 62;
        [0, 1, 2].forEach((i) => bulb(rec, cx, 260 + i * 130, rad, !!(r.lights.amber && r.lights.amber[i]), AMBER, AMBER_OFF));
        bulb(rec, cx, 260 + 3 * 130, rad, !!r.lights.green, GREEN, GREEN_OFF);
        return;
    }
    if (r.phase === 'foul') {
        rec.text('TJUVSTART', DESIGN.w / 2, 360, 170, BAD, { font: 'bold', align: 'center' });
        rec.text('Du rörde dig före grönt.', DESIGN.w / 2, 470, 56, DIM, { font: 'label', align: 'center' });
        return;
    }
    if (r.phase === 'run') {
        rec.text('TIDTAGNING', 80, 200, 50, GO, { font: 'bold' });
        rec.text(secs(r.elapsed || 0), 72, 460, 240, GO, { font: 'num' });
        rec.text(Math.round(m.speed || 0) + ' km/h', 80, 610, 88, WHITE, { font: 'num' });
        if (typeof r.reaction === 'number') rec.text('Reaktion ' + r.reaction.toFixed(2) + ' s', 1400, 300, 72, GOLD, { font: 'num' });
        rec.text('Kör till 201 m', 1400, 420, 60, DIM, { font: 'label' });
        return;
    }
    // result
    const rows = [
        ['Reaktion', typeof r.reaction === 'number' ? r.reaction.toFixed(2) + ' s' : '–'],
        ['0–100 km/h', secs(r.result && r.result.kmh100) + ' s'],
        ['201 m', secs(r.result && r.result.m201) + ' s'],
        ['Trap', r.trap && r.trap.m201 ? r.trap.m201.toFixed(1) + ' km/h' : '–'],
    ];
    rec.text('RESULTAT', 90, 210, 56, GOLD, { font: 'bold' });
    rows.forEach(([a, b], i) => {
        const y = 300 + i * 100;
        rec.text(a, 90, y, 56, DIM, { font: 'label' });
        rec.text(b, 950, y, 80, i === 2 ? GOLD : WHITE, { font: 'num' });
        rec.line(90, y + 28, 1700, y + 28, 2, PANEL);
    });
    rec.text('201 m avgör. Dela resultatet i DRAG-fliken.', 90, 720, 40, DIM, { font: 'label' });
}

function drawQr(rec, m) {
    rec.fillRect(0, 0, DESIGN.w, DESIGN.h, BG);
    const q = m.qr, side = 680, mod = Math.floor(side / (q.size + 8)), s = mod * (q.size + 8);
    const x = 300, y = Math.round((DESIGN.h - s) / 2);
    rec.fillRect(x, y, s, s, '#ffffff');
    for (let a = 0; a < q.size; a++) {
        for (let b = 0; b < q.size; b++) {
            if (q.dark[a * q.size + b]) rec.fillRect(x + (b + 4) * mod, y + (a + 4) * mod, mod, mod, '#000000');
        }
    }
    rec.text('Skanna med mobilen', 1200, 300, 96, GOLD, { font: 'bold' });
    rec.text('Tiden hamnar i ditt garage på TuneInspect.', 1200, 400, 54, WHITE, { font: 'label' });
    rec.text('Tryck var som helst för att stänga.', 1200, 490, 44, DIM, { font: 'label' });
}

const LOCK = {
    nolicense: ['Appen är inte aktiverad', 'Hämta din egen version på inspect.kingkongtuning.se/car-app'],
    needvin: ['Starta motorn', 'Appen kontrollerar att den hör till den här bilen.'],
    wrongcar: ['Fel bil', 'Den här kopian hör till en annan bil. Hämta din egen på inspect.kingkongtuning.se/car-app'],
};

function drawLock(rec, m) {
    const [a, b] = LOCK[m.lock];
    rec.blit(logo(), (DESIGN.w - LOGO.w) / 2, 150);
    rec.text(a, DESIGN.w / 2, 420, 120, WHITE, { font: 'bold', align: 'center' });
    rec.text(b, DESIGN.w / 2, 540, 56, DIM, { font: 'label', align: 'center' });
}

function draw(rec, m) {
    rec.clear([0, 0, 0, 0]);
    rec.fillRect(0, 0, DESIGN.w, DESIGN.h, BG);
    if (m.lock) { drawLock(rec, m); return; }
    if (m.qr) { drawQr(rec, m); return; }
    rec.blit(logo(), 70, 5);
    rec.fillRect(0, TAB_H, DESIGN.w, 2, GOLD_DIM);
    if (m.tab === 'live') drawEngine(rec, m);
    else if (m.tab === 'fuelair') drawFuelAir(rec, m);
    else if (m.tab === 'transmission') drawSoon(rec, m, 'TRANSMISSION', 'Gearbox temperatures, clutch and torque (ZF 8HP)');
    else if (m.tab === 'details') drawDetails(rec, m);
    else if (m.tab === 'settings') drawSoon(rec, m, 'SETTINGS', 'Units, bar ranges and peak reset');
    else drawEngine(rec, m);
    buttons(m).forEach((b) => drawButton(rec, b));
}

module.exports = { draw, hit, buttons, placement, DESIGN, SPLITS, TABS, PER_PAGE, LIVE_DEFAULT, LIVE_MAX };
