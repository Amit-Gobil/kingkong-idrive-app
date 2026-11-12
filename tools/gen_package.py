#!/usr/bin/env python3
"""Writes the RHMI files, SOME/IP manifest and icon of apps/kingkong_drag/package. Standard library only; the icon comes from gen_logo.py."""
import json, sys
from pathlib import Path
A = Path(__file__).resolve().parents[1] / 'apps/kingkong_drag'; P = A / 'package'; V = '0.3.0'
STORE = Path(sys.argv[1])  # mgu-store/apps/robertn_store/package: the list of HMI languages and the manifest's base proxies
STATE, TITLE = 'ST_OnlineApps_KingKongDrag', 'kkDragTitle'
TABS = 5
def dump(p, d): p.parent.mkdir(parents=True, exist_ok=True); p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + '\n')
HMI = {'ID7': ('LT_State_Wide', 'LT_Button_1Row', {'Text': {'value': 'SID_KK_RENDERER', 'type': 'StringId'}}),
       'ID8': ('LT_State_Wide_List', 'LT_Button_MediaEntry_1Row', {'PrimaryText': {'value': 'SID_KK_RENDERER', 'type': 'StringId'}, 'FrequencyText': {'value': '', 'type': 'Text'},
               'FrequencyVisible': {'value': False, 'type': 'Bool'}, 'IconVisible': {'value': False, 'type': 'Bool'}, 'ProgressVisible': {'value': False, 'type': 'Bool'}, 'IsPlaying': {'value': False, 'type': 'Bool'}})}
for hmi, (state, button, row) in HMI.items():
    d = P / 'rhmiData/uiDescriptions' / hmi; d.mkdir(parents=True, exist_ok=True)
    buttons = ''.join(f'''            <component id="{20 + i}" type="button" widget="{button}">
                <property id="2" value="1"/>
                <property id="3" value="3"/>
            </component>
''' for i in range(TABS))
    (d / 'application.xml').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<application>
    <container id="1" type="state" widget="{state}">
        <layoutGroup id="102" name="Titlebar">
            <component id="10" type="title">
                <property id="2" value="1"/>
            </component>
        </layoutGroup>
        <layoutGroup id="103" name="List">
            <property id="3" value="1"/>
{buttons}        </layoutGroup>
    </container>
</application>
''')
    dump(d / 'uiDescription.json', {'schemaVersion': '1.3.0', 'containers': {'1': {'type': 'state', 'name': STATE, 'components': {
        '10': {'type': 'title', 'name': TITLE, 'properties': {'Visible': {'value': 1, 'type': 'UInt'}}, 'rows': [{'Text': {'value': 'SID_KK_TITLE', 'type': 'StringId'}}]},
        **{str(20 + i): {'type': 'button', 'name': f'kkTab{i}', 'properties': {'Visible': {'value': 1, 'type': 'UInt'}, 'Focusable': {'value': 3, 'type': 'UInt'}}, 'rows': [row]} for i in range(TABS)}}}}})
dump(P / 'rhmiData/application.json', {'schemaVersion': '1.3.0', 'application': {
    'uuid': 'a7c1f2d4-6b0e-4f3a-9c55-1e8d2b7a4c10', 'type': 'OnlineApp', 'name': 'kingkong_drag', 'vendor': 'KingKong Tuning', 'version': V, 'defaultLanguage': 'en_GB',
    'uiDescriptions': [{'applicationFilePath': f'./uiDescriptions/{h}/application.xml', 'uiDescriptionFilePath': f'./uiDescriptions/{h}/uiDescription.json', 'hmi': [h]} for h in HMI],
    'stringBundleUuid': 'b3d9e610-2a7c-4c18-8f41-5a6c0e9d2f33', 'resourceBundleUuid': 'c8e2a4b7-91d3-4e06-b7a2-3f1d6c8e5b44',
    'variantGroups': [{'stringsPath': './variantGroups/Common/texts', 'resourcesPath': './variantGroups/Common/images', 'hmi': list(HMI), 'brands': ['BMW']}],
    'entryPoints': [{'name': 'kingkong_drag', 'uuid': 'd4f6b8a2-37e1-4a9d-a6c3-7b2e9f1c5d66', 'textId': 'SID_KK_TITLE', 'icon': 'kingkong_drag_icon.png',
        'insertionStateId': 20974, 'insertionFocusId': 2, 'insertionMode': 'INSERT_BELOW', 'insertionOrder': 0, 'insertionPriority': 0, 'previewType': 'NONE',
        'bookmarkable': True, 'private': None, 'appearance': 'DEFAULT', 'isGroupHeader': False, 'insertionGroup': 0}]}})
strings = {'SID_KK_TITLE': 'KingKong Drag', 'SID_KK_RENDERER': 'KingKong Drag: renderer saknas'}
for f in sorted((STORE / 'rhmiData/variantGroups/Common/texts').glob('*.json')) + [Path('sv_SE.json')]:
    dump(P / 'rhmiData/variantGroups/Common/texts' / f.name, strings)
m = json.loads((STORE / 'manifest.json').read_text())
for k in ('de.bmw.infotainment.controlelements.FrontCCU', 'de.bmw.infotainment.KombiIF'): m['proxies'].pop(k, None)
m['proxies']['de.bmw.infotainment.vehicle.Vehicle2'] = '*'
m['proxies']['de.bmw.infotainment.vehicle.CDS2'] = '*'
m['proxies']['de.bmw.infotainment.vehicle.CDS'] = '*'
m['proxies']['com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu'] = '*'
dump(P / 'manifest.json', m)
pk = json.loads((STORE / 'package.json').read_text())
pk.update(name='kingkong_drag', version=V, description='KingKong Tuning: drag timer, live data, MHD map switch, fault codes and automatic logging', author='KingKong Tuning', mguHmi=list(HMI))
pk['mguInternet'] = True; pk['files'] = pk['files'] + ['license.json']; pk['license'] = 'SEE LICENSE IN LICENSES.txt'; pk['oapAppSettings'].update(loggingId='KKDR', cpuLimit=30, maxDiskUsage=62914560)
dump(P / 'package.json', pk)
dump(P / 'npm-shrinkwrap.json', {'name': 'kingkong_drag', 'version': V, 'lockfileVersion': 1, 'requires': True, 'dependencies': {}})
dump(A / 'mgu-app.json', {'schema': 1, 'id': 'kingkong_drag', 'version': V, 'tree': 'package', 'internet': True,
    'modules': ['src/main.js', 'src/view.js', 'src/channels.js', 'src/poller.js', 'src/logstore.js', 'src/diag.js', 'src/ecus.js', 'src/qrcodegen.js', 'src/timer.js', 'src/i18n.js', 'src/kit_record.js', 'src/kit_canvas.js', 'src/kit_fonts.js', 'src/logo.js', 'src/font_regular.js', 'src/font_semibold.js', 'src/render_link.js', 'src/license.js', 'src/uploader.js'],
    'sdk': ['oap-sdk/src/core/OnlineApp.js', 'oap-sdk/src/logging/logging', 'oap-sdk/src/someip/someipBuilders']})
(P / 'CHANGELOG.md').write_text(f'## {V}\n\nTied to one car and account on TuneInspect. Logs go to the garage when the car has internet.\n')
(P / 'LICENSES.txt').write_text('KingKong Drag: copyright KingKong Tuning, all rights reserved, for members of TuneInspect.\nBuilt on open-source work, thanks to the developers:\nsrc/timer.js, src/diag.js, src/ecus.js, src/render_link.js and src/kit_*.js come from idrive7-apps (MIT, src/LICENSE-kit.txt). Channel identifiers from its DME catalog.\nsrc/qrcodegen.js is by Project Nayuki (MIT, src/LICENSE-qrcodegen.txt).\nThe fonts are Inter (SIL OFL 1.1, src/LICENSE-Inter.txt).\n')
