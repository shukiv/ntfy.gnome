# User guide

[Documentation home](../README.md#documentation) · [Installation](INSTALLATION.md) · [Troubleshooting](TROUBLESHOOTING.md)

## Add a subscription

1. Open the ntfy icon in the top bar and choose **Preferences…**.
2. On the **ntfy** page, find **Add a subscription**.
3. Enter the **Server URL**, for example `https://ntfy.sh`.
4. Enter the **Topic**, for example your own unique alert topic.
5. Click **Subscribe**. The panel's subscription row should become **Connected**.

The server field takes an origin: scheme, hostname, and optional port. Enter
the topic separately. These are examples of accepted server values:

| Server URL | Use |
| --- | --- |
| `https://ntfy.sh` | Hosted ntfy |
| `https://ntfy.jabali-panel.com` | Jabali ntfy server |
| `https://notify.example.org:8443` | Self-hosted server on a custom port |
| `http://localhost:8080` | Local development server |

Do not include `/docs/`, a topic path, URL query parameters, or a username and
password in the server field. Topics are case-sensitive and accept 1–64 ASCII
letters, digits, underscores, or hyphens. Up to 20 subscriptions can be saved.
You can use the same topic name on different servers, but cannot add the same
server/topic pair twice.

Public topics can be accessed by people who know their names. Use an
unguessable name for public tests, or configure server permissions and an
access token for private subscriptions.

Changes take effect immediately. Use the switch beside a subscription to stop
or resume that topic. The trash button removes it; the **Undo** toast restores
it. To change a server or topic, remove that subscription and add its replacement.
Removing a subscription retains its server's shared token.

## Connect to the Jabali server

For the subscriptions shown in the panel:

1. Open **Preferences → Access tokens**.
2. Set **Server URL** to `https://ntfy.jabali-panel.com`.
3. Paste your raw access token into **Access token** and click **Save token**.
4. Return to the **ntfy** page and subscribe to `jabali-backups` using that server.
5. Add `jabali-support` using the same server. Both subscriptions share the token.
6. Open the panel and check that each subscription reports **Connected**.

The token's account must have read permission for those topics. A saved token
does not grant new permissions. If both subscriptions already exist, just save
the token; their connections restart automatically.

The documentation URL `https://ntfy.jabali-panel.com/docs/publish/#access-tokens`
is a help page, not a Server URL. ntfy supports access tokens for both publishing
and subscribing; see the [ntfy access-token documentation](https://docs.ntfy.sh/publish/#access-tokens).

## Manage access tokens

Open **Preferences → Access tokens**, or use the key button beside an existing
subscription to select its server automatically.

Paste only the token value, usually beginning with `tk_`. Do not include the
word `Bearer`, quotes, spaces, or line breaks. The field is masked and clears
after submission. It does not load a saved token back into the editor.

| Control | Effect |
| --- | --- |
| **Save token** | Save or replace the token for this server and reconnect its subscriptions |
| Pencil button (**Replace token**) | Select a saved server so you can paste a replacement |
| **Unlock** | Ask the desktop keyring to unlock if needed, then retry this server |
| Trash button (**Remove token**) | Delete the local keyring item and return this server to anonymous access |

One token applies to all subscriptions on the exact server origin. Scheme and
non-default port matter; `https://notify.example.org:8443` is a different server
from `https://notify.example.org`. Separate tokens for different topics on the
same server are not supported.

Tokens live in the desktop keyring. The extension's settings contain only the
server and a keyring reference. Requests send tokens in the Authorization
header over HTTPS; HTTP tokens are accepted only for localhost/loopback testing.
Redirects are refused. A missing or locked saved token stops that connection
until repaired, without silently falling back to anonymous access.

Create tokens in the server's web account or ask its administrator. Replacing
or removing a local token does not revoke it on the server. ntfy describes
[token creation and use](https://docs.ntfy.sh/publish/#access-tokens) in its manual.

## Read recent messages

Open the panel's **Recent messages (N)** row. Each message shows its topic,
optional title, message text, and local date/time directly in that list.
There is no second message submenu. Text wraps, including multiline messages;
scroll within the expanded history when the list is longer than the screen.
The latest received message appears first.

**Open link** appears when the publisher supplied an accepted HTTP(S) click
link. **Open topic** opens the topic's web page. Neither action opens a browser
until you select it. Your browser may need its own ntfy login; the extension
does not pass its keyring token to the browser.

The count is the number of retained messages, not an unread badge. Reading a
message does not change it. The extension keeps at most 20 messages across all
subscriptions. **Clear recent messages** empties that local list without deleting
messages from the ntfy server or clearing GNOME's notification list.

The list takes a fresh snapshot each time you expand **Recent messages**. If a
message arrives while you are reading, the count updates; collapse and reopen
the row to refresh its contents without changing focus during an incoming burst.

History clears when the extension is disabled, including during screen locking,
logout, or Shell restart. A fresh enable starts receiving current messages with
one second of overlap, rather than fetching the entire server cache. While the
extension stays enabled, reconnecting can recover missed messages still retained
by the server. History is not a persistent inbox.

## Notifications and connection controls

| Control or status | Meaning |
| --- | --- |
| **Desktop notifications** | Turn desktop notification delivery on or off; reception and recent history continue |
| Subscription arrow | Show server, connection details, and **Open topic** |
| **Connected** | The subscription stream is open |
| **Reconnecting (Ns)** | A temporary failure occurred; another attempt is scheduled |
| **Connected — older messages unavailable** | The server reported a truncated replay; some older messages may be missing |
| **Disabled** | This subscription's switch is off in Preferences |
| **Reconnect** | Retry all enabled subscriptions, including those stopped by an error |

GNOME's **Do Not Disturb** setting is respected. ntfy priorities 1–2 use low
notification urgency and go to the notification list without a banner.
Priorities 3–5 use normal urgency; none bypass Do Not Disturb as critical alerts.
The extension's mute switch does not remove notifications already delivered.

For HTTP or keyring error states, use the [troubleshooting table](TROUBLESHOOTING.md#connection-and-token-errors).

## Send a test message

After subscribing to a public test topic on `https://ntfy.sh`, wait for
**Connected**, then run this with your own topic name:

```sh
curl --fail-with-body -H 'Title: GNOME subscription test' \
  --data-raw 'Your GNOME subscription works.' \
  https://ntfy.sh/YOUR_UNIQUE_TOPIC
```

You should see the text in **Recent messages** and, if notifications are enabled
and Do Not Disturb is off, a desktop banner. For private topics, publish through
your existing authenticated ntfy app or integration with write permission.
The extension itself only subscribes; it has no publishing form.

Attachments, publisher action buttons beyond the HTTP(S) click link, message
updates/deletions, and persistent history are not implemented. Message titles
are limited to 256 and bodies to 4,096 JavaScript string units; very large
messages may be shortened. HTML/Markdown is displayed as plain text.
