#!/usr/bin/env python3
"""Run tests with a disposable keyring on a private D-Bus session."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

if sys.argv[1:2] != ['--session']:
    with tempfile.TemporaryDirectory(prefix='ntfy-keyring-test-') as temporary:
        stage = Path(temporary)
        for name in ['data', 'runtime', 'control']:
            (stage / name).mkdir(mode=0o700)
        # No service activation directories: GTK must not start desktop
        # portals or FUSE mounts inside this disposable runtime directory.
        (stage / 'bus.conf').write_text('''<busconfig>
<type>session</type><listen>unix:tmpdir=/tmp</listen>
<policy context="default">
<allow send_destination="*"/><allow receive_sender="*"/><allow own="*"/>
</policy></busconfig>''')
        environment = {**os.environ, 'XDG_DATA_HOME': str(stage / 'data'),
                       'XDG_RUNTIME_DIR': str(stage / 'runtime'),
                       'GNOME_KEYRING_CONTROL': str(stage / 'control'),
                       'NTFY_KEYRING_TEST': '1'}
        result = subprocess.run(['dbus-run-session', '--config-file=' + str(stage / 'bus.conf'), '--', sys.executable, __file__,
                                 '--session', *sys.argv[1:]], env=environment)
        sys.exit(result.returncode)

daemon = subprocess.Popen(['gnome-keyring-daemon', '--foreground', '--unlock',
                           '--components=secrets', '--control-directory=' + os.environ['GNOME_KEYRING_CONTROL']],
                          stdin=subprocess.PIPE, stdout=subprocess.DEVNULL)
try:
    daemon.stdin.write(b'ntfy-disposable-test-keyring')
    daemon.stdin.close()
    for _ in range(50):
        probe = subprocess.run(['gdbus', 'call', '--session', '--dest', 'org.freedesktop.DBus',
                                '--object-path', '/org/freedesktop/DBus',
                                '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.freedesktop.secrets'],
                               capture_output=True, text=True)
        if 'true' in probe.stdout:
            break
        if daemon.poll() is not None:
            raise RuntimeError('Test keyring exited before it was ready')
        time.sleep(0.05)
    else:
        raise RuntimeError('Test keyring did not start')
    sys.exit(subprocess.run(sys.argv[2:], env=os.environ, timeout=45).returncode)
finally:
    daemon.terminate()
    try:
        daemon.wait(timeout=5)
    except subprocess.TimeoutExpired:
        daemon.kill()
        daemon.wait()
