'use strict';
/**
 * KingKong Drag for BMW iDrive 7 / 8 head units (MGU): drag timer, live values, MHD map switch,
 * fault codes and automatic logging.
 *
 * What goes to the car:
 *  - reads (UDS 22) of the DME, only while the engine runs (Poller; a flash is done with the engine off);
 *  - on a press only: MHD map (2F 01 xx), MHD Max Cooling (2F 03 xx), fault memory read and clear (19, 14).
 */
const fs = require('fs');
const path = require('path');
const OnlineApp = require('oap-sdk/src/core/OnlineApp.js');
const logging = require('oap-sdk/src/logging/logging');
const someipBuilders = require('oap-sdk/src/someip/someipBuilders');
const { RenderClient } = require('./render_link.js');
const kit = require('./kit_record.js');
const qrcodegen = require('./qrcodegen.js');
const { RunTimer } = require('./timer.js');
const { Race } = require('./race.js');
const { KingKongCluster } = require('./cluster.js');
const { Diag, parseDtcReply, statusInfo, replyTo, hex } = require('./diag.js');
const { ECU } = require('./ecus.js');
const { CHANNELS } = require('./channels.js');
const { Bus, Poller, DME } = require('./poller.js');
const { LogStore } = require('./logstore.js');
const { hashVin, readLicense, vinFromReply } = require('./license.js');
const { Uploader } = require('./uploader.js');
const { draw, hit, placement, DESIGN, SPLITS, TABS, LIVE_DEFAULT, LIVE_MAX } = require('./view.js');

const logger = logging.getSDKLogger();
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const BEST_FILE = path.join(DATA_DIR, 'kingkong_best.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'kingkong_settings.json');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const LICENSE_FILE = path.join(__dirname, '..', 'license.json');
const VIN_FILE = path.join(DATA_DIR, 'kingkong_car.json');
const VIN_RETRY_MS = 5000;
const BODY_UNIT = 0x40;
const UPLOAD_EVERY_MS = 60000;
const LOG_MAX_BYTES = 40 * 1048576;
const ROOT_STATE = 'ST_OnlineApps_KingKongDrag';
const SHARE_URL = 'https://inspect.kingkongtuning.se/car-time';
const TASU = ['com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu', 'SystemFunctionsInternalTasuInst1'];
const FPS = 30;
const RENDERER_WAIT_MS = 3000;
const CLOSED_RESHOW_MS = 500;
const INVALID = 65535;
const ENGINE_RUNNING_RPM = 400;
const ENGINE_SIGNAL_MAX_AGE_MS = 5000;
const COMMAND_TIMEOUT_MS = 3000;
const STATUS_SV = { ACTIVE: 'AKTIV', 'WARNING LAMP': 'VARNINGSLAMPA', PENDING: 'VÄNTANDE', STORED: 'SPARAD', HISTORY: 'HISTORIK' };
const COOLING_MIN_RPM = 500;
const STOPPED_KMH = 0.5;
const SPEED_READ_TIMEOUT_MS = 1500;
const CLEAR_ARM_MS = 5000;
const FOREGROUND_REASONS = ['ENTRY_POINT', 'LUM', 'BOOKMARK', 'START_WIDGET', 'TRIGGER_HMI', 'SPEECH_COMMAND'];

/* Milliseconds that never jump: the head unit's wall clock can be corrected at any moment. */
function mono() { const t = process.hrtime(); return t[0] * 1000 + t[1] / 1e6; }

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } };
function writeJson(file, value) {
    try { fs.mkdirSync(DATA_DIR); } catch (e) { /* it exists */ }
    try { fs.writeFileSync(file, JSON.stringify(value)); } catch (e) { logger.warn('save: ' + e.message); }
}

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

class KingKongDrag extends OnlineApp {
    constructor() {
        super();
        this._visible = false;
        this._drawable = false;
        this._scale = 1;
        this._tab = 'drag';
        this._speed = 0;
        this._signal = false;
        this._rpm = 0;
        this._rpmAt = 0;
        this._peakG = 0;
        this._peaks = {};       // session peaks for the ENGINE tab (rpm, boost, power, torque, speed)
        this._newBest = {};
        this._qr = null;
        this._touch = null;
        this._manual = false;
        this._best = readJson(BEST_FILE, {});
        this._settings = Object.assign({ autolog: true }, readJson(SETTINGS_FILE, {}));
        this._map = { current: null, cooling: null, message: '', bad: false, busy: false };
        this._fel = { rows: [], page: 0, message: '', bad: false, busy: false, armed: false };
        this._license = readLicense(readJson(LICENSE_FILE, null));
        const seen = readJson(VIN_FILE, {}).vin;
        this._lock = !this._license ? 'nolicense' : seen === this._license.vin ? null : 'needvin';
        this._vinChecked = false;
        this._vinRetryAt = 0;
        this._bus = new Bus();
        this._diag = new Diag(signals, logger);
        this._diag.quiet = true;
        this._diag.busyLog = false;
        try { fs.mkdirSync(DATA_DIR); } catch (e) { /* it exists */ }
        this._store = new LogStore({ dir: LOG_DIR, maxBytes: LOG_MAX_BYTES, columns: this._logColumns(), log: logger });
        this._logFiles = this._store.list();
        this._uploader = new Uploader({ store: this._store, token: this._license && this._license.token, leaseFile: path.join(DATA_DIR, 'uplink.json'), log: logger });
        this._poller = new Poller({ diag: this._diag, bus: this._bus, log: logger, now: mono,
            should: () => this._wantDme() && this._engineRunning(),
            onSample: (values, now) => { this._trackPeaks(values); this._store.row(now, Object.assign({ speed: this._speed }, values)); } });
        this._timer = new RunTimer(SPLITS, {
            onDone: (run) => this._runDone(run),
            onLaunch: () => { this._peakG = 0; this._newBest = {}; this._qr = null; },
        });
        this._race = new Race(SPLITS, { now: mono });
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

    /* Add or remove a LIVE value (or toggle a feature) from the Anpassa tab; saved per driver. */
    _customise(what) {
        if (what === 'cluster') { this._settings.cluster = !this._settings.cluster; writeJson(SETTINGS_FILE, this._settings); this._applyCluster(); return; }
        const sel = (this._settings.live && this._settings.live.length) ? this._settings.live.slice() : LIVE_DEFAULT.slice();
        const i = sel.indexOf(what);
        if (i >= 0) sel.splice(i, 1);
        else if (sel.length < LIVE_MAX) sel.push(what);
        this._settings.live = sel;
        writeJson(SETTINGS_FILE, this._settings);
    }

    /* Start or stop the cluster layer to match the setting. Drawing needs cluster-render on the unit;
       without it the client just retries quietly and nothing shows. */
    _applyCluster() {
        if (this._settings.cluster && !this._cluster) {
            this._cluster = new KingKongCluster({ get: () => this._clusterModel() });
            this._cluster.start();
            this._clusterLoop = setInterval(() => this._cluster.push(), 100);
        } else if (!this._settings.cluster && this._cluster) {
            clearInterval(this._clusterLoop); this._clusterLoop = null;
            this._cluster.stop(); this._cluster = null;
        }
    }

    /* What the cluster strip shows now: rpm, gear, boost (kPa gauge) and knock. */
    _clusterModel() {
        const v = this._poller.values || {};
        return {
            rpm: this._rpm,
            speed: this._speed,
            gear: v.gear,
            boost: (typeof v.boost === 'number' && typeof v.ambient === 'number') ? v.boost - v.ambient : null,
            knock: v.knock,
            oil: v.oil,
            coolant: v.coolant,
            ethanol: v.ethanol,
        };
    }

    _logColumns() {
        const cols = CHANNELS.map((c) => ({ key: c.key, head: c.head, d: c.d }));
        cols.splice(1, 0, { key: 'speed', head: 'Vehicle Speed (km/h)', d: 1 });
        return cols;
    }

    /* ---- what may run ---- */

    _engineRunning() {
        return this._rpm >= ENGINE_RUNNING_RPM && mono() - this._rpmAt <= ENGINE_SIGNAL_MAX_AGE_MS;
    }

    _logWanted() { return !this._lock && (this._settings.autolog || this._manual); }

    _wantDme() { return !this._lock && (this._logWanted() || (this._visible && this._tab === 'live')); }

    /* Once per start, with the engine running: is this the car the licence was made for? */
    _checkCar() {
        if (!this._license || this._vinChecked || this._vinBusy || !this._engineRunning() || mono() < this._vinRetryAt) return;
        this._vinBusy = true;
        const data = [0xF1, 0x90];
        const read = (unit) => this._bus.run(() => (this._engineRunning()
            ? this._diag.physical(unit, 0x22, data, COMMAND_TIMEOUT_MS, replyTo(0x22, data), { maxRetries: 0 }) : null), true).catch(() => null);
        // the engine unit first; the body controller keeps the car's own VIN when the engine unit has been replaced
        read(DME).then((a) => read(BODY_UNIT).then((b) => {
            this._vinBusy = false;
            const vins = [vinFromReply(a), vinFromReply(b)].filter(Boolean);
            if (!vins.length) { this._vinRetryAt = mono() + VIN_RETRY_MS; return; }
            this._vinChecked = true;
            if (vins.some((vin) => hashVin(vin) === this._license.vin)) {
                this._lock = null;
                writeJson(VIN_FILE, { vin: this._license.vin });
            } else {
                this._lock = 'wrongcar';
                writeJson(VIN_FILE, {});
                this._updateLog();
            }
        }));
    }

    /* Starts and ends the log run: called on every engine speed reading and by the timer. */
    _updateLog() {
        const now = mono();
        const running = this._engineRunning();
        if (running && this._logWanted()) {
            if (!this._store.active) this._store.begin(now);
        } else if (this._store.active) {
            this._store.end(now);
            this._logFiles = this._store.list();
        }
        if (!running) this._manual = false;
    }

    /* ---- drag ---- */

    _runDone(run) {
        const fresh = {};
        Object.keys(run.result).forEach((k) => {
            const b = this._best[k];
            if (!b || run.result[k] < b.s) {
                this._best[k] = { s: run.result[k], at: run.at, trap: run.trap[k] };
                fresh[k] = true;
            }
        });
        this._newBest = fresh;
        this._lastRun = run;
        writeJson(BEST_FILE, this._best);
        logger.info('run ' + JSON.stringify(run.result));
    }

    _shareUrl() {
        const r = this._lastRun, p = [];
        const add = (name, v) => { if (typeof v === 'number') p.push(name + '=' + v.toFixed(2)); };
        add('k100', r.result.kmh100);
        add('k200', r.result.kmh200);
        add('e', r.result.m201);
        add('f', r.result.ft60);
        if (typeof r.trap.m201 === 'number') p.push('t=' + r.trap.m201.toFixed(1));
        p.push('d=' + new Date(r.at).toISOString().slice(0, 10));
        return SHARE_URL + '?' + p.join('&');
    }

    _showQr() {
        if (!this._lastRun) return;
        const q = qrcodegen.QrCode.encodeText(this._shareUrl(), qrcodegen.QrCode.Ecc.MEDIUM);
        const dark = [];
        for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) dark.push(q.getModule(x, y));
        this._qr = { size: q.size, dark };
    }

    /* ---- commands, only on a press ---- */

    _command(data) {
        return this._bus.run(() => this._diag.physical(DME, 0x2F, data, COMMAND_TIMEOUT_MS, replyTo(0x2F, data), { maxRetries: 1 }), true);
    }

    _say(message, bad) { this._map.message = message; this._map.bad = !!bad; }

    /** A press counts only when the DME echoes it back; an untuned DME refuses it. */
    _sendTune(data, onOk, what) {
        if (this._map.busy) return Promise.resolve();
        if (!this._engineRunning()) { this._say('Starta motorn först', true); return Promise.resolve(); }
        this._map.busy = true;
        this._say(what + '…');
        return this._command(data).then((uds) => {
            if (uds && uds[0] === 0x6F) { onOk(); return; }
            if (uds && uds[0] === 0x7F) this._say('Motorstyrningen nekade kommandot. Finns MHD på bilen?', true);
            else this._say('Inget svar från motorstyrningen', true);
        }).catch(() => this._say('Något gick fel, försök igen', true)).then(() => { this._map.busy = false; });
    }

    _switchMap(n) {
        return this._sendTune([0x01, n - 1], () => { this._map.current = n; this._say(`Bilen bekräftade map ${n}`); }, `Byter till map ${n}`);
    }

    _setCooling(on) {
        if (on && !(this._engineRunning() && this._rpm >= COOLING_MIN_RPM)) { this._say('Max Cooling kräver att motorn går', true); return Promise.resolve(); }
        return this._sendTune([0x03, on ? 1 : 0], () => { this._map.cooling = on; this._say(on ? 'Max Cooling på' : 'Max Cooling av'); }, 'Skickar Max Cooling');
    }

    _readFaults() {
        const f = this._fel;
        if (f.busy) return Promise.resolve();
        f.busy = true;
        f.message = 'Läser…';
        f.bad = false;
        return this._bus.run(() => this._diag.functional(0x19, [0x02, 0x0C], {}), true).then((replies) => {
            const rows = [];
            replies.forEach((uds, addr) => parseDtcReply(uds, [0x02, 0x0C]).dtcs.forEach((d) => {
                const info = statusInfo(d.status);
                rows.push({ ecu: ECU[addr] || 'Enhet 0x' + hex(addr), code: d.code, status: STATUS_SV[info.label] || info.label, active: info.sev === 'crit' });
            }));
            rows.sort((a, b) => Number(b.active) - Number(a.active));
            f.rows = rows;
            f.page = 0;
            f.message = rows.length ? `${rows.length} felkoder i ${replies.size} enheter` : `Inga felkoder i ${replies.size} enheter`;
        }).catch(() => { f.message = 'Kunde inte läsa felkoderna, försök igen'; f.bad = true; }).then(() => { f.busy = false; });
    }

    /* The speed as the car reports it now, null when it can't be read. A stopped car sends no updates, so it is asked. */
    _speedNow() {
        if (!this._speedProxy) return Promise.resolve(null);
        return new Promise((resolve) => {
            const t = setTimeout(() => resolve(null), SPEED_READ_TIMEOUT_MS);
            Promise.resolve().then(() => this._speedProxy.statusCarSpeed2.getValue()).then((v) => {
                clearTimeout(t);
                const raw = v && v.speedVehicleCentreOfGravity;
                resolve(typeof raw === 'number' && raw !== INVALID ? raw / 64 : null);
            }, () => { clearTimeout(t); resolve(null); });
        });
    }

    _clearFaults() {
        const f = this._fel;
        if (f.busy) return Promise.resolve();
        if (!this._signal || this._speed > STOPPED_KMH) { f.message = this._signal ? 'Stanna bilen först' : 'Ingen fartsignal, kan inte radera'; f.bad = true; return Promise.resolve(); }
        if (!f.armed) {
            f.armed = true;
            f.message = 'Tryck igen för att radera allt';
            f.bad = false;
            clearTimeout(this._armTimer);
            this._armTimer = setTimeout(() => { f.armed = false; f.message = ''; }, CLEAR_ARM_MS);
            return Promise.resolve();
        }
        clearTimeout(this._armTimer);
        f.armed = false;
        f.busy = true;
        f.message = 'Raderar…';
        let refused = false;
        // the speed is read inside the job, right before the request; no busy retries, they could go out later
        return this._bus.run(() => this._speedNow().then((kmh) => {
            if (kmh === null || kmh > STOPPED_KMH) { refused = true; return null; }
            return this._diag.functional(0x14, [0xFF, 0xFF, 0xFF], { idleMs: 5000, maxRetries: 0 });
        }), true)
            .catch((e) => { logger.warn('clear: ' + e.message); })
            .then(() => {
                f.busy = false;
                if (refused) { f.message = 'Stanna bilen först'; f.bad = true; return undefined; }
                return this._readFaults();
            });
    }

    /* ---- screen input ---- */

    _onTouch(phase, x, y) {
        const id = hit(this._model(), x, y);
        if (phase === 1) this._touch = id;
        if (phase === 3) {
            if (id && id === this._touch) this._act(id);
            this._touch = null;
        }
    }

    _act(id) {
        if (this._lock) return undefined;
        const [kind, arg] = id.split(':');
        if (kind === 'tab') { this._tab = arg; return undefined; }
        if (kind === 'map') return this._switchMap(Number(arg));
        if (kind === 'cool') return this._setCooling(arg === '1');
        if (id === 'drag:reset') { this._timer.reset(); this._peakG = 0; this._newBest = {}; this._lastRun = null; }
        if (id === 'drag:qr') this._showQr();
        if (id === 'qr:close') this._qr = null;
        if (id === 'fel:read') return this._readFaults();
        if (id === 'fel:clear') return this._clearFaults();
        if (id === 'fel:next') this._fel.page = (this._fel.page + 1) % Math.ceil(this._fel.rows.length / 7);
        if (id === 'log:auto') { this._settings.autolog = !this._settings.autolog; writeJson(SETTINGS_FILE, this._settings); this._updateLog(); }
        if (id === 'log:manual') { this._manual = !this._manual; this._updateLog(); }
        if (id === 'race:start') { if (this._race.canStart(this._signal, this._speed)) this._race.start(); }
        if (id === 'race:again') this._race.reset();
        if (id === 'cluster:toggle') { this._settings.cluster = !this._settings.cluster; writeJson(SETTINGS_FILE, this._settings); this._applyCluster(); }
        if (id && id.indexOf('cust:') === 0) this._customise(id.slice(5));
        return undefined;
    }

    /* A press of the iDrive knob on one of the proxy buttons: its tab, or the tab's main action. */
    _knob(tab) {
        if (this._lock) return;
        if (tab !== this._tab) { this._tab = tab; return; }
        if (tab === 'drag') this._act('drag:reset');
        if (tab === 'logg') this._act('log:auto');
    }

    /* ---- start ---- */

    _start() {
        this._gpu.connect();
        setInterval(() => { const t = mono(); this._timer.idle(t); this._race.tick(t); this._checkCar(); this._updateLog(); }, 50);
        setInterval(() => { if (!this._lock) this._uploader.tick().then(() => { this._logFiles = this._store.list(); }); }, UPLOAD_EVERY_MS);
        this._watchCar();
        this._poller.start();
        this._applyCluster();   // off by default; drawn on the cluster only when turned on (and after the on-car check)
        if (!this.rhmiApplication) return this.initialized();
        const rhmi = this.rhmiApplication;
        this._rootState = rhmi.getByName(ROOT_STATE);
        if (!this._rootState) return Promise.reject(new Error('uiDescription is incomplete'));
        TABS.forEach(([tab], i) => {
            const b = rhmi.getByName('kkTab' + i);
            if (b) b.on('action', () => this._knob(tab));
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
            .then((p) => p.init().then(() => p.waitUntilAvailable()).then(() => { if (attr === 'statusCarSpeed2') this._speedProxy = p; return p[attr].subscribe(fn); }))
            .catch((e) => logger.warn(iface + ' ' + attr + ': ' + (e && e.message)));
        [
            watch('de.bmw.infotainment.vehicle.CDS', 'statusEngineSpeed2', (v) => this._onRpm(v)),
            watch('de.bmw.infotainment.vehicle.Vehicle2', 'statusCarSpeed2', (v) => this._onSpeed(v)),
            watch('de.bmw.infotainment.vehicle.CDS2', 'statusLongitudinalAccelerationMassCenter', (v) => this._onAccel(v)),
            () => new Promise((resolve) => setImmediate(resolve)).then(() => this._diag.init()),
        ].reduce((chain, step) => chain.then(step), Promise.resolve());
    }

    _onRpm(v) {
        const raw = v && v.actualValueRPMEngineCrankshaft;
        if (typeof raw !== 'number' || raw === INVALID) return;
        this._rpm = raw * 0.25;
        this._rpmAt = mono();
        this._updateLog();
    }

    _onSpeed(v) {
        const raw = v && v.speedVehicleCentreOfGravity;
        if (typeof raw !== 'number' || raw === INVALID) { this._signal = false; return; }
        this._signal = true;
        this._speed = raw / 64;
        const t = mono();
        this._timer.feed(t, this._speed);
        this._race.feed(t, this._speed);
    }

    _onAccel(v) {
        const raw = v && v.longitudinalAccelerationCentreOfGravity;
        if (typeof raw !== 'number' || raw === INVALID) return;
        if (this._timer.state === 'run') this._peakG = Math.max(this._peakG, (raw * 0.002 - 65) / 9.80665);
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
        if (visible) { this._logFiles = this._store.list(); }
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

    /* Session peaks for the ENGINE tab. Power/torque are derived from the DME torque channel and rpm. */
    _trackPeaks(v) {
        const pk = this._peaks, mx = (k, val) => { if (typeof val === 'number' && isFinite(val) && (pk[k] == null || val > pk[k])) pk[k] = val; };
        mx('rpm', v.rpm);
        if (v.boost != null && v.ambient != null) mx('boost', (v.boost - v.ambient) / 100);
        mx('torque', v.torque);
        if (v.torque != null && v.rpm != null) mx('power', v.torque * v.rpm / 9549 * 1.341);
        if (typeof this._speed === 'number') mx('speed', this._speed);
    }

    _model() {
        const t = this._timer, p = this._poller;
        return { lock: this._lock, tab: this._tab, qr: this._qr, state: t.state, elapsed: t.elapsed(mono()), speed: this._speed, signal: this._signal,
            result: t.result, trap: t.trapSpeed, best: this._best, newBest: this._newBest, peakG: this._peakG, canShare: !!this._lastRun,
            running: this._engineRunning(), values: p.values, peaks: this._peaks, hz: p.hz, found: p.supported ? p.supported.length : null, total: CHANNELS.length,
            missing: p.supported ? p.missing : [], map: this._map, fel: this._fel,
            log: { auto: this._settings.autolog, manual: this._manual, active: this._store.active, count: this._logFiles.length,
                bytes: this._logFiles.reduce((n, f) => n + f.size, 0), waiting: this._logFiles.filter((f) => f.name.endsWith('.csv')).length },
            race: Object.assign(this._race.model(), { canStart: this._race.canStart(this._signal, this._speed) }),
            clusterOn: !!this._settings.cluster,
            liveSel: this._settings.live };
    }

    _frame() {
        const rec = new kit.Recorder(DESIGN.w, DESIGN.h, { textScale: this._scale });
        draw(rec, this._model());
        this._gpu.frame(rec);
    }

    _shutdown() {
        clearInterval(this._loop);
        this._poller.stop();
        if (this._cluster) this._cluster.stop();
        this._store.end(mono());
        this._gpu.close();
        Promise.resolve().then(() => this.destroyBundles && this.destroyBundles()).catch(() => {}).then(() => process.exit(0));
    }
}

const app = new KingKongDrag();
app.start().catch((e) => logger.error('failed to start: ' + (e && e.message)));
module.exports = app;
