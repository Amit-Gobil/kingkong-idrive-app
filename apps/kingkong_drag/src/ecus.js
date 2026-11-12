'use strict';
/**
 * ecus.js - control unit names by diagnostic address (unknown ones show as "ECU 0x..").
 *
 * The G20 entries are a G20's own SVT (E-Sys / BimmerCode backup of a G20 330e: base variant per
 * address); the rest are F-series addresses for other cars. Used by the Fault Scanner and Live Data.
 */
const ECU = {
    0x01: 'ACSM krockkuddar', 0x06: 'ICAM kameror', 0x07: 'SME HV-batteri', 0x08: 'SRR hörnradar',
    0x0D: 'HKFM baklucka', 0x10: 'BDC central', 0x12: 'DME motor', 0x13: 'DME 2', 0x14: 'OBC laddare',
    0x18: 'EGS växellåda', 0x1D: 'TFM bränsletank', 0x20: 'SRR hörnradar', 0x21: 'FRR främre radar',
    0x23: 'SAS assistanssensorer', 0x28: 'SRR hörnradar', 0x29: 'DSC bromsar', 0x2A: 'SRR hörnradar',
    0x2C: 'USS parkeringssensorer', 0x30: 'EPS styrning', 0x37: 'RAM ljudsystem', 0x38: 'VTG xDrive',
    0x39: 'DSC bromsservo', 0x3A: 'EME elmotor', 0x40: 'BDC kaross', 0x43: 'FLM strålkastare',
    0x44: 'FLM strålkastare', 0x45: 'DCS förarkamera', 0x56: 'FZD tak', 0x5D: 'KAFAS kamera',
    0x5E: 'GWS växelväljare', 0x60: 'KOMBI instrument', 0x61: 'ATM telematik', 0x63: 'Huvudenhet',
    0x64: 'PDC parkering', 0x67: 'ZBE iDrive-ratt', 0x6D: 'SM stolmodul', 0x76: 'VDP dämpare',
    0x78: 'IHKA klimat',
};

module.exports = { ECU };
