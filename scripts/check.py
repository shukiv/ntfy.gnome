#!/usr/bin/env python3
"""Dependency-free static checks, followed by the behavioral test suite."""
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent
metadata = json.loads((root / 'metadata.json').read_text())
schema = ET.parse(root / 'schemas/org.gnome.shell.extensions.ntfy.gschema.xml').getroot()[0]
assert metadata['settings-schema'] == schema.attrib['id']
assert re.fullmatch(r'[A-Za-z0-9._-]+@[A-Za-z0-9._-]+', metadata['uuid'])
assert metadata['uuid'].split('@')[1] != 'gnome.org'
assert metadata['shell-version'] and all(re.fullmatch(r'\d+', v) for v in metadata['shell-version'])
assert 'version' not in metadata, 'extensions.gnome.org assigns the submission version'
assert re.fullmatch(r'(?=.*[A-Za-z0-9])[A-Za-z0-9 .]{1,16}', metadata['version-name'])
assert metadata['version-name'] == json.loads((root / 'package.json').read_text())['version']
assert metadata['url'].startswith('https://')
assert (root / 'LICENSE').is_file() and (root / 'COPYING').is_file()

# Check the complete import graphs, including helpers shared by Shell and GTK.
# Also reject orphaned runtime modules that should not be in the submission ZIP.
def imports(entry, forbidden):
    visited = set()
    pending = [entry]
    while pending:
        path = pending.pop()
        if path in visited:
            continue
        visited.add(path)
        for specifier in re.findall(r'^import\s+.*?from\s+[\'"]([^\'"]+)[\'"]', path.read_text(), re.M):
            assert specifier.split('?')[0] not in forbidden, f'{path.name}: forbidden import {specifier}'
            if specifier.startswith('.'):
                dependency = (path.parent / specifier).resolve()
                assert dependency.is_relative_to(root) and dependency.is_file(), specifier
                pending.append(dependency)
    return visited

shell = imports(root / 'extension.js', {'gi://Gtk', 'gi://Gdk', 'gi://Adw'})
preferences = imports(root / 'prefs.js', {'gi://Clutter', 'gi://Meta', 'gi://St', 'gi://Shell'})
runtime = set((root / 'lib').rglob('*.js')) | {root / 'extension.js', root / 'prefs.js'}
assert runtime == shell | preferences, 'Remove unreachable runtime JavaScript modules'
for directory in [root, root / 'lib', root / 'tests']:
    for path in sorted(directory.glob('*.js')):
        subprocess.run(['node', '--check', str(path)], check=True)
subprocess.run(['glib-compile-schemas', '--strict', '--dry-run', str(root / 'schemas')], check=True)
subprocess.run(['npm', 'test'], cwd=root, check=True)
print('JavaScript syntax, metadata, GSettings schema, and behavioral tests passed.')
