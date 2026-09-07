# Installation and updates

[Documentation home](../README.md#documentation) · [User guide](USER_GUIDE.md) · [Troubleshooting](TROUBLESHOOTING.md)

## Requirements

Run the extension on a GNOME desktop. A server without GNOME can build the ZIP
and run the development checks, but cannot display the panel or notifications.

| Purpose | Requirements |
| --- | --- |
| Run the extension | GNOME Shell 46–50 target; GJS, Soup 3, libsecret and a Secret Service provider such as GNOME Keyring |
| Open preferences | GTK 4 and libadwaita, including their GObject introspection bindings |
| Build the archive | Python 3 and `glib-compile-schemas` |
| Clone from GitHub | Git; GitHub CLI (`gh`) for the commands below |
| Develop and check code | Node.js 20+; no npm packages needed |

GNOME distributions normally supply most runtime dependencies. See
[Testing](TESTING.md) for the distinction between tested components and the
pending desktop version matrix.

Check the desktop version and session type in a terminal on that desktop:

```sh
gnome-shell --version
echo "$XDG_SESSION_TYPE"
```

## First installation

Run these commands as the logged-in desktop user, without `sudo`. Installing
as root places the extension in root's account rather than yours.

```sh
gh repo clone shukiv/ntfy.gnome
cd ntfy.gnome
python3 scripts/pack.py
gnome-extensions install --force dist/ntfy@ntfy.gnome.shell-extension.zip
```

If GitHub CLI is not authenticated, run `gh auth login` first. Access to the
repository is required while it is private. You can also clone with Git using
your configured GitHub credentials:

```sh
git clone https://github.com/shukiv/ntfy.gnome.git
```

The build prints the ZIP path. It includes the compiled settings schema and
all runtime files; do not ZIP the repository directory yourself.

## Refresh GNOME Shell

GNOME must discover a newly installed extension and reload changed JavaScript
after an update. Choose the method matching `XDG_SESSION_TYPE`:

| Session | Refresh method |
| --- | --- |
| `x11` | Press **Alt+F2**, type **restart**, and press Enter. Your application windows stay open. |
| `wayland` | Save your work, log out of GNOME, and log back in. There is no equivalent in-place Shell restart. |
| Development | Start a fresh [nested Shell session](DEVELOPMENT.md#test-in-a-nested-gnome-session). |

Disabling and enabling the extension does not reload imported JavaScript.
The GNOME project documents the [restart and nested-session workflow](https://gjs.guide/extensions/development/creating.html#testing-the-extension)
and [Shell debugging](https://gjs.guide/extensions/development/debugging.html).

After the refresh, enable the extension and open its preferences:

```sh
gnome-extensions enable ntfy@ntfy.gnome
gnome-extensions info ntfy@ntfy.gnome
gnome-extensions prefs ntfy@ntfy.gnome
```

The ntfy notification icon should appear in the top bar. Continue with
[adding your first subscription](USER_GUIDE.md#add-a-subscription).

If enable reports **Extension “ntfy@ntfy.gnome” does not exist**, follow the
[discovery troubleshooting steps](TROUBLESHOOTING.md#extension-does-not-exist).

## Update

Inside your existing checkout on the desktop:

```sh
cd ~/ntfy.gnome
git pull --ff-only
python3 scripts/pack.py
gnome-extensions install --force dist/ntfy@ntfy.gnome.shell-extension.zip
```

Use your checkout's actual location if it differs. Then
[refresh GNOME Shell](#refresh-gnome-shell) to load the update. Close and reopen
Preferences if it was open. Subscriptions and keyring tokens are retained;
in-memory recent messages reset when Shell restarts.

If `git pull --ff-only` reports local changes or diverged history, preserve your
work before resolving it; recloning is not required for a normal update.

## Disable or remove

To stop the extension while retaining subscriptions and tokens:

```sh
gnome-extensions disable ntfy@ntfy.gnome
```

To remove the installed extension:

```sh
gnome-extensions uninstall ntfy@ntfy.gnome
```

Uninstalling the extension does not revoke ntfy tokens or explicitly delete its
keyring entries. For cleanup, use **Preferences → Access tokens → Remove token**
before uninstalling. Revoke a token in the ntfy account separately if it should
no longer work anywhere. See [token management](USER_GUIDE.md#manage-access-tokens).
