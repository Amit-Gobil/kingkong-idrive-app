'use strict';
/**
 * KingKong — live engine data for BMW iDrive 7 / 8 head units (MGU).
 * A clean read-only app: it reads the engine unit (DME, UDS 22 — with OBD-II fallbacks where the S58
 * refuses the BMW identifiers) and the gearbox unit (EGS, 0x18), and shows them in five tabs
 * (Engine, Fuel & Air, Transmission, Details, Settings). It never writes to the car.
 */
const OnlineApp = require('oap-sdk/src/core/OnlineApp.js');
const logging = require('oap-sdk/src/logging/logging');
const someipBuilders = require('oap-sdk/src/someip/someipBuilders');
const { RenderClient } = require('./render_link.js');
const kit = require('./kit_record.js');
const { Diag } = require('./diag.js');
const { CHANNELS } = require('./channels.js');
const { Bus, Poller } = require('./poller.js');
const { DetailsReader } = require('./details.js');
const { TransReader } = require('./trans.js');
const { draw, hit, placement, DESIGN, TABS } = require('./view.js');

const logger = logging.getSDKLogger();
const ROOT_STATE = 'ST_OnlineApps_KingKongDrag';   // the rhmiData state id (kept so the app still boots)
const FPS = 30;
const RENDERER_WAIT_MS = 3000;
const CLOSED_RESHOW_MS = 500;
const INVALID = 65535;
const FOREGROUND_REASONS = ['ENTRY_POINT', 'LUM', 'BOOKMARK', 'START_WIDGET', 'TRIGGER_HMI', 'SPEECH_COMMAND'];
const LIVE_TABS = ['live', 'fuelair', 'details'];   // tabs that poll the DME

/* Milliseconds that never jump: the head unit's wall clock can be corrected at any moment. */
function mono() { const t = process.hrtime(); return t[0] * 1000 + t[1] / 1e6; }

/* What kit's Diag needs from a SOME/IP proxy, on the SDK's typed proxies. */
const signals = {
    proxy: (iface, instance) => someipBuilders.buildTypedProxy(iface, instance).then((p) => p.init().then(() => p)),
    on: (p, name, fn) => p[name].subscribe(fn),
    onAvailable: (p, fn) => { p.waitUntilAvailable().then(() => fn(true)).catch(() => {}); return Promise.resolve(); },
    call: (p, method, params, timeoutMs) => new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(method + ' timed out')), timeoutMs || 5000);
        Promise.resolve(p[method](params)).then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
    }),
};

class KingKong extends OnlineApp {
    constructor() {
        super();
        this._visible = false;
        this._drawable = false;
        this._scale = 1;
        this._tab = 'live';
        this._speed = 0;
        this._rpm = 0;
        this._peaks = {};       // session peaks for the Engine tab (rpm, boost, power, torque, speed)
        this._touch = null;
        this._bus = new Bus();
        this._diag = new Diag(signals, logger);
        this._diag.quiet = true;
        this._diag.busyLog = false;
        this._poller = new Poller({ diag: this._diag, bus: this._bus, log: logger, now: mono,
            should: () => this._visible && LIVE_TABS.indexOf(this._tab) >= 0,
            onSample: (values) => this._trackPeaks(values) });
        this._details = new DetailsReader({ diag: this._diag, bus: this._bus, log: logger,
            should: () => this._visible && this._tab === 'details' });
        this._trans = new TransReader({ diag: this._diag, bus: this._bus, log: logger,
            should: () => this._visible && this._tab === 'transmission' });
        this._gpu = new RenderClient('kingkong_drag', logger, { native: true });
        this._gpu.fps(FPS);
        this._gpu.on('ready', () => this._rendererReady(this._gpu.info));
        this._gpu.on('close', () => { this._drawable = false; });
        this._gpu.on('touch', (phase, x, y) => this._onTouch(phase, x, y));
        this._gpu.on('closed', () => setTimeout(() => this._applyVisible(), CLOSED_RESHOW_MS));
        this.on('initialized', () => this._start().catch((e) => logger.error('start failed: ' + (e && e.message))));
        this.on('shutdown', () => this._shutdown());
        this.on('error', (e) => logger.warn('OnlineApp error: ' + (e && e.message)));
        this.on('entryPointExecute', (uuid) => this._open(uuid));
        this.on('changeVisibility', (d) => { if (d && d.visible === false) this._setVisible(false); });
    }

    /* ---- start ---- */

    _start() {
        this._gpu.connect();
        setInterval(() => { if (this._visible && this._tab === 'details') this._details.tick().catch(() => {}); }, 160);
        setInterval(() => { if (this._visible && this._tab === 'transmission') this._trans.tick().catch(() => {}); }, 200);
        this._watchCar();
        this._poller.start();
        if (!this.rhmiApplication) return this.initialized();
        const rhmi = this.rhmiApplication;
        this._rootState = rhmi.getByName(ROOT_STATE);
        if (!this._rootState) return Promise.reject(new Error('uiDescription is incomplete'));
        TABS.forEach(([tab], i) => {
            const b = rhmi.getByName('kkTab' + i);
            if (b) b.on('action', () => { this._tab = tab; });
        });
        rhmi.on('applicationStackChanged', (stack) => {
            const keys = stack && typeof stack === 'object' ? Object.keys(stack) : [];
            if (keys.length) this._setVisible(Object.prototype.hasOwnProperty.call(stack, 'ROOT_APP'));
        });
        const foreground = FOREGROUND_REASONS.indexOf(((this.getVisibilityData && this.getVisibilityData()) || {}).reason || this.startReason) >= 0;
        return this._rendererAnswer()
            .then(() => this._registerEntryPoint())
            .then(() => { if (foreground) this.registerActive(); return this.initialized(); })
            .then(() => {
                if (foreground) this._setVisible(true);
                const last = this.getLastExecutedEntryPointUuid && this.getLastExecutedEntryPointUuid();
                return last ? this._open(last) : undefined;
            });
    }

    _rendererAnswer() {
        return new Promise((resolve) => {
            const timer = setTimeout(resolve, RENDERER_WAIT_MS);
            this._gpu.once('ready', () => { clearTimeout(timer); resolve(); });
        });
    }

    _registerEntryPoint() {
        const described = (this.appDescription && this.appDescription.application.entryPoints) || [];
        const ours = this.getEntryPoints().find((ep) => described.some((d) => d.uuid === ep.getDescription().uuid));
        if (!ours) return Promise.reject(new Error('no entry point handed over'));
        const uuid = ours.getDescription().uuid;
        return ours.init()
            .then(() => this.rhmiApplication.mapEntryState(uuid, this._rootState))
            .then(() => ours.setAvailability('ENABLED'));
    }

    _open(uuid) {
        if (!this.rhmiApplication || !uuid) return Promise.resolve();
        this._setVisible(true);
        return Promise.resolve(this.rhmiApplication.openEntryState(uuid))
            .catch((e) => logger.warn('openEntryState: ' + (e && e.message)));
    }

    /* One proxy at a time, each from a fresh tick: the native SOME/IP binding can deadlock otherwise. */
    _watchCar() {
        const watch = (iface, attr, fn) => () => new Promise((resolve) => setImmediate(resolve))
            .then(() => someipBuilders.buildTypedProxy(iface, '1'))
            .then((p) => p.init().then(() => p.waitUntilAvailable()).then(() => p[attr].subscribe(fn)))
            .catch((e) => logger.warn(iface + ' ' + attr + ': ' + (e && e.message)));
        [
            watch('de.bmw.infotainment.vehicle.CDS', 'statusEngineSpeed2', (v) => this._onRpm(v)),
            watch('de.bmw.infotainment.vehicle.Vehicle2', 'statusCarSpeed2', (v) => this._onSpeed(v)),
            () => new Promise((resolve) => setImmediate(resolve)).then(() => this._diag.init()),
        ].reduce((chain, step) => chain.then(step), Promise.resolve());
    }

    _onRpm(v) {
        const raw = v && v.actualValueRPMEngineCrankshaft;
        if (typeof raw !== 'number' || raw === INVALID) return;
        this._rpm = raw * 0.25;
    }

    _onSpeed(v) {
        const raw = v && v.speedVehicleCentreOfGravity;
        if (typeof raw !== 'number' || raw === INVALID) return;
        this._speed = raw / 64;
    }

    /* ---- drawing ---- */

    _rendererReady(info) {
        if (!info || info.modes.indexOf('layer') < 0) {
            logger.warn('mgu-render has no layer mode; nothing to draw on');
            this._drawable = false;
            return;
        }
        const box = info.appArea;
        const p = placement(box.w, box.h);
        this._scale = p.scale;
        this._gpu.place({ x: box.x, y: box.y, w: box.w, h: box.h, scale: p.scale, ox: p.ox, oy: p.oy });
        this._drawable = true;
        this._applyVisible();
    }

    _setVisible(visible) {
        if (this._visible === visible) return;
        this._visible = visible;
        const report = visible ? this.registerHmiVisible : this.unregisterHmiVisible;
        if (report) Promise.resolve(report.call(this)).catch(() => {});
        this._applyVisible();
    }

    _applyVisible() {
        clearInterval(this._loop);
        this._loop = null;
        if (this._visible && this._drawable) {
            this._gpu.claim([{ x: 0, y: 0, w: DESIGN.w, h: DESIGN.h }]);
            this._frame();
            this._gpu.show(true);
            this._loop = setInterval(() => this._frame(), Math.round(1000 / FPS));
        } else {
            this._gpu.claim([]);
            this._gpu.show(false);
        }
    }

    /* ---- input ---- */

    _onTouch(phase, x, y) {
        const id = hit(this._model(), x, y);
        if (phase === 1) this._touch = id;
        if (phase === 3) {
            if (id && id === this._touch) this._act(id);
            this._touch = null;
        }
    }

    _act(id) {
        const [kind, arg] = id.split(':');
        if (kind === 'tab') { this._tab = arg; return; }
        if (id === 'set:peaks') this._peaks = {};
    }

    /* Session peaks for the Engine tab. Power/torque are derived from the DME torque channel and rpm. */
    _trackPeaks(v) {
        const pk = this._peaks, mx = (k, val) => { if (typeof val === 'number' && isFinite(val) && (pk[k] == null || val > pk[k])) pk[k] = val; };
        mx('rpm', v.rpm);
        if (v.boost != null && v.ambient != null) mx('boost', (v.boost - v.ambient) / 100);
        mx('torque', v.torque);
        if (v.torque != null && v.rpm != null) mx('power', v.torque * v.rpm / 9549 * 1.341);
        if (typeof this._speed === 'number') mx('speed', this._speed);
    }

    _model() {
        const p = this._poller;
        return {
            tab: this._tab,
            speed: this._speed,
            values: p.values,
            peaks: this._peaks,
            hz: p.hz,
            found: p.supported ? p.supported.length : null,
            total: CHANNELS.length,
            details: this._tab === 'details' ? this._details.model() : null,
            trans: this._tab === 'transmission' ? this._trans.model() : null,
        };
    }

    _frame() {
        const rec = new kit.Recorder(DESIGN.w, DESIGN.h, { textScale: this._scale });
        draw(rec, this._model());
        this._gpu.frame(rec);
    }

    _shutdown() {
        clearInterval(this._loop);
        this._poller.stop();
        try { this._gpu.show(false); this._gpu.close(); } catch (e) { /* ignore */ }
        Promise.resolve().then(() => this.destroyBundles && this.destroyBundles()).catch(() => {}).then(() => process.exit(0));
    }
}

const app = new KingKong();
app.start().catch((e) => logger.error('failed to start: ' + (e && e.message)));
module.exports = app;
