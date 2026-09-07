# Publishing on extensions.gnome.org

[Documentation home](../README.md#documentation) · [Desktop tests](TESTING.md) · [Installation](INSTALLATION.md)

## Submission candidate

Candidate **0.3.0** is prepared on `release/ego-submission`. It has not been
submitted or approved. The existing GitHub repository is still private.

| Field | Prepared value |
| --- | --- |
| Name | ntfy for GNOME |
| UUID | `ntfy@shukiv.github.io` |
| User-facing version | `0.3.0` in `version-name` |
| Homepage | `https://github.com/shukiv/ntfy.gnome` — needs public access before submission |
| License | GPL-3.0-only; selected by the owner |
| Archive | `dist/ntfy@shukiv.github.io.shell-extension.zip` |
| Shell targets | 46–50 in the candidate; select verified versions before uploading |

The namespace follows the maintainer's GitHub account. GNOME treats the change
from `ntfy@ntfy.gnome` as a new extension: follow the
[prototype migration](INSTALLATION.md#migrate-from-the-prototype) on existing
desktops. Settings and keyring identities are retained.

The numeric `version` field is assigned by extensions.gnome.org. Keep it out of
source metadata and use `version-name` for the visible project release. See
[GNOME's metadata reference](https://gjs.guide/extensions/overview/anatomy.html#metadata-json-required).

## Before upload

The owner selected GNU GPL version 3. The applied terms are in
[LICENSE](../LICENSE), with the full license text in [COPYING](../COPYING).
Repository visibility approval remains separate from the license choice.

1. Make the repository public, or provide another publicly accessible source
   and issue-reporting URL and update `metadata.json`. Making the current
   repository public also exposes its existing Git history and documentation.
2. Record the desktop's `gnome-shell --version` and session type. Install this
   exact candidate and complete the [desktop acceptance checks](TESTING.md).
   Retain only versions actually verified in `shell-version` for the submission.
3. Review the implementation and the [architecture](BLUEPRINT.md). The maintainer
   must be able to explain the submitted code; GNOME permits AI assistance as
   a development tool but expects the maintainer to understand and justify it.
   See the [review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#extensions-must-not-be-ai-generated).
4. Build the final ZIP after any metadata or code changes:

```sh
npm run check
python3 scripts/pack.py
sha256sum dist/ntfy@shukiv.github.io.shell-extension.zip
```

Use the new UUID's ZIP, not a leftover prototype ZIP in `dist/`.
The package contains JavaScript sources, metadata, stylesheet, the schema XML
and license text. GNOME compiles the schema during installation. It excludes
tests, Python scripts, documentation, npm files, and local credentials.

## Listing description

The description in `metadata.json` is ready for the listing:

> Receive ntfy notifications in GNOME Shell from ntfy.sh or your own server.
>
> Subscribe to public and private topics, store access tokens in the desktop
> keyring, and read the last 20 received messages in the panel menu. Includes
> connection status, automatic reconnection, and a desktop notification switch.
>
> Requires libsecret and a desktop keyring for access tokens. Recent history is
> kept in memory and clears when the extension stops, including screen locking
> and logout.

For a listing screenshot, capture the actual updated panel with a harmless test
message and an expanded Recent messages list. An optional preferences screenshot
can show the token controls with an empty token field. Do not use the older
screenshot with the hidden message submenu or expose private message contents.

## Submit for review

1. Sign in or register at [extensions.gnome.org](https://extensions.gnome.org/accounts/login/?next=/upload/).
2. Open [Add yours / Upload](https://extensions.gnome.org/upload/).
3. Upload `ntfy@shukiv.github.io.shell-extension.zip` from `dist/` and complete
   the site's submission form under the account that will maintain the extension.
4. Inspect the resulting listing and review page. Add the screenshot and any
   reviewer notes requested by the site.
5. Monitor the review and respond to each requested change. Uploading starts
   the review process; it does not mean the extension has been approved.

The current environment has no authenticated extensions.gnome.org session.
The account owner needs to perform the login and upload in their browser.

## Review notes

The following points describe the candidate's implementation for a reviewer:

- `enable()` owns the panel, settings connections, Soup session and clients;
  `disable()` stops clients, cancels pending lookups/requests and retry timers,
  aborts Soup, disconnects settings signals and destroys the UI and notifications.
- Shell imports no GTK/Adwaita libraries; Preferences imports no Shell-only GI
  libraries. Packaged JavaScript is reachable from one of these entry points.
- Subscriptions stream JSON through Soup 3. Authentication reads libsecret
  asynchronously and uses an Authorization header, with no anonymous fallback
  after credential lookup failure and no redirect following.
- No shell commands, privileged helpers, bundled executables, telemetry, or
  clipboard-reading API are used by the extension. Token pasting is handled by
  the native password entry in Preferences.
- Only the normal user session is used. History and retry checkpoints are held
  in memory; screen locking disables the extension.

These notes support review; they do not replace native desktop testing or
guarantee approval. The current [GNOME review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
are the authority for submission requirements.

### Static review linter

The candidate was checked with Shexli 0.2.1. Reproduce the check in a temporary
virtual environment, outside the extension package. The final candidate reports
zero errors and two warnings:

```sh
python3 -m venv /tmp/ntfy-ego-lint
/tmp/ntfy-ego-lint/bin/pip install shexli==0.2.1 tree-sitter==0.25.2 tree-sitter-javascript==0.25.0
/tmp/ntfy-ego-lint/bin/shexli dist/ntfy@shukiv.github.io.shell-extension.zip
```

The Tree-sitter version is pinned because 0.26.0 crashed in this container with
Shexli 0.2.1. The remaining lifecycle warnings require review of ownership:

| Warning | Ownership and cleanup |
| --- | --- |
| `EGO-L-002` for the icon, notification toggle, subscriptions section and recent submenu | They are children of the indicator/menu. `this._indicator.destroy()` destroys that complete tree; references are then cleared. |
| `EGO-L-003` for the notification source's destroy signal | `this._source.destroy()` destroys the emitter and disconnects its signals. If GNOME destroys it earlier, the callback clears the saved reference. |

No duplicate child destruction or linter suppression is added. Review these
ownership paths and check repeated enable/disable on the actual desktop.

## Later releases

Keep the public UUID and settings schema stable. Update `version-name` and the
package version together, rerun checks, and test each newly declared Shell
version. Upload through the same maintainer account, respond to review feedback,
and update this document with the public listing URL after approval.
