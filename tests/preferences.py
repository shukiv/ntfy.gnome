#!/usr/bin/env python3
"""Test actual GTK/Adwaita controls; replace only Shell's preferences host."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
gjs = os.environ.get('GJS') or shutil.which('gjs')
if not gjs:
    raise SystemExit('GJS, GTK 4, libadwaita, and a display (or xvfb-run) are required.')
with tempfile.TemporaryDirectory(prefix='ntfy-prefs-test-') as temporary:
    stage = Path(temporary)
    # The preferences process normally supplies this base class and gettext.
    # All application code, widget classes, signals, and settings remain real.
    (stage / 'host.js').write_text('''
export class ExtensionPreferences {
    constructor(settings) { this._settings = settings; }
    getSettings() { return this._settings; }
}
export const gettext = text => text;
''')
    (stage / 'host.xml').write_text('''<gresources>
<gresource prefix="/org/gnome/Shell/Extensions/js/extensions">
<file alias="prefs.js">host.js</file>
</gresource></gresources>''')
    resource = stage / 'host.gresource'
    subprocess.run(['glib-compile-resources', str(stage / 'host.xml'),
                    f'--sourcedir={stage}', f'--target={resource}'], check=True)
    shutil.copytree(root / 'schemas', stage / 'schemas')
    subprocess.run(['glib-compile-schemas', '--strict', str(stage / 'schemas')], check=True)
    subprocess.run([gjs, '-m', str(root / 'tests/preferences.js'), str(resource), str(stage / 'schemas')],
                   env={**os.environ, 'GSETTINGS_BACKEND': 'memory'}, check=True, timeout=20)
print('Native preferences passed: construction, add, duplicate validation, toggle, remove, invalid settings, close.')
