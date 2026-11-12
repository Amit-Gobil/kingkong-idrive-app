'use strict';
/**
 * KingKong cluster layer: draws a strip on the instrument cluster / HUD through cluster-render
 * (robertnisipeanu/idrive-apps, MPL-2.0 client in cluster_render_client.js). We are a client of
 * that service over its socket, a separate process, so this file stays our own code.
 *
 * It draws shift lights (rpm toward the shift point), the gear, and boost. It is OFF until turned
 * on (settings.cluster) and only then connects; without the service the client just keeps trying
 * to connect in the background and nothing is drawn. cluster-render renders under the car's
 * warning lights and refuses the seat-belt panel, so BMW's telltales always show through.
 */
const kit = require('./kit_record.js');
const { Canvas } = require('./kit_canvas.js');
const { ClusterRender } = require('./cluster_render_client.js');
const { drawTheme } = require('./cluster_theme.js');

const DEFAULTS = {
    target: 'panel',        // the whole cluster panel, over the gauges and under the telltales
    x: 0, y: 0, w: 1920, h: 720,
    redline: 7000,          // shift point (S58 default; set per engine later)
};

class KingKongCluster {
    constructor(opts) {
        this.o = Object.assign({}, DEFAULTS, opts);
        this.get = (opts && opts.get) || (() => ({}));
        this._make = (opts && opts.make) || (() => new ClusterRender('kingkong_drag'));
        this._flash = false;
        this.ready = false;
        this.layer = null;
        this.cr = null;
    }

    start() {
        if (this.cr) return;
        this.cr = this._make();
        this.layer = this.cr.image({ target: this.o.target, klass: 'overlay', x: this.o.x, y: this.o.y, w: this.o.w, h: this.o.h, iw: this.o.w, ih: this.o.h });
        this.cr.on('ready', () => { this.ready = true; this.push(); });
        this.cr.on('layer', (ref, state) => { if (state === 'error' || state === 'hidden') this.ready = (state !== 'error'); });
        this.cr.connect();
    }

    /** RGBA pixels of the theme for the current model; also the test hook. */
    pixels() {
        const rec = new kit.Recorder(this.o.w, this.o.h, { textScale: 1 });
        drawTheme(rec, this.get(), this.o);
        const cv = new Canvas(this.o.w, this.o.h);
        kit.play(rec.words(), cv);
        return cv.d;
    }

    push() {
        if (!this.cr || !this.ready || this.layer == null) return;
        try { this.cr.pixels(this.layer, null, Buffer.from(this.pixels())); } catch (e) { /* client reconnects on its own */ }
    }

    stop() { if (this.cr) { try { this.cr.close(); } catch (e) { /* ignore */ } this.cr = null; this.ready = false; } }
}

module.exports = { KingKongCluster, drawTheme, DEFAULTS };
