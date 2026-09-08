# Verification

[Documentation home](../README.md#documentation) · [Development](DEVELOPMENT.md) · [Troubleshooting](TROUBLESHOOTING.md)

## Automated

- `npm run check`: JavaScript syntax, metadata/schema agreement, strict GSettings
  validation, and Node behavioral tests.
- `node --test tests/history.test.js`: execute the real history renderer with
  menu/clock doubles; verify directly visible multiline bodies, title fallback,
  message order, timestamps, explicit browser actions, and clearing history.
  Also verifies badge visibility, muted reception, the 20-message cap, retaining
  the count when reading, and accessible count/mute text.
  This checks menu composition, not native St layout or scrolling.
- `npm run test:integration`: real GJS and Soup 3, using a loopback fixture for
  UTF-8 streaming, duplicate delivery, reconnect, HTTP 403, redirect refusal,
  and cancellation during a pending read.
- `npm run pack`: validate schema XML and the archive; GNOME compiles the schema
  during installation. The generated schema binary is excluded from the ZIP.
- `npm run test:preferences`: native GTK/libadwaita controls and GSettings with
  a minimal replacement for the Shell preferences host. Tests construction,
  adding, duplicate validation, enabling/disabling, removal, malformed saved
  settings, and closing. It also follows the subscription key button, saves,
  replaces and removes real keyring tokens, verifies masked entry clearing,
  and tests inline token validation. Use `xvfb-run -a` without a display.
- `npm run test:keyring`: real libsecret store/read/delete, server isolation,
  missing credentials, cancellation, and refusing locked reads/deletions without
  prompting. All runtime suites use private D-Bus and disposable keyrings.

### Verified in the development container (2026-09-07)

40 Node tests, strict schema compilation, archive construction/integrity,
real GJS/Soup bearer authentication, native preferences, and real keyring tests
passed. GJS 1.82.3 and
libadwaita 1.7.6 were extracted into a temporary directory; no system desktop
installation was made. The container keyring reported a secure-memory allocation
warning and an internal warning when locking the test collection; headless GTK
reported a focus warning. The behavioral assertions passed, including locked
item handling. These environment warnings still require comparison on a desktop.
Accessibility behavior itself has not been tested.

The 0.3.0 submission candidate reran all 40 Node tests and the three native
suites successfully. Shexli 0.2.1 reported zero errors and two lifecycle warnings
about parent-owned objects/signals; the cleanup paths are documented in
[Publishing](RELEASING.md#static-review-linter). The archive includes license
text and schema XML, with schema compilation left to the GNOME installer.

The history regression reproduced the reported hidden-body problem before the
fix, then passed after replacing per-message submenus with visible sections.
The user's desktop screenshot confirms two connected subscriptions and a
received history entry in the previous version. The updated menu still needs
visual verification on that desktop.

### Badge and icon verification (2026-09-08)

The 0.3.1 badge/icon update passes all 43 Node tests, syntax and schema checks,
archive construction/integrity, and Shexli with zero errors and the same two
documented lifecycle warnings. A native GJS smoke check opens the bundled SVG
through `Gio.FileIcon` and decodes it at 16, 32 and 48 pixels using GdkPixbuf.
The listing PNG decodes as 512 × 512 with transparency. The new badge tests
failed before implementation and passed afterward.

The previous native network/preferences/keyring results above are from 0.3.0;
those unchanged modules were not rerun for this panel update. Badge allocation,
theme contrast and actual Shell icon rendering still need desktop validation.

## Reported desktop (2026-09-08)

The owner ran `gnome-shell --version` on the test desktop and reported
**GNOME Shell 48.7**. This matches the existing `48` entry in `metadata.json`;
GNOME uses the major version for extension compatibility. The session type
has not been reported. This confirms the test environment's version, not a
complete acceptance pass of the submitted candidate.

## Desktop acceptance — pending

These checks require a real GNOME Shell session. A successful Node or GJS
networking test does not verify Shell actors, notification rendering, or GTK
preferences. The metadata's Shell versions are provisional targets.

| Scenario | Expected result |
| --- | --- |
| Enable with empty settings | Panel appears; add-topic guidance; no network request |
| ntfy panel artwork | Bundled logo loads without a network request; dims when muted |
| Notification banner and list icon | Bundled ntfy logo, matching the panel; no generic bell icon |
| Receive 1 / 10 / 25 messages | Badge shows 1 / 10 / 20, matching the retained history count |
| Read history / toggle notification mute | Count is preserved; muted reception still increments it |
| Add valid topic | Row appears immediately; status becomes Connected |
| Invalid server/topic or duplicate | Error near form; existing subscriptions survive |
| Remove / Undo | Stream stops; Undo restores subscription |
| Disable one topic | Its stream stops; other topics continue |
| Publish a unique message | One notification and one history entry |
| Expand Recent messages once | Body visible immediately; no second arrow or repeated topic fallback |
| Title absent / Unicode / long text | Useful fallback; literal markup; multiline and unbroken text wrap |
| 20 messages / one long message | History scrolls; last message, links and menu controls remain reachable |
| Receive while reading history | Count updates without stealing focus; reopening shows new content |
| Clear recent messages | History empties; badge hides; clear action disabled; server messages unaffected |
| Priorities 1–2 / 3–5 | Low / normal urgency; never critical |
| GNOME Do Not Disturb | No popup for incoming messages |
| Extension notification mute | Messages still appear in recent history |
| HTTP(S) click action | Browser opens only after explicit user action |
| Offline / online / suspend | Retry status; reconnection; cached recovery where available |
| HTTP 403 | Actionable error; no automatic retry loop |
| Save/replace server token | Shared subscriptions reconnect; other servers stay connected |
| Keyring locked or token missing | No anonymous request; actionable state in panel |
| Unlock in Preferences | Native keyring prompt if needed; affected server retries |
| Remove server token | Item removed from keyring; affected server uses anonymous access |
| Close Preferences during token operation | Pending operation cancelled; no updates to destroyed widgets |
| Disable during connect/read/retry | No later notifications, callbacks, timers, or actors |
| Lock and unlock | Extension stops, clears memory, and resumes as a fresh session |
| Rapid disable/enable cycles | One panel indicator and one client per enabled topic |
| Open/close preferences repeatedly | No signal-handler warnings |
| Keyboard, scaling, light/dark | Native focus behavior and readable controls |
| Panel badge at normal/high DPI and light/dark styles | One- and two-digit counts remain readable and aligned; no clipped icon or badge |
| GNOME 46 / 47 / 48 / 49 / 50 | Complete smoke pass before release support is claimed |
