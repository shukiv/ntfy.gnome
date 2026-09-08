# Publishing on extensions.gnome.org

[Documentation home](../README.md#documentation) · [Desktop tests](TESTING.md) · [Installation](INSTALLATION.md)

## Current test build

Version **0.3.1** adds the ntfy panel logo and a badge showing the retained
message count (up to 20). Reading the history preserves the count; clearing it
hides the badge. Muting desktop notifications dims the logo and keeps receiving.

Download the [0.3.1 candidate ZIP](https://github.com/shukiv/ntfy.gnome/releases/download/v0.3.1-rc.1/ntfy%40shukiv.github.io.shell-extension.zip)
and [checksums](https://github.com/shukiv/ntfy.gnome/releases/download/v0.3.1-rc.1/SHA256SUMS)
from the [GitHub prerelease](https://github.com/shukiv/ntfy.gnome/releases/tag/v0.3.1-rc.1),
or build from `main`. Desktop visual validation remains pending. This update has
not been uploaded to extensions.gnome.org.

## Initial submission

Version **0.3.0** was submitted to extensions.gnome.org. The owner's listing
screenshot shows **Unreviewed** on 2026-09-07, under
[ntfy for GNOME — extension 10898](https://extensions.gnome.org/extension/10898/ntfy-for-gnome/).
Approval has not been confirmed. The listing returns HTTP 404 to anonymous
visitors, so the owner screenshot is the evidence for this submission status.
Source is available on `main`, and the GitHub repository is public.

The [original 0.3.0 prerelease](https://github.com/shukiv/ntfy.gnome/releases/tag/v0.3.0-rc.1)
retains the submitted ZIP and its checksums. Building from current `main`
produces the newer candidate above.

Submit at [extensions.gnome.org/upload](https://extensions.gnome.org/upload/)
using your GNOME Extensions account. `gjs.guide/extensions/` contains developer
documentation; the upload form is on extensions.gnome.org.

| Field | Prepared value |
| --- | --- |
| Name | ntfy for GNOME |
| GNOME listing | `https://extensions.gnome.org/extension/10898/ntfy-for-gnome/` — last reported as awaiting review |
| UUID | `ntfy@shukiv.github.io` |
| User-facing version | `0.3.1` in `version-name`; initial submission was `0.3.0` |
| Homepage | `https://github.com/shukiv/ntfy.gnome` — publicly accessible |
| License | GPL-3.0-only; selected by the owner |
| Archive | `dist/ntfy@shukiv.github.io.shell-extension.zip` |
| Shell targets | 46–50 declared in the submission; desktop validation remains pending |
| Reported test desktop | GNOME Shell 48.7, reported by the owner on 2026-09-08; matches the `48` entry |

The namespace follows the maintainer's GitHub account. GNOME treats the change
from `ntfy@ntfy.gnome` as a new extension: follow the
[prototype migration](INSTALLATION.md#migrate-from-the-prototype) on existing
desktops. Settings and keyring identities are retained.

The numeric `version` field is assigned by extensions.gnome.org. Keep it out of
source metadata and use `version-name` for the visible project release. See
[GNOME's metadata reference](https://gjs.guide/extensions/overview/anatomy.html#metadata-json-required).

## Validation for this submission and future updates

The owner selected GNU GPL version 3. The applied terms are in
[LICENSE](../LICENSE), with the full license text in [COPYING](../COPYING).
The owner also approved public repository access; both steps are complete.

1. The test desktop is GNOME Shell 48.7. Record its session type, install this
   exact candidate and complete the [desktop acceptance checks](TESTING.md).
   Record verified versions and adjust `shell-version` in an update if needed.
2. Review the implementation and the [architecture](BLUEPRINT.md). The maintainer
   must be able to explain the submitted code; GNOME permits AI assistance as
   a development tool but expects the maintainer to understand and justify it.
   See the [review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#extensions-must-not-be-ai-generated).
3. Build the final ZIP after any metadata or code changes:

```sh
npm run check
python3 scripts/pack.py
sha256sum dist/ntfy@shukiv.github.io.shell-extension.zip
```

Use the new UUID's ZIP, not a leftover prototype ZIP in `dist/`.
The package contains JavaScript sources, metadata, stylesheet, the schema XML,
the ntfy SVG and license notices. The artwork retains Apache-2.0 terms; see
[attribution](../icons/NOTICE) and [license](../icons/LICENSE-Apache-2.0).
GNOME compiles the schema during installation. It excludes
tests, Python scripts, documentation, npm files, and local credentials.

## Listing description

The description in `metadata.json` is ready for the listing:

> Receive ntfy notifications in GNOME Shell from ntfy.sh or your own server.
>
> Subscribe to public and private topics, store access tokens in the desktop
> keyring, and read the last 20 received messages in the panel menu. Includes
> a panel message-count badge, connection status, automatic reconnection, and a
> desktop notification switch.
>
> Requires libsecret and a desktop keyring for access tokens. Recent history is
> kept in memory and clears when the extension stops, including screen locking
> and logout.

For a listing screenshot, capture the actual updated panel with a harmless test
message and an expanded Recent messages list. An optional preferences screenshot
can show the token controls with an empty token field. Do not use the older
screenshot with the hidden message submenu or expose private message contents.

## Listing icon

The puzzle icon on extensions.gnome.org is stored by the website separately
from the panel icon. Installing a new ZIP does not update that website image.

1. Download [ntfy.png](https://github.com/shukiv/ntfy.gnome/releases/download/v0.3.1-rc.1/ntfy.png),
   or use `assets/ntfy.png` from this repository (512 × 512, transparent PNG).
2. Sign in to the account that owns
   [ntfy for GNOME](https://extensions.gnome.org/extension/10898/ntfy-for-gnome/).
3. Click the puzzle icon beside the extension name and upload the PNG.
4. Refresh the listing and Installed extensions page to check the result.

This is the icon workflow documented in the
[GNOME review FAQ](https://extensions.gnome.org/review/8331).
Both artwork files come unmodified from the requested
[Dashboard Icons ntfy page](https://dashboardicons.com/icons/ntfy).

## Submit for review

1. Sign in or register at [extensions.gnome.org](https://extensions.gnome.org/accounts/login/?next=/upload/).
2. Open [Add yours / Upload](https://extensions.gnome.org/upload/).
3. Upload `ntfy@shukiv.github.io.shell-extension.zip` from `dist/` and complete
   the site's submission form under the account that will maintain the extension.
4. Inspect the resulting listing and review page. Add the screenshot and any
   reviewer notes requested by the site.
5. Monitor the review and respond to each requested change. Uploading starts
   the review process; it does not mean the extension has been approved.

The owner completed the initial upload in their browser. This development
environment still has no authenticated extensions.gnome.org session; subsequent
uploads and account-only review actions need the owner's browser.

## Awaiting review

The next step is to monitor the **Unreviewed** link on the listing and the
account's review email. Add a screenshot of the actual extension with harmless
message content. Respond to any reviewer requests before uploading a replacement.

The site's **Incompatible** label appears when its compatibility selector cannot
find an installable version for the detected Shell. An unreviewed first release
has no approved build available, so the label alone does not establish a runtime
incompatibility. The owner has since reported GNOME Shell 48.7, which matches
the submitted `48` entry; no `48.7` metadata entry is needed. The browser's
detected version and the latest account-only review status remain unchecked. See the
[website's compatibility logic](https://extensions.gnome.org/static/js/extensions.aff5cff579c3.js)
and [GNOME's review-before-download explanation](https://extensions.gnome.org/about/).

Do not upload the same archive again solely to clear that label. Approval status
and actual desktop compatibility need to be checked separately.

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
virtual environment, outside the extension package:

```sh
python3 -m venv /tmp/ntfy-ego-lint
/tmp/ntfy-ego-lint/bin/pip install shexli==0.2.1 tree-sitter==0.25.2 tree-sitter-javascript==0.25.0
/tmp/ntfy-ego-lint/bin/shexli dist/ntfy@shukiv.github.io.shell-extension.zip
```

The Tree-sitter version is pinned because 0.26.0 crashed in this container with
Shexli 0.2.1. The 0.3.0 submission reported two lifecycle warnings, `EGO-L-002`
for indicator children and `EGO-L-003` for the notification source's destroy
signal. Since 0.3.1, `disable()` destroys the icon, badge, notification toggle,
subscriptions section and recent submenu explicitly before the indicator, and
disconnects the tracked source signal before destroying the source. Each child
removes itself from its parent on destroy, so no double destruction occurs.
Check repeated enable/disable on the actual desktop after any lifecycle change.

## Later releases

Keep the public UUID and settings schema stable. Update `version-name` and the
package version together, rerun checks, and test each newly declared Shell
version. Upload through the same maintainer account, respond to review feedback,
and update this document with the public listing URL after approval.
