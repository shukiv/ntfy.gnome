// SPDX-License-Identifier: GPL-3.0-only

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {CredentialError, parseCredentials} from './auth.js';
import {normalizeServer} from './config.js';
import {SecretStore} from './secrets.js';
import {TokenSettings} from './tokenSettings.js';

export function credentialMessage(code, _) {
    switch (code) {
    case 'invalid-token': return _('Enter a valid access token without spaces or line breaks.');
    case 'https-required': return _('Use HTTPS for access tokens. HTTP is allowed only on localhost.');
    case 'token-missing': return _('Saved token is missing. Add the access token again in Preferences.');
    case 'keyring-locked': return _('Keyring is locked. Unlock it in Access tokens, then retry.');
    case 'keyring-unavailable': return _('Could not access the desktop keyring. Check that Secret Service is running.');
    case 'settings-changed': return _('Server credentials changed in another window. Please try again.');
    case 'invalid-settings': return _('Saved token references are invalid. Repair the server-credentials setting.');
    case 'cancelled': return _('Token operation was cancelled.');
    default: return _('Could not update the access token.');
    }
}

export class TokenPreferences {
    constructor(window, settings, _) {
        this._window = window;
        this._settings = settings;
        this._ = _;
        this._secrets = new SecretStore();
        this._operations = new Set();
        this._closed = false;
        this._busy = false;
        this._rows = [];
        this._tokens = new TokenSettings({
            read: () => this._read(),
            write: values => {
                if (this._closed)
                    throw new CredentialError('cancelled');
                if (!settings.set_value('server-credentials', new GLib.Variant('a{ss}', values)))
                    throw new CredentialError('settings-changed');
            },
            secrets: this._secrets,
            newId: () => GLib.uuid_string_random(),
        });

        this.page = new Adw.PreferencesPage({
            title: _('Access tokens'), icon_name: 'dialog-password-symbolic',
        });
        window.add(this.page);
        const editor = new Adw.PreferencesGroup({
            title: _('Add or replace an access token'),
            description: _('One token is shared by all subscriptions on the same server. It is stored in your desktop keyring.'),
        });
        this._server = new Adw.EntryRow({title: _('Server URL'), text: 'https://ntfy.sh'});
        this._token = new Adw.PasswordEntryRow({title: _('Access token')});
        this._save = new Gtk.Button({
            label: _('Save token'), css_classes: ['suggested-action'], valign: Gtk.Align.CENTER,
        });
        this._feedback = new Adw.ActionRow({
            title: _('Connect to private topics'),
            subtitle: _('Paste the token value, without the “Bearer” prefix. Use an HTTPS server URL.'),
            use_markup: false,
        });
        this._feedback.add_suffix(this._save);
        editor.add(this._server);
        editor.add(this._token);
        editor.add(this._feedback);
        this.page.add(editor);
        this._saved = new Adw.PreferencesGroup({title: _('Saved tokens')});
        this.page.add(this._saved);
        const save = () => {
            if (this._busy)
                return;
            const server = this._server.text;
            const token = this._token.text;
            this._token.text = '';
            void this._perform(async () => {
                await this._tokens.save(server, token, operation => this._run(operation));
            }, _('Token saved. Subscriptions on this server will reconnect.'));
        };
        this._save.connect('clicked', save);
        this._token.connect('entry-activated', save);
        this._changedId = settings.connect('changed::server-credentials', () => {
            if (!this._busy)
                this._render();
        });
        this._render();
    }

    _read() {
        return parseCredentials(this._settings.get_value('server-credentials').deep_unpack());
    }

    async _run(operation) {
        this._operations.add(operation);
        try {
            if (this._closed)
                operation.cancel();
            return await operation.promise;
        } finally {
            this._operations.delete(operation);
        }
    }

    async _perform(action, success) {
        if (this._busy || this._closed)
            return;
        this._busy = true;
        this._save.sensitive = false;
        this._server.sensitive = false;
        this._token.sensitive = false;
        this._saved.sensitive = false;
        this._feedback.title = this._('Working…');
        this._feedback.subtitle = this._('Your keyring may ask you to unlock it.');
        let feedback;
        try {
            await action();
            feedback = success;
        } catch (error) {
            feedback = credentialMessage(error.code, this._);
            if (!(error instanceof CredentialError))
                feedback = this._('Enter a valid HTTP or HTTPS server origin, without a path or credentials.');
        } finally {
            this._busy = false;
            if (!this._closed) {
                this._server.sensitive = true;
                this._token.sensitive = true;
                this._saved.sensitive = true;
                this._feedback.title = this._('Access token');
                this._feedback.subtitle = feedback;
                this._render();
            }
        }
    }

    _render() {
        for (const row of this._rows)
            this._saved.remove(row);
        this._rows = [];
        let credentials;
        try {
            credentials = this._read();
            this._save.sensitive = !this._busy;
        } catch {
            this._saved.description = credentialMessage('invalid-settings', this._);
            this._save.sensitive = false;
            return;
        }
        this._saved.description = Object.keys(credentials).length
            ? this._('Removing a token switches that server back to anonymous access. It does not revoke the token on the server.')
            : this._('No tokens saved. Public subscriptions work without a token.');
        for (const [server, id] of Object.entries(credentials)) {
            const row = new Adw.ActionRow({
                title: server, subtitle: this._('Access token stored in keyring'), use_markup: false,
            });
            const edit = new Gtk.Button({
                icon_name: 'document-edit-symbolic', css_classes: ['flat'],
                valign: Gtk.Align.CENTER, tooltip_text: this._('Replace token'),
            });
            edit.connect('clicked', () => this.selectServer(server));
            const unlock = new Gtk.Button({
                label: this._('Unlock'), valign: Gtk.Align.CENTER,
                tooltip_text: this._('Unlock the keyring and retry this server'),
            });
            unlock.connect('clicked', () => {
                void this._perform(async () => {
                    await this._run(this._secrets.lookup(server, id, {unlock: true}));
                    if (!this._closed)
                        this._settings.set_value('credential-retry', new GLib.Variant('(ss)', [server, GLib.uuid_string_random()]));
                }, this._('Keyring unlocked. Subscriptions on this server will reconnect.'));
            });
            const remove = new Gtk.Button({
                icon_name: 'user-trash-symbolic', css_classes: ['flat'],
                valign: Gtk.Align.CENTER, tooltip_text: this._('Remove token'),
            });
            remove.connect('clicked', () => {
                void this._perform(() => this._tokens.remove(server, operation => this._run(operation)),
                    this._('Token removed. Subscriptions on this server will use anonymous access.'));
            });
            row.add_suffix(edit);
            row.add_suffix(unlock);
            row.add_suffix(remove);
            this._saved.add(row);
            this._rows.push(row);
        }
    }

    selectServer(server) {
        if (this._busy || this._closed)
            return;
        this._server.text = normalizeServer(server);
        this._token.text = '';
        this._window.set_visible_page(this.page);
        this._token.grab_focus();
    }

    destroy() {
        this._closed = true;
        this._token.text = '';
        for (const operation of this._operations)
            operation.cancel();
        this._settings.disconnect(this._changedId);
    }
}
