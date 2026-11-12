# KingKong iDrive apps

**KingKong Drag** for BMW iDrive 7 and iDrive 8 head units (MGU). Members download their own copy at inspect.kingkongtuning.se/car-app, tied to the VIN of their car, and install it through [mgu-store](https://github.com/robertnisipeanu/mgu-store) from a USB stick (folder `oap/`). It needs the Store's renderer (`mgu-render`), and `mgu-uplink` for sending logs. Without a valid licence for the car the app shows a lock screen and does nothing.

| Tab | What it does |
|---|---|
| DRAG | 60 ft, 0-100, 100-200 and 201 m with trap speed and records. A QR code brings a run to TuneInspect. |
| LIVE | Ethanol, boost and target, lambda, oil, coolant, charge air, knock retard. |
| MAP | MHD map 1-4 and Max Cooling, also while driving. Needs MHD on the car. |
| FEL | Reads the fault memory of every control unit. Clearing needs two presses and a stationary car. |
| LOGG | Automatic logging, a CSV per engine run in the app's data folder (`data/logs`, 40 MB, oldest removed). TuneInspect reads these files. |

**What goes to the car.** Reads of the engine unit (UDS 22) only while the engine runs, since flashing is done with the engine off. Writes only on a press: map switch (`2F 01 xx`), Max Cooling (`2F 03 xx`), clear faults (`14 FF FF FF`). A map switch counts only when the engine unit echoes it, and it cannot tell which map is active.

Times come from the car's own speed signal, so wheelspin and tyre size affect them: use a Dragy or a timing system for real numbers. Channel identifiers come from a B58 catalog, and a channel the car doesn't have stays empty (the LOGG tab lists them).

Use it on a closed area only.

## Credits

Built on the work of the community: [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) (the timer, diagnostics, channel catalog and drawing kit, MIT), [mgu-store](https://github.com/robertnisipeanu/mgu-store) (the Store, renderer and app platform the app runs on). Fonts: Inter (SIL OFL 1.1). Not made or endorsed by BMW.

See LICENSE. `node tests/test_all.js` runs the timer, the screens and the app's start without a head unit.
