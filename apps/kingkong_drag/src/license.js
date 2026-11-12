'use strict';
/**
 * The app is tied to one car and one TuneInspect account. license.json is made by TuneInspect when a member
 * downloads the app: { payload, sig }, payload naming the hash of the car's VIN and the car's upload token,
 * sig an ECDSA signature only TuneInspect can make.
 */
const crypto = require('crypto');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEju1ZO7Ma2lvW0/CIxc5VMTnwSFoF
DpafojjZ3EG5S1AQWL0dHShNAJZ9J/CdoMG/bQ7T4GouygtmktG4OShWnw==
-----END PUBLIC KEY-----`;

function hashVin(vin) {
    return crypto.createHash('sha256').update('kingkong-drag:' + String(vin).trim().toUpperCase()).digest('hex');
}

/** The licence's contents if it is genuine, else null. */
function readLicense(file) {
    try {
        if (!file || typeof file.payload !== 'string' || typeof file.sig !== 'string') return null;
        if (!crypto.createVerify('SHA256').update(file.payload).verify(PUBLIC_KEY, file.sig, 'base64')) return null;
        const p = JSON.parse(file.payload);
        return p && p.v === 1 && typeof p.vin === 'string' ? p : null;
    } catch (e) { return null; }
}

/** The VIN in a 22 F1 90 reply, null if it isn't one. */
function vinFromReply(uds) {
    if (!uds || uds[0] !== 0x62 || uds[1] !== 0xF1 || uds[2] !== 0x90) return null;
    const vin = Array.from(uds.slice(3, 20)).map((c) => String.fromCharCode(c)).join('');
    return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null;
}

module.exports = { hashVin, readLicense, vinFromReply };
