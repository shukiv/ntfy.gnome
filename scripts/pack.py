#!/usr/bin/env python3
"""Build an extension archive without including development files."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

root = Path(__file__).resolve().parent.parent
metadata = json.loads((root / 'metadata.json').read_text())
output = root / 'dist' / f"{metadata['uuid']}.shell-extension.zip"
output.parent.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='ntfy-gnome-pack-') as temporary:
    stage = Path(temporary)
    for filename in ['metadata.json', 'extension.js', 'prefs.js', 'stylesheet.css']:
        shutil.copy2(root / filename, stage / filename)
    shutil.copytree(root / 'lib', stage / 'lib')
    (stage / 'schemas').mkdir()
    for schema in (root / 'schemas').glob('*.gschema.xml'):
        shutil.copy2(schema, stage / 'schemas' / schema.name)
    subprocess.run(['glib-compile-schemas', '--strict', str(stage / 'schemas')], check=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(stage.rglob('*')):
            if path.is_file():
                archive.write(path, path.relative_to(stage))
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert 'schemas/gschemas.compiled' in archive.namelist()
    assert 'extension.js' in archive.namelist()
print(output)
