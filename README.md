# ntfy for GNOME

A GNOME Shell extension that receives [ntfy](https://ntfy.sh) messages and
shows native desktop notifications, with a panel menu for subscriptions and
recent messages. Works with ntfy.sh and self-hosted servers.

Version **0.3.1** adds the ntfy panel logo and a message-count badge.
Download the [GitHub test build](https://github.com/shukiv/ntfy.gnome/releases/tag/v0.3.1-rc.1)
or build from source below.

Version **0.3.1** was [submitted to GNOME Extensions](https://extensions.gnome.org/extension/10898/ntfy-for-gnome/)
on 2026-09-08 and is awaiting review. It replaces the 0.3.0 submission, which the
site now lists as rejected after the newer upload. The extension targets **GNOME 46–50**;
the full desktop compatibility matrix remains unverified. Approval has not been confirmed.

## Documentation

| Guide | Contents |
| --- | --- |
| [Installation](docs/INSTALLATION.md) | Requirements, first install, GNOME refresh, updates, removal |
| [User guide](docs/USER_GUIDE.md) | Subscriptions, Jabali example, access tokens, messages, notifications |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Extension discovery, connection errors, keyring problems, missing messages |
| [Development](docs/DEVELOPMENT.md) | Project layout, settings, tests, packaging, nested GNOME sessions |
| [Blueprint](docs/BLUEPRINT.md) | Architecture, protocol decisions, scope, planned work |
| [Testing](docs/TESTING.md) | Automated coverage and desktop acceptance checks |
| [Publishing](docs/RELEASING.md) | extensions.gnome.org submission candidate and remaining steps |

## Included

- Multiple public and private topics on ntfy.sh and self-hosted servers.
- Access tokens stored in the desktop keyring, shared by server.
- Native preferences to add, remove, undo removal, or disable subscriptions.
- Panel menu with connection status, reconnect, and the last 20 messages,
  with message bodies directly visible in Recent messages.
- ntfy panel logo with a badge counting retained messages; clearing history hides it.
- Desktop notifications and a mute switch that keeps receiving messages.
- Reconnection with backoff, in-memory replay checkpoints, and deduplication.

Persistent history, attachments, publishing, and message update/delete events
are planned separately. History and replay
checkpoints reset when the extension is disabled, including screen locking.
Messages sent while disabled aren't recovered on the next enable, apart from
the one second of overlap used when starting a subscription.

## Build and install

On the GNOME desktop, runtime requirements are GJS, Soup 3, GTK 4, and
libadwaita, and libsecret with a Secret Service provider such as GNOME Keyring,
normally supplied by the desktop distribution. Building requires
Python 3 and `glib-compile-schemas`. Node.js 20+ is used only for development checks.
No npm packages are required.

Clone the public repository on the GNOME desktop and build the extension.
No GitHub authentication is required:

```sh
git clone https://github.com/shukiv/ntfy.gnome.git
cd ntfy.gnome
python3 scripts/pack.py
gnome-extensions install --force dist/ntfy@shukiv.github.io.shell-extension.zip
```

**Required order: install → refresh GNOME → enable.** A successful ZIP install
does not mean the running Shell has discovered the extension. Running `enable`
before refreshing can report **Extension “ntfy@shukiv.github.io” does not exist**.

Check your session type in a terminal on the GNOME desktop:

```sh
echo "$XDG_SESSION_TYPE"
```

- **`x11`:** press **Alt+F2**, type **`restart`**, and press Enter.
- **`wayland`:** save your work, log out of GNOME, and log back in.

**After that refresh**, enable the extension, check its status, and open preferences:

```sh
gnome-extensions enable ntfy@shukiv.github.io
gnome-extensions info ntfy@shukiv.github.io
gnome-extensions prefs ntfy@shukiv.github.io
```

If you installed the earlier `ntfy@ntfy.gnome` prototype, first follow the
[one-time migration](docs/INSTALLATION.md#migrate-from-the-prototype).

To install updates from this repository:

```sh
cd ntfy.gnome
git pull --ff-only
python3 scripts/pack.py
gnome-extensions install --force dist/ntfy@shukiv.github.io.shell-extension.zip
```

**Refresh GNOME again after every update:** **Alt+F2 → `restart`** on X11;
save your work, log out and back in on Wayland. Then run:

```sh
gnome-extensions enable ntfy@shukiv.github.io
gnome-extensions info ntfy@shukiv.github.io
```

Toggling the extension off and on does not reload the updated JavaScript.
Run these commands as your desktop user, without `sudo`. Subscriptions and
access tokens are retained; recent history resets. See the
[refresh guide](docs/INSTALLATION.md#refresh-gnome-shell) for details.

## Access tokens

Open **Preferences → Access tokens**, or click the key button beside an existing
subscription. Enter the server origin (for example, `https://notify.example.org`)
and paste the raw access token, such as `tk_…`, then select **Save token**.
Do not include `Bearer`, a topic path, or a documentation URL.

The saved token applies to all subscriptions on that exact server origin.
Saving or replacing it reconnects those subscriptions automatically, preserving
their in-memory replay checkpoints. The password field clears after submission
and never displays a previously saved token.

**Saved tokens** provides **Replace**, **Unlock**, and **Remove token** controls.
Removing a token deletes its keyring entry and switches that server to anonymous
access; it does not revoke the token on the ntfy server. If the keyring is locked,
choose **Unlock** to unlock it and retry affected subscriptions. Missing or
unavailable credentials stop the connection until repaired; they do not cause an
anonymous retry. HTTP 401/403 means the token or topic permissions need attention.

Tokens require HTTPS, except on localhost/loopback for development. They are sent
only in the Authorization header, never in URLs or GSettings. Redirects are not
followed. GSettings stores only a server origin and an opaque keyring item ID.
Create or revoke tokens in your ntfy server's account settings; see the
[ntfy access-token documentation](https://docs.ntfy.sh/publish/#access-tokens).

## First subscription and test message

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
npm run test:keyring      # Real Secret Service storage, cancellation and locking
npm run pack              # Creates an installable ZIP in dist/
```

Set `GJS=/path/to/gjs` to use a non-system runtime for the integration test.
For headless preferences testing, use `xvfb-run -a npm run test:preferences`.
The integration, preferences, and keyring scripts start a private D-Bus session
and a disposable GNOME Keyring, requiring `gnome-keyring-daemon` and `gdbus`.
They never use the user's existing keyring. The preferences harness replaces
only the Shell preferences host; GTK, libadwaita, GSettings, and libsecret are real.
Packaging includes only runtime modules, metadata, stylesheet, schema XML,
the panel SVG, and license notices. GNOME compiles the schema during installation.

Shell caches imported JavaScript. Use **Alt+F2 → restart** on X11, log out and
back in on Wayland, or start a fresh nested Shell to load changed code. See
[nested-session commands](docs/DEVELOPMENT.md#test-in-a-nested-gnome-session).
Monitor runtime errors with:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

Desktop validation is tracked in [docs/TESTING.md](docs/TESTING.md).
If externally edited subscription settings are malformed, the extension stops
its connections and preserves the saved value. Back up that value before
repairing it with `gsettings` using the installed schema directory.

The submission candidate uses UUID `ntfy@shukiv.github.io`. The project is
licensed under GNU GPL version 3 (`GPL-3.0-only`); see [LICENSE](LICENSE) and
[COPYING](COPYING). The [ntfy artwork](https://dashboardicons.com/icons/ntfy) retains
its Apache-2.0 license; see [attribution](icons/NOTICE). The listing's icon is
uploaded separately; see [listing icon instructions](docs/RELEASING.md#listing-icon).
Desktop validation and the public listing are tracked in
the [publishing guide](docs/RELEASING.md).
