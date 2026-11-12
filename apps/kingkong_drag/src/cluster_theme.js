'use strict';
/**
 * KingKong cluster theme: a full-panel race dash drawn on the instrument cluster through
 * cluster-render. Our own design and code (the layout idea — a rev arc, a big gear, readout
 * tiles, kept clear of BMW's reserved box and belt light — follows the community approach in
 * bimmer-lab/apps, MIT). Drawn with the kit, so it inherits the Neon look and the mono font.
 *
 * Panel is 1920x720 on iDrive 7. BMW keeps a black box at x1406-1597,y342-419 and the belt
 * light at the lower left (~x<587); those regions are left clear here and get fine-tuned on
 * the actual car (iDrive 8 differs). Off restores BMW's own cluster.
 */
const num = (v, d) => (typeof v !== 'number' || !isFinite(v) ? '–' : v.toFixed(d || 0));

const GOLD = '#d4af37', GO = '#f7d774', DIM = '#8a8578', WHITE = '#f4f1e8',
    AMBER = '#f7b733', GREEN = '#58d35a', RED = '#e8322a', GOLD_DIM = '#6e5b1e';

function glow(rec, s, x, y, size, color, opts) {
    const halo = color + '2e';
    [[-5, 0], [5, 0], [0, -5], [0, 5], [-4, -4], [4, 4], [-4, 4], [4, -4]].forEach(([dx, dy]) => rec.text(s, x + dx, y + dy, size, halo, opts));
    rec.text(s, x, y, size, color, opts);
}

function revBar(rec, x, y, w, h, rpm, red) {
    const n = 20, start = red - 2200, gap = 5, sw = (w - (n - 1) * gap) / n;
    for (let i = 0; i < n; i++) {
        const at = start + (i + 1) / n * (red - start);
        const lit = typeof rpm === 'number' && rpm >= at;
        const f = i / n, col = lit ? (f >= 0.8 ? RED : f >= 0.55 ? AMBER : GREEN) : '#140a0a';
        rec.fillRect(x + i * (sw + gap), y, sw, h, col);
    }
}

function tile(rec, x, y, w, h, label, value, unit, color) {
    rec.fillRect(x, y, w, h, '#0b0b0d');
    rec.strokeRoundRect(x, y, w, h, 6, 2, GOLD_DIM);
    rec.text(label.toUpperCase() + (unit ? ' ' + unit : ''), x + 24, y + 42, 26, DIM, { font: 'mono' });
    rec.text(value, x + w - 24, y + h - 26, 70, color || GO, { font: 'num', align: 'right' });
}

/** Draw the whole theme for a model { rpm, speed, gear, boost, oil, coolant, iat, knock, ethanol }. */
function drawTheme(rec, m, o) {
    const W = o.w, H = o.h, red = o.redline || 7000;
    rec.clear([0, 0, 0, 0]);

    // rev bar across the top
    revBar(rec, 30, 24, W - 60, 34, m.rpm, red);

    // rev arc + gear + speed, centre-left (clear of BMW's centre box)
    const cx = 900, cy = 330, r0 = 200, r1 = 244, a0 = 150, sweep = 240;
    const frac = Math.max(0, Math.min(1, (typeof m.rpm === 'number' ? m.rpm : 0) / red));
    const over = typeof m.rpm === 'number' && m.rpm >= red;
    rec.arc(cx, cy, r0, r1, a0, a0 + sweep, '#17150d');
    if (frac > 0) rec.arc(cx, cy, r0, r1, a0, a0 + sweep * frac, over ? RED : GOLD);
    const gear = (m.gear != null && m.gear >= 1 && m.gear <= 12) ? String(m.gear) : (m.gear === 0 ? 'N' : '–');
    glow(rec, gear, cx, cy + 40, 150, over ? RED : GO, { font: 'num', align: 'center' });
    rec.text('VÄXEL', cx, cy + 90, 26, DIM, { font: 'mono', align: 'center' });
    rec.text(num(m.speed), cx, cy + 165, 58, WHITE, { font: 'num', align: 'center' });
    rec.text('KM/H', cx, cy + 195, 24, DIM, { font: 'mono', align: 'center' });

    // left tiles (clear of the belt light lower-left: kept high)
    tile(rec, 50, 110, 360, 190, 'Etanol', num(m.ethanol) + '', '%', GO);
    tile(rec, 50, 320, 360, 190, 'Knock', num(m.knock, 1) + '', '°', (typeof m.knock === 'number' && m.knock <= -1) ? RED : GO);

    // right tiles (either side clear of BMW's box at x1406-1597)
    const boostBar = (typeof m.boost === 'number' ? (m.boost / 100).toFixed(2) : '–');
    tile(rec, 1510, 100, 370, 150, 'Boost', boostBar, 'BAR', GO);
    tile(rec, 1510, 270, 370, 150, 'Olja', num(m.oil) + '', '°C', GO);
    tile(rec, 1510, 440, 370, 150, 'Kyl', num(m.coolant) + '', '°C', GO);

    // brand mark, lower-left corner (clear of the centre)
    rec.text('KINGKONG', 60, H - 30, 32, GOLD_DIM, { font: 'mono' });
}

/**
 * iDrive 8 has no full-panel target: the cluster keeps its own gauges and only offers a window in
 * the middle (`map`, 874x749) or a widget canvas. So instead of a whole-panel dash we draw a
 * compact KingKong centre panel with the values BMW doesn't show. Responsive to o.w / o.h so the
 * same code fits the map window and a widget region. Model: { rpm, speed, gear, boost, oil,
 * coolant, knock, ethanol }.
 */
function drawThemeId8(rec, m, o) {
    const W = o.w, H = o.h, red = o.redline || 7000;
    const mg = Math.round(W * 0.03), gap = Math.round(W * 0.025);
    rec.clear([0, 0, 0, 0]);

    // rev bar across the top of the window
    const rbH = Math.max(20, Math.round(H * 0.05));
    revBar(rec, mg, Math.round(H * 0.03), W - 2 * mg, rbH, m.rpm, red);

    // gear + speed, centred (the OEM rpm/speed gauges flank the window, so no arc needed)
    const cx = Math.round(W / 2), over = typeof m.rpm === 'number' && m.rpm >= red;
    const gearY = Math.round(H * 0.30), gSize = Math.round(H * 0.20);
    const gear = (m.gear != null && m.gear >= 1 && m.gear <= 12) ? String(m.gear) : (m.gear === 0 ? 'N' : '–');
    glow(rec, gear, cx, gearY, gSize, over ? RED : GO, { font: 'num', align: 'center' });
    rec.text('VÄXEL', cx, gearY + Math.round(gSize * 0.26), Math.round(H * 0.035), DIM, { font: 'mono', align: 'center' });
    rec.text(num(m.speed), cx, gearY + Math.round(gSize * 0.70), Math.round(H * 0.10), WHITE, { font: 'num', align: 'center' });
    rec.text('KM/H', cx, gearY + Math.round(gSize * 0.90), Math.round(H * 0.032), DIM, { font: 'mono', align: 'center' });

    // readout tiles, 2 columns, in the lower part of the window
    const tw = Math.round((W - 2 * mg - gap) / 2), th = Math.round(H * 0.15);
    const col2 = W - mg - tw, rowY = (i) => Math.round(H * 0.52) + i * (th + gap);
    const boost = (typeof m.boost === 'number' ? (m.boost / 100).toFixed(2) : '–');
    const knockRed = (typeof m.knock === 'number' && m.knock <= -1);
    tile(rec, mg, rowY(0), tw, th, 'Boost', boost, 'BAR', GO);
    tile(rec, col2, rowY(0), tw, th, 'Knock', num(m.knock, 1) + '', '°', knockRed ? RED : GO);
    tile(rec, mg, rowY(1), tw, th, 'Olja', num(m.oil) + '', '°C', GO);
    tile(rec, col2, rowY(1), tw, th, 'Kyl', num(m.coolant) + '', '°C', GO);
    tile(rec, mg, rowY(2), W - 2 * mg, th, 'Etanol', num(m.ethanol) + '', '%', GO);

    rec.text('KINGKONG', cx, Math.round(H * 0.485), Math.round(H * 0.03), GOLD_DIM, { font: 'mono', align: 'center' });
}

module.exports = { drawTheme, drawThemeId8 };
