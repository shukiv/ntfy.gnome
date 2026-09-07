# ntfy for GNOME

A GNOME Shell extension that receives [ntfy](https://ntfy.sh) messages and
shows native desktop notifications. The directory started empty; the
[blueprint](docs/BLUEPRINT.md) records the design, scope, and next slices.

This is an initial implementation for **GNOME 46–50**, pending testing in a
real GNOME Shell session. It is not yet a published or release-tested extension.

## Included

- Multiple public topics on ntfy.sh and self-hosted HTTP(S) server origins.
- Native preferences to add, remove, undo removal, or disable subscriptions.
- Panel menu with connection status, reconnect, and the last 20 messages.
- Desktop notifications and a mute switch that keeps receiving messages.
- Reconnection with backoff, in-memory replay checkpoints, and deduplication.

Private-topic authentication, persistent history, attachments, publishing,
and message update/delete events are planned separately. History and replay
checkpoints reset when the extension is disabled, including screen locking.
Messages sent while disabled aren't recovered on the next enable, apart from
the one second of overlap used when starting a subscription.

## Build and install

On the GNOME desktop, runtime requirements are GJS, Soup 3, GTK 4, and
libadwaita, normally supplied by the desktop distribution. Building requires
Python 3 and `glib-compile-schemas`. Node.js 20+ is used only for development checks.
No npm packages are required.

Clone the repository on the GNOME desktop and build the extension. GitHub
authentication is required if the repository is private:

```sh
git clone https://github.com/shukiv/ntfy.gnome.git
cd ntfy.gnome
python3 scripts/pack.py
gnome-extensions install --force dist/ntfy@ntfy.gnome.shell-extension.zip
```

**Log out of GNOME and back in after the first installation**, so Shell discovers
the extension. Running `enable` before that can report that the extension
“does not exist,” even though the ZIP was installed successfully. Then:

```sh
gnome-extensions enable ntfy@ntfy.gnome
gnome-extensions prefs ntfy@ntfy.gnome
```

To install updates from this repository:

```sh
cd ntfy.gnome
git pull --ff-only
python3 scripts/pack.py
gnome-extensions install --force dist/ntfy@ntfy.gnome.shell-extension.zip
```

Log out and back in again to load the updated JavaScript. Run these commands
as your desktop user, without `sudo`.

In preferences, enter `https://ntfy.sh` and a hard-to-guess topic name. Public
topics can be read and written by anyone who knows the name. For your own
server, use an origin such as `https://notify.example.org` or
`http://localhost:8080`; URL paths and embedded credentials aren't supported.

Once the panel reports **Connected**, publish from a terminal, replacing the
topic below with the one you added:

```sh
curl -H 'Title: Hello from ntfy' -d 'Your GNOME subscription works.' \
  https://ntfy.sh/YOUR_UNIQUE_TOPIC
```

Normal messages respect GNOME's Do Not Disturb setting. Low priority messages
go to the notification list without a banner. No publishing or public-server
test requests are made by the development test suite.

## Development

```sh
npm test                  # Protocol, configuration, reconnect and teardown
npm run check             # Also syntax, metadata and strict schema validation
npm run test:integration  # Real GJS/Soup against a temporary loopback server
npm run test:preferences  # Native GTK controls; requires a display or Xvfb
npm run pack              # Creates an installable ZIP in dist/
```

Set `GJS=/path/to/gjs` to use a non-system runtime for the integration test.
For headless preferences testing, use
`dbus-run-session -- xvfb-run -a npm run test:preferences`. That harness replaces
only the Shell preferences host; it uses real GTK, libadwaita, and GSettings.
Packaging includes only the runtime modules, metadata, stylesheet, and schemas.

Shell caches imported JavaScript. Use a fresh nested Shell session or log out
and in to load changed code. See the [GNOME development guide](https://gjs.guide/extensions/development/creating.html)
for version-specific nested-session commands. Monitor runtime errors with:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

Desktop validation is tracked in [docs/TESTING.md](docs/TESTING.md).
If externally edited subscription settings are malformed, the extension stops
its connections and preserves the saved value. Back up that value before
repairing it with `gsettings` using the installed schema directory.

The extension UUID is provisional. A license and tested compatibility matrix
should be settled before publishing a release.
