'use strict';
/**
 * KingKong cluster layer: draws on the instrument cluster through cluster-render
 * (robertnisipeanu/idrive-apps, MPL-2.0 client in cluster_render_client.js). We are a client of
 * that service over its socket, a separate process, so this file stays our own code.
 *
 * It is OFF until turned on (settings.cluster) and only then connects; without the service the
 * client just keeps trying in the background and nothing is drawn. cluster-render renders under
 * the car's warning lights, so BMW's telltales always show through.
 *
 * Generations differ. On iDrive 7 the whole cluster is one target ('panel', 1920x720) we draw a
 * full race dash on. iDrive 8 has NO panel: the cluster keeps its own gauges and only offers a
 * window in the middle ('map', 874x749) or a widget canvas. So we read the targets the service
 * reports in its hello and pick the best one the car actually has, then draw the matching theme.
 */
const kit = require('./kit_record.js');
const { Canvas } = require('./kit_canvas.js');
const { ClusterRender } = require('./cluster_render_client.js');
const { drawTheme, drawThemeId8 } = require('./cluster_theme.js');

// verified sizes (cluster-render README): panel = iDrive 7 whole cluster; map/widget = iDrive 8.
const TARGETS = {
    panel: { w: 1920, h: 720 },         // iDrive 7: the whole cluster over the gauges
    map: { w: 874, h: 749 },            // iDrive 8: the middle, between the gauges
    widget: { w: 1140, h: 480, x: 550, y: 220 },  // iDrive 8: widget canvas, the region shown best in layout 4
};
// which target we take when the car offers several, best first per generation
const PREFER = ['panel', 'map', 'widget'];

const DEFAULTS = { redline: 7000 };     // shift point (S58 default; set per engine later)

class KingKongCluster {
    constructor(opts) {
        this.o = Object.assign({}, DEFAULTS, opts);
        this.get = (opts && opts.get) || (() => ({}));
        this._make = (opts && opts.make) || (() => new ClusterRender('kingkong_drag'));
        this.ready = false;
        this.layer = null;
        this.target = null;             // the chosen target name, once known
        this.cr = null;
    }

    /** Target names the service reported (hello.targets is a string or a list). */
    _offered() {
        const t = this.cr && this.cr.targets;
        if (!t) return [];
        if (Array.isArray(t)) return t.map(String);
        if (typeof t === 'object') return Object.keys(t);
        return String(t).split(/[^a-z0-9]+/i).filter(Boolean);
    }

    start() {
        if (this.cr) return;
        this.cr = this._make();
        this.cr.on('ready', () => { this.ready = true; this._ensureLayer(); this.push(); });
        this.cr.on('layer', (ref, state) => { if (state === 'error') this.ready = false; });
        this.cr.connect();
    }

    /** Once the service's hello is in, choose the target the car has and make the layer (once). */
    _ensureLayer() {
        if (this.layer != null) return;
        const offered = this._offered();
        this.target = PREFER.find((name) => offered.indexOf(name) >= 0) || null;
        if (!this.target) return;       // this car offers no target we can draw on
        const g = TARGETS[this.target];
        this.layer = this.cr.image({ target: this.target, klass: 'overlay',
            x: g.x || 0, y: g.y || 0, w: g.w, h: g.h, iw: g.w, ih: g.h });
    }

    /** RGBA pixels of the theme for the current model; also the test hook. */
    pixels() {
        const g = TARGETS[this.target] || TARGETS.panel;
        const draw = this.target === 'panel' ? drawTheme : drawThemeId8;
        const o = { w: g.w, h: g.h, redline: this.o.redline };
        const rec = new kit.Recorder(g.w, g.h, { textScale: 1 });
        draw(rec, this.get(), o);
        const cv = new Canvas(g.w, g.h);
        kit.play(rec.words(), cv);
        return cv.d;
    }

    push() {
        if (!this.cr || !this.ready || this.layer == null) return;
        try { this.cr.pixels(this.layer, null, Buffer.from(this.pixels())); } catch (e) { /* client reconnects on its own */ }
    }

    stop() { if (this.cr) { try { this.cr.close(); } catch (e) { /* ignore */ } this.cr = null; this.ready = false; this.layer = null; this.target = null; } }
}

module.exports = { KingKongCluster, drawTheme, drawThemeId8, DEFAULTS, TARGETS };
