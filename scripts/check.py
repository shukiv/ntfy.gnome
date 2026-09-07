#!/usr/bin/env python3
"""Dependency-free static checks, followed by the behavioral test suite."""
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent
metadata = json.loads((root / 'metadata.json').read_text())
schema = ET.parse(root / 'schemas/org.gnome.shell.extensions.ntfy.gschema.xml').getroot()[0]
assert metadata['settings-schema'] == schema.attrib['id']
assert metadata['uuid'] and metadata['shell-version']
for directory in [root, root / 'lib', root / 'tests']:
    for path in sorted(directory.glob('*.js')):
        subprocess.run(['node', '--check', str(path)], check=True)
subprocess.run(['glib-compile-schemas', '--strict', '--dry-run', str(root / 'schemas')], check=True)
subprocess.run(['npm', 'test'], cwd=root, check=True)
print('JavaScript syntax, metadata, GSettings schema, and behavioral tests passed.')
