## 0.10.9

Verified S58 channel identifiers. Coolant, lambda and rail pressure now also try the alternate BMW DIDs that the newer S58 DME actually answers (coolant 5805, lambda 5640, rail 5658) before dropping to OBD-II. These are the same identifiers the community Car Data app reads on the G8x.

## 0.10.8

Fixes the slow live rate on the S58. When the DME refuses multi-channel reads, the app now switches to reading one channel at a time immediately instead of waiting out a timeout on every cycle (which had dropped the rate to ~0.3 Hz and blanked the temperatures). Lambda, coolant, oil and charge-air stay up.

## 0.10.7

Robust channel reads. If the DME refuses a grouped request (one unsupported DID made it reject the whole group, which blanked good channels like Lambda and Kylvatten), the app now re-reads each channel in that group on its own, so one bad DID can't take the others down with it. Native BMW DIDs are still tried first, OBD-II only as a fallback.

## 0.10.6

More S58 channels. Coolant (OBD PID 05) and lambda (OBD PID 34) now fall back to the standard OBD-II reads when the car refuses the BMW DIDs, the same way rail pressure and ethanol already did. Fixes blank Kylvatten/Lambda on the G8x S58.

## 0.10.5

iDrive 8 cluster support. The cluster theme now reads the targets the car offers: on iDrive 7 it draws the full panel as before; on iDrive 8 (no full-panel target) it draws a KingKong centre panel in the map window (gear, speed, boost, knock, oil, coolant, ethanol) while BMW's own gauges stay.

## 0.3.0

Tied to one car and account on TuneInspect. Logs go to the garage when the car has internet.
