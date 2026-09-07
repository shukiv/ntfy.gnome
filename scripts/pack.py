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
    for filename in ['metadata.json', 'extension.js', 'prefs.js', 'stylesheet.css', 'LICENSE', 'COPYING']:
        shutil.copy2(root / filename, stage / filename)
    for path in sorted((root / 'lib').rglob('*.js')):
        target = stage / path.relative_to(root)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    (stage / 'schemas').mkdir()
    for schema in (root / 'schemas').glob('*.gschema.xml'):
        shutil.copy2(schema, stage / 'schemas' / schema.name)
    # GNOME 44+ compiles schemas during installation. Validate the XML, but do
    # not ship the generated binary in an extensions.gnome.org submission.
    subprocess.run(['glib-compile-schemas', '--strict', '--dry-run', str(stage / 'schemas')], check=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(stage.rglob('*')):
            if path.is_file():
                archive.write(path, path.relative_to(stage))
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert 'schemas/gschemas.compiled' not in archive.namelist()
    assert f"schemas/{metadata['settings-schema']}.gschema.xml" in archive.namelist()
    assert 'extension.js' in archive.namelist()
    assert 'LICENSE' in archive.namelist() and 'COPYING' in archive.namelist()
print(output)
