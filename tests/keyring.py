#!/usr/bin/env python3
import os
from pathlib import Path
import shutil
import subprocess

gjs = os.environ.get('GJS') or shutil.which('gjs')
if not gjs:
    raise SystemExit('GJS is required. Set GJS to use a non-system executable.')
subprocess.run([gjs, '-m', str(Path(__file__).with_suffix('.js'))], check=True, timeout=20)
