# Troubleshooting

[Documentation home](../README.md#documentation) · [Installation](INSTALLATION.md) · [User guide](USER_GUIDE.md)

## Extension does not exist

A successful ZIP install writes files, but the running Shell may not have
discovered them yet. This can produce:

```text
Extension “ntfy@shukiv.github.io” does not exist
```

The required order is **install → refresh GNOME → enable**. First check the
installed file and session type as your desktop user:

```sh
ls "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/ntfy@shukiv.github.io/metadata.json"
gnome-shell --version
echo "$XDG_SESSION_TYPE"
```

If the metadata file exists, refresh GNOME using the session type printed above:

- **`x11`:** press **Alt+F2**, type **`restart`**, and press Enter.
- **`wayland`:** save your work, log out of GNOME, and log back in.

**After the refresh**, open a terminal and run:

```sh
gnome-extensions enable ntfy@shukiv.github.io
gnome-extensions info ntfy@shukiv.github.io
```

Refreshing the browser or toggling the extension is not a Shell refresh.
See the [refresh guide](INSTALLATION.md#refresh-gnome-shell) for details.

If the file is missing, reinstall the ZIP as the logged-in desktop user.
Check that you used `dist/ntfy@shukiv.github.io.shell-extension.zip` from the build
output. Do not install with `sudo` or from an SSH session logged in as root.

## Website still shows the puzzle icon

The icon on extensions.gnome.org is uploaded separately from the installed
extension. A Shell refresh loads the new panel logo; it does not upload the
website image. Sign in to [your extension page](https://extensions.gnome.org/extension/10898/ntfy-for-gnome/),
click the puzzle icon beside its name, and upload `assets/ntfy.png` from the
checkout. Use the extension's own page, rather than **Installed extensions**.
See the [listing icon instructions](RELEASING.md#listing-icon).

## Old menu or missing Access tokens page after an update

Confirm the checkout is current with `git log -1 --oneline`, rebuild and
reinstall the ZIP, then refresh Shell. GNOME caches imported JavaScript; toggling
the extension alone does not load the updated modules. Close and reopen an
already open Preferences window.

An old version of the menu shows a second arrow beside a message such as
`jabali-backups: jabali-backups`. Expand that arrow to read it in the old version.
The updated menu displays the message body directly under **Recent messages**.

## No panel icon or an extension error

Run `gnome-extensions info ntfy@shukiv.github.io`. Check that it is enabled and that
the GNOME **Extensions** app allows user extensions. Metadata currently targets
GNOME 46–50; compatibility testing is still in progress.

For an error state, collect the Shell log while reproducing it:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

Missing Soup, libsecret, GTK, or Adwaita namespaces indicate a missing library or
GObject introspection package. Install your distribution's matching dependency;
see [requirements](INSTALLATION.md#requirements). GTK/Adwaita are needed by
Preferences, even when the panel itself loads.

## Connection and token errors

| Panel state or symptom | What to check |
| --- | --- |
| **HTTP 401** / **HTTP 403** | Save a valid token for this exact server and ensure its account can read the topic. It may be expired, revoked, or lack permission. |
| **Keyring locked** | Use **Access tokens → Unlock** and complete the desktop prompt. The server retries after unlocking. |
| **Token missing** | Save the token again. The settings reference exists, but its keyring item is missing. |
| **Keyring unavailable** | Confirm a Secret Service provider such as GNOME Keyring is running in your desktop session; then **Reconnect**. |
| **Invalid token** | Replace it with the raw token, without a Bearer prefix or whitespace. |
| **Access tokens require HTTPS** | Change to the server's HTTPS origin. HTTP is supported for tokens only on localhost/loopback. |
| **HTTP 301/302/307/308** | Enter the final server origin. Redirects are deliberately not followed. |
| Other HTTP errors | Check server availability and the topic, then **Reconnect** after repairing the problem. |
| Repeated **Reconnecting** | Check DNS, network connectivity, TLS certificate validity, and whether the server permits streaming subscriptions. |
| **Reconnecting** with *No data received* | The stream stayed silent for 75 seconds. ntfy sends a keepalive every 45 seconds, so the connection was dropped by a proxy, NAT, or the network without an error. Reconnection is automatic. |

Transient stream/network failures retry automatically with increasing delays.
Most HTTP 3xx/4xx failures stop until a manual retry or a configuration change;
408, 425, and 429 remain retryable. A server's Retry-After value can extend the
wait up to five minutes. Saving/replacing a token reconnects its server's topics.

## Connected, but no messages or banners

1. Verify the publisher and subscription use the same server and exact topic,
   including letter case. **Connected** confirms a stream, not that anything
   has been published to it.
2. Publish a new test message after the connection is established. Initial
   subscriptions do not fetch the server's full history.
3. Expand **Recent messages**. If it was already open, collapse and reopen it.
4. If the message is in history but there is no banner, enable **Desktop
   notifications** and check GNOME's Do Not Disturb and notification settings.
   Low-priority messages intentionally do not display a banner.

Before 0.3.2, a subscription could stay **Connected** for hours or days while
receiving nothing. Both topics shared one HTTP/2 connection through the
server's proxy; when the proxy dropped it, libsoup never reported an error and
the stream waited forever. Version 0.3.2 opens one HTTP/1.1 connection per
topic and abandons any stream that is silent for 75 seconds, reporting
*No data received* while it reconnects. Messages published during such a stall
are replayed after the reconnect only if the server's message cache still holds
them. Update to 0.3.2 or later if a Shell restart makes messages appear again.

Screen locking, disabling the extension, logout, and Shell restart clear local
history. Messages sent while the extension is disabled are not recovered at the
next enable except for the one-second startup overlap. Also, only the last 20
received messages are retained; a busy topic can displace other topics' messages.

If **Open topic** asks you to sign in, authenticate in your browser. The browser
does not receive the extension's token.

## Saved settings need attention

Invalid manually edited settings stop subscription connections and disable
changes in Preferences, so the extension does not silently discard your data.
The [settings reference](DEVELOPMENT.md#settings-reference) describes the format
and a read-only inspection command. Save a copy before repairing the value.
Resetting subscriptions deletes the saved subscription list and should not be
the first troubleshooting step.

## Report a problem

Include your distribution, `gnome-shell --version`, session type, repository
commit (`git log -1 --oneline`), steps to reproduce, the panel's exact status,
and relevant Shell log lines. Mention whether messages reach Recent messages,
GNOME's notification list, both, or neither. For layout problems, include your
display scaling and a screenshot with private content redacted.

Do not include access tokens or private message contents in a bug report.
