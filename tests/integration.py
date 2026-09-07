#!/usr/bin/env python3
"""Exercise the real GJS/Soup client against a loopback-only ntfy fixture."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
from urllib.parse import parse_qs, urlsplit

root = Path(__file__).resolve().parent.parent
gjs = os.environ.get('GJS') or shutil.which('gjs')
if not gjs:
    raise SystemExit('GJS is required. Install gjs and Soup 3, or set GJS to a local executable.')
requests = []


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_args):
        pass

    def do_GET(self):
        route = urlsplit(self.path)
        requests.append(self.path)
        if route.path == '/denied/json':
            self.send_response(403)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if route.path == '/redirect/json':
            self.send_response(302)
            self.send_header('Location', '/redirect-target')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if route.path != '/alerts/json':
            self.send_error(404)
            return
        assert 'since' in parse_qs(route.query)
        attempt = sum(urlsplit(path).path == '/alerts/json' for path in requests)
        now = int(time.time())

        def event(identity):
            return json.dumps(dict(id=identity, time=now, event='message', topic='alerts',
                                   message='שלום 🌍 café'), ensure_ascii=False) + '\n'

        body = ('{"event":"open"}\nnot json\n' + event('one') + event('one') +
                (event('two') if attempt > 1 else '')).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/x-ndjson')
        if attempt == 1:
            self.send_header('Content-Length', str(len(body)))
        else:
            self.send_header('Connection', 'close')
            self.close_connection = True
        self.end_headers()
        try:
            for byte in body:
                self.wfile.write(bytes([byte]))
                self.wfile.flush()
            if attempt > 1:
                time.sleep(1)
                self.wfile.write(event('late').encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    subprocess.run([gjs, '-m', str(root / 'tests/integration.js'),
                    f'http://127.0.0.1:{server.server_port}'], cwd=root, check=True, timeout=20)
    assert not any(urlsplit(path).path == '/redirect-target' for path in requests)
    assert sum(urlsplit(path).path == '/alerts/json' for path in requests) == 2
    print('Real GJS/Soup integration passed: UTF-8, replay, deduplication, HTTP errors, redirect refusal, cancellation.')
finally:
    server.shutdown()
    server.server_close()
