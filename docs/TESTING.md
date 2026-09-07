# Verification

## Automated

- `npm run check`: JavaScript syntax, metadata/schema agreement, strict GSettings
  validation, and Node behavioral tests.
- `npm run test:integration`: real GJS and Soup 3, using a loopback fixture for
  UTF-8 streaming, duplicate delivery, reconnect, HTTP 403, redirect refusal,
  and cancellation during a pending read.
- `npm run pack`: compile schema and validate the archive.
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

37 Node tests, strict schema compilation, archive construction/integrity,
real GJS/Soup bearer authentication, native preferences, and real keyring tests
passed. GJS 1.82.3 and
libadwaita 1.7.6 were extracted into a temporary directory; no system desktop
installation was made. The container keyring reported a secure-memory allocation
warning and an internal warning when locking the test collection; headless GTK
reported a focus warning. The behavioral assertions passed, including locked
item handling. These environment warnings still require comparison on a desktop.
Accessibility behavior itself has not been tested.

## Desktop acceptance — pending

These checks require a real GNOME Shell session. A successful Node or GJS
networking test does not verify Shell actors, notification rendering, or GTK
preferences. The metadata's Shell versions are provisional targets.

| Scenario | Expected result |
| --- | --- |
| Enable with empty settings | Panel appears; add-topic guidance; no network request |
| Add valid topic | Row appears immediately; status becomes Connected |
| Invalid server/topic or duplicate | Error near form; existing subscriptions survive |
| Remove / Undo | Stream stops; Undo restores subscription |
| Disable one topic | Its stream stops; other topics continue |
| Publish a unique message | One notification and one history entry |
| Title absent / Unicode / long text | Useful fallback; no markup injection; readable text |
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
| GNOME 46 / 47 / 48 / 49 / 50 | Complete smoke pass before release support is claimed |
