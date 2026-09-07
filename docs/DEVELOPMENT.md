# Development

[Documentation home](../README.md#documentation) · [Blueprint](BLUEPRINT.md) · [Testing](TESTING.md)

## Project layout

The extension uses JavaScript ES modules without a transpiler or runtime npm
dependencies. GNOME loads `extension.js` in Shell and `prefs.js` in a separate
GTK process; GSettings is the communication boundary.

| File | Responsibility |
| --- | --- |
| `extension.js` | Panel, notifications, recent messages, clients and lifecycle cleanup |
| `prefs.js` | Subscription controls and desktop notification settings |
| `lib/config.js` | Validate subscriptions, canonicalize origins, validate browser links |
| `lib/protocol.js` | Frame JSON lines, normalize messages, bound input and deduplicate IDs |
| `lib/client.js` | Connection lifecycle, replay checkpoint and retry scheduling |
| `lib/transport.js` | Real Soup 3/Gio streaming requests and GLib timers |
| `lib/auth.js` | Token validation and cancellation across keyring lookup and network start |
| `lib/secrets.js` | Asynchronous Secret Service storage and lookup |
| `lib/tokenSettings.js` | Coordinate keyring mutations with settings references |
| `lib/tokenPreferences.js` | Native token editor and unlock/remove controls |
| `lib/credentialMessages.js` | Panel text for credential failures |
| `schemas/` | GSettings schema |
| `stylesheet.css` | Native menu text sizing and emphasis |
| `tests/` | Node behavior tests and native runtime harnesses |
| `scripts/` | Static checks and archive builder |

See the [blueprint](BLUEPRINT.md#architecture) for the data flow and design
decisions. Keep protocol and lifecycle policy independent of GNOME wherever
possible; exercise platform code with native harnesses and real desktop checks.

## Run checks

Run from the repository root. Node.js 20+, Python 3, and GLib schema tools are
enough for the standard checks and build; `npm install` is unnecessary.

```sh
npm run check
npm run pack
```

`check` checks JavaScript syntax, metadata/schema agreement, strict schema
validation, and all Node tests. `pack` stages runtime files, compiles the
schema, writes `dist/ntfy@ntfy.gnome.shell-extension.zip`, and checks ZIP integrity.
Documentation and development files are excluded from the archive.

For focused or native runtime checks:

```sh
npm test
node --test tests/history.test.js
npm run test:integration
npm run test:preferences
npm run test:keyring
```

| Suite | Environment and coverage |
| --- | --- |
| Node | Configuration, protocol, authentication, client lifecycle and history menu composition |
| Integration | GJS and Soup 3 against a temporary loopback HTTP fixture, including authenticated requests |
| Preferences | Real GTK 4/libadwaita, GSettings and keyring controls; only the Shell preferences host is replaced |
| Keyring | Real libsecret and a disposable GNOME Keyring, including locked and missing items |

The three native suites use `tests/with_keyring.py` to start a private D-Bus
session and temporary keyring. They require `dbus-run-session`, `gdbus`,
`gnome-keyring-daemon`, GJS, Soup 3, and libsecret bindings. Preferences additionally
requires GTK 4, libadwaita, `glib-compile-resources`, and a display. Run it headlessly
with `xvfb-run -a npm run test:preferences`. Set `GJS=/path/to/gjs` when using a
non-system GJS executable.

Tests use synthetic credentials and local fixtures. They do not use the desktop
user's existing keyring or publish to public ntfy topics.

The history regression harness executes the real extension class with a small
menu/clock host double. It verifies that expanding Recent messages exposes the
body, preserves ordering and actions, and clears entries. It does not render St
actors or verify scrolling, keyboard behavior, themes, or text allocation.
Those checks remain in the [desktop acceptance list](TESTING.md#desktop-acceptance--pending).

## Test in a nested GNOME session

On a computer with GNOME installed, build and install the ZIP as described in
[Installation](INSTALLATION.md). For development on Wayland, a separate Shell
window avoids replacing the active desktop session.

For GNOME 49 and later:

```sh
dbus-run-session gnome-shell --devkit --wayland
```

For GNOME 48 and earlier:

```sh
dbus-run-session gnome-shell --nested --wayland
```

The newer command may require your distribution's Mutter devkit package.
Inside the nested session, open a terminal and enable `ntfy@ntfy.gnome`.
Start a fresh nested session after rebuilding/reinstalling changed JavaScript.
See the [GNOME development guide](https://gjs.guide/extensions/development/creating.html#wayland-sessions)
for platform details. A nested session can share your user's saved settings;
use a separate test account when configuration isolation matters.

For a normal X11 session, use **Alt+F2 → restart** after installing code changes.
For normal Wayland session updates, use the [refresh instructions](INSTALLATION.md#refresh-gnome-shell).

Monitor Shell logs while checking the panel and notifications:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

## Settings reference

Schema: `org.gnome.shell.extensions.ntfy`  
Path: `/org/gnome/shell/extensions/ntfy/`

| Key | GVariant type | Default | Meaning |
| --- | --- | --- | --- |
| `subscriptions` | `s` | `'[]'` | JSON array of validated subscription records |
| `notifications-enabled` | `b` | `true` | Whether incoming messages create desktop notifications |
| `server-credentials` | `a{ss}` | `{}` | Canonical server origin → opaque keyring item ID |
| `credential-retry` | `(ss)` | `('', '')` | Server origin and unique request ID for explicit credential retries |

A subscription value contains records such as:

```json
[
  {
    "id": "example-subscription-1",
    "server": "https://notify.example.org",
    "topic": "backups",
    "enabled": true
  }
]
```

IDs must be unique, and each server/topic pair must be unique. `enabled` must be
a boolean. Normalization and limits are defined in `lib/config.js`.

Inspect the installed subscription value without modifying it:

```sh
gsettings --schemadir "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/ntfy@ntfy.gnome/schemas" \
  get org.gnome.shell.extensions.ntfy subscriptions
```

Prefer Preferences for normal changes. Back up the existing value before manual
repair. There is no settings key for message history or an access token's value.
Tokens use Secret Service schema `org.gnome.shell.extensions.ntfy.Token`, with
`server` and `credential` attributes. Copying settings to another computer does
not copy the corresponding secrets; save the tokens through Preferences there.

## Contribution and release checks

Match existing ES module style and use native GNOME controls. Cancel owned
requests and timers, disconnect settings signals, and destroy actors on disable.
Keep message text plain and never log tokens or place them in request URLs.

Run checks and packaging for code changes, then the relevant native suites for
transport, preferences, or keyring changes. Use the desktop acceptance matrix
for Shell behavior. Update the user guide when controls or behavior change,
and distinguish implemented features from planned work in the blueprint.

Metadata's Shell versions are provisional targets. A tested desktop matrix,
license, final extension identity, translations, and extension review remain
part of release preparation; a passing headless test is not a release claim.
