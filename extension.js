// SPDX-License-Identifier: GPL-3.0-only

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {parseSubscriptions, safeWebUrl} from './lib/config.js';
import {SubscriptionClient} from './lib/client.js';
import {schedule, SoupTransport} from './lib/transport.js';
import {AuthenticatedTransport, parseCredentials} from './lib/auth.js';
import {SecretStore} from './lib/secrets.js';
import {credentialStatus} from './lib/credentialMessages.js';

export default class NtfyExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._transport = new SoupTransport();
        this._secrets = new SecretStore();
        this._clients = new Map();
        this._statusRows = new Map();
        this._history = [];
        this._source = null;
        this._indicator = new PanelMenu.Button(0.0, _('ntfy'));
        const panelBox = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._icon = new St.Icon({
            gicon: new Gio.FileIcon({file: this.dir.resolve_relative_path('icons/ntfy.svg')}),
            style_class: 'system-status-icon',
        });
        this._badge = new St.Label({
            text: '0',
            visible: false,
            style_class: 'ntfy-message-count',
            y_align: Clutter.ActorAlign.CENTER,
        });
        panelBox.add_child(this._icon);
        panelBox.add_child(this._badge);
        this._indicator.add_child(panelBox);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        const menu = this._indicator.menu;
        menu.addMenuItem(new PopupMenu.PopupMenuItem(_('ntfy'), {reactive: false}));
        this._notificationToggle = new PopupMenu.PopupSwitchMenuItem(
            _('Desktop notifications'), this._settings.get_boolean('notifications-enabled'));
        this._notificationToggle.connect('toggled', (_item, state) => {
            this._settings.set_boolean('notifications-enabled', state);
        });
        menu.addMenuItem(this._notificationToggle);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Subscriptions')));
        this._subscriptionsSection = new PopupMenu.PopupMenuSection();
        menu.addMenuItem(this._subscriptionsSection);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._recentMenu = new PopupMenu.PopupSubMenuMenuItem(_('Recent messages'));
        this._recentMenu.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen)
                this._renderHistory();
        });
        menu.addMenuItem(this._recentMenu);
        this._clearItem = menu.addAction(_('Clear recent messages'), () => {
            this._history = [];
            this._renderHistory();
        });
        menu.addAction(_('Reconnect'), () => {
            for (const client of this._clients.values())
                client.reconnect();
        });
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction(_('Preferences…'), () => this.openPreferences());

        this._settingsSignals = [
            this._settings.connect('changed::subscriptions', () => this._syncSubscriptions()),
            this._settings.connect('changed::notifications-enabled', () => this._syncMute()),
            this._settings.connect('changed::server-credentials', () => this._syncSubscriptions()),
            this._settings.connect('changed::credential-retry', () => {
                const [server] = this._settings.get_value('credential-retry').deep_unpack();
                for (const client of this._clients.values()) {
                    if (client.subscription.server === server)
                        client.reconnect();
                }
            }),
        ];
        this._syncMute();
        this._syncSubscriptions();
        this._renderHistory();
    }

    _syncMute() {
        const enabled = this._settings.get_boolean('notifications-enabled');
        this._notificationToggle.setToggleState(enabled);
        this._icon.opacity = enabled ? 255 : 128;
        this._syncMessageCount();
    }

    _syncMessageCount() {
        const count = this._history.length;
        this._badge.text = String(count);
        this._badge.visible = count > 0;
        const recent = `${_('Recent messages')} (${count})`;
        this._recentMenu.label.text = recent;
        this._clearItem.setSensitive(count > 0);
        const name = this._settings.get_boolean('notifications-enabled')
            ? _('ntfy') : _('ntfy — notifications muted');
        this._indicator.accessible_name = count > 0 ? `${name} — ${recent}` : name;
    }

    _syncSubscriptions() {
        let subscriptions;
        let credentials;
        try {
            subscriptions = parseSubscriptions(this._settings.get_string('subscriptions'));
            credentials = parseCredentials(this._settings.get_value('server-credentials').deep_unpack());
        } catch {
            for (const client of this._clients.values())
                client.stop();
            this._clients.clear();
            this._statusRows.clear();
            this._subscriptionsSection.removeAll();
            this._subscriptionsSection.addMenuItem(new PopupMenu.PopupMenuItem(
                _('Invalid subscriptions or token settings — check Preferences'), {reactive: false}));
            return;
        }

        const wanted = new Map(subscriptions.filter(item => item.enabled).map(item => [item.id, item]));
        for (const [id, client] of this._clients) {
            const subscription = wanted.get(id);
            if (!subscription || subscription.server !== client.subscription.server ||
                subscription.topic !== client.subscription.topic) {
                client.stop();
                this._clients.delete(id);
            }
        }
        // Retain existing status text while replacing menu rows.
        const previous = new Map([...this._statusRows].map(([id, row]) => [id, row.status]));
        this._statusRows.clear();
        this._subscriptionsSection.removeAll();
        if (!subscriptions.length) {
            this._subscriptionsSection.addAction(_('Add a topic in Preferences…'), () => this.openPreferences());
        }
        for (const subscription of subscriptions) {
            const item = new PopupMenu.PopupSubMenuMenuItem(subscription.topic);
            item.label.style_class = 'ntfy-topic-title';
            item.menu.addMenuItem(new PopupMenu.PopupMenuItem(subscription.server, {reactive: false}));
            const statusItem = new PopupMenu.PopupMenuItem('', {reactive: false});
            item.menu.addMenuItem(statusItem);
            item.menu.addAction(_('Open topic'), () => this._openUrl(`${subscription.server}/${subscription.topic}`));
            this._subscriptionsSection.addMenuItem(item);
            this._statusRows.set(subscription.id, {item, statusItem, topic: subscription.topic});
            this._setStatus(subscription.id, subscription.enabled
                ? previous.get(subscription.id) ?? {state: 'connecting'} : {state: 'disabled'});
            if (!subscription.enabled)
                continue;
            const credentialId = credentials[subscription.server] ?? null;
            const transport = new AuthenticatedTransport(this._transport, this._secrets, subscription.server, credentialId);
            const existing = this._clients.get(subscription.id);
            if (existing) {
                if (existing.credentialId !== credentialId) {
                    existing.credentialId = credentialId;
                    existing.setTransport(transport);
                }
                continue;
            }
            const client = new SubscriptionClient(subscription, {
                transport,
                schedule,
                cancelScheduled: id => GLib.Source.remove(id),
                onMessage: message => this._receive(subscription, message),
                onStatus: status => this._setStatus(subscription.id, status),
            });
            client.credentialId = credentialId;
            this._clients.set(subscription.id, client);
            client.start();
        }
    }

    _setStatus(id, status) {
        const row = this._statusRows.get(id);
        if (!row)
            return;
        row.status = status;
        let text;
        switch (status.state) {
        case 'connected':
            text = status.truncated ? _('Connected — older messages unavailable') : _('Connected');
            break;
        case 'retrying':
            text = `${_('Reconnecting')} (${status.seconds}s)`;
            break;
        case 'error':
            text = ['HTTP 401', 'HTTP 403'].includes(status.reason)
                ? `${status.reason} — ${_('check Access tokens and topic permissions')}`
                : `${status.reason} — ${_('check server or topic, then Reconnect')}`;
            break;
        case 'credentials':
            text = credentialStatus(status.code, _);
            break;
        case 'disabled':
            text = _('Disabled');
            break;
        default:
            text = _('Connecting…');
        }
        row.item.label.text = `${row.topic} — ${text}`;
        row.statusItem.label.text = text;
    }

    _receive(subscription, message) {
        this._history.unshift({...message, server: subscription.server});
        this._history.length = Math.min(this._history.length, 20);
        // Refresh actors only when history is opened. A burst of notifications
        // should not rebuild the menu for every message or steal keyboard focus.
        this._syncMessageCount();
        if (!this._settings.get_boolean('notifications-enabled'))
            return;
        if (!this._source) {
            const source = new MessageTray.Source({
                title: _('ntfy'),
                iconName: 'preferences-system-notifications-symbolic',
            });
            source.connect('destroy', () => {
                if (this._source === source)
                    this._source = null;
            });
            this._source = source;
            Main.messageTray.add(source);
        }
        const notification = new MessageTray.Notification({
            source: this._source,
            title: message.title,
            body: `${subscription.topic}\n${message.body}`,
            useBodyMarkup: false,
            urgency: message.priority <= 2 ? MessageTray.Urgency.LOW : MessageTray.Urgency.NORMAL,
        });
        if (message.click)
            notification.addAction(_('Open link'), () => this._openUrl(message.click));
        this._source.addNotification(notification);
    }

    _renderHistory() {
        this._recentMenu.menu.removeAll();
        this._syncMessageCount();
        if (!this._history.length) {
            this._recentMenu.menu.addMenuItem(new PopupMenu.PopupMenuItem(
                _('New messages will appear here'), {reactive: false}));
            return;
        }
        for (const [index, message] of this._history.entries()) {
            if (index > 0)
                this._recentMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            // Sections are always expanded. A submenu here hides the body behind
            // a second arrow, leaving only the topic visible in recent history.
            const section = new PopupMenu.PopupMenuSection();
            const heading = message.title === message.topic
                ? message.topic : `${message.topic}: ${message.title}`;
            const title = new PopupMenu.PopupMenuItem(heading, {reactive: false, can_focus: false});
            title.label.style_class = 'ntfy-message-title';
            title.label.clutter_text.line_wrap = true;
            title.label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            title.label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            section.addMenuItem(title);
            const body = new PopupMenu.PopupMenuItem(message.body, {reactive: false, can_focus: false});
            body.label.style_class = 'ntfy-message-body';
            body.label.clutter_text.line_wrap = true;
            body.label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            body.label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            section.addMenuItem(body);
            const time = GLib.DateTime.new_from_unix_local(message.time);
            if (time) {
                const timestamp = new PopupMenu.PopupMenuItem(time.format('%x %X'), {
                    reactive: false, can_focus: false,
                });
                timestamp.label.style_class = 'ntfy-message-time';
                section.addMenuItem(timestamp);
            }
            if (message.click)
                section.addAction(_('Open link'), () => this._openUrl(message.click));
            section.addAction(_('Open topic'), () => this._openUrl(`${message.server}/${message.topic}`));
            this._recentMenu.menu.addMenuItem(section);
        }
    }

    _openUrl(value) {
        const url = safeWebUrl(value);
        if (!url)
            return;
        try {
            Gio.AppInfo.launch_default_for_uri(url, global.create_app_launch_context(0, -1));
        } catch {
            Main.notifyError(_('ntfy'), _('Could not open the link in your browser.'));
        }
    }

    disable() {
        for (const client of this._clients?.values() ?? [])
            client.stop();
        this._clients?.clear();
        this._clients = null;
        this._transport?.destroy();
        this._transport = null;
        this._secrets = null;
        for (const id of this._settingsSignals ?? [])
            this._settings.disconnect(id);
        this._settingsSignals = null;
        this._settings = null;
        // Destroying the notification source also disconnects its destroy signal.
        this._source?.destroy();
        this._source = null;
        // The indicator owns its icon, badge and menu. Destruction cascades to menu
        // items, sections and submenus, including their actor signal handlers.
        this._indicator?.destroy();
        this._indicator = null;
        this._statusRows?.clear();
        this._statusRows = null;
        this._history = null;
        this._icon = null;
        this._badge = null;
        this._notificationToggle = null;
        this._subscriptionsSection = null;
        this._recentMenu = null;
        this._clearItem = null;
    }
}
