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
import {SoupTransport} from './lib/transport.js';
import {Timeouts} from './lib/timeouts.js';
import {AuthenticatedTransport, parseCredentials} from './lib/auth.js';
import {SecretStore} from './lib/secrets.js';
import {credentialStatus} from './lib/credentialMessages.js';
import {parseReplayState, replayKey, serializeReplayState} from './lib/replay.js';

export default class NtfyExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._transport = new SoupTransport({userAgent: `ntfy-gnome/${this.metadata['version-name']}`});
        this._timeouts = new Timeouts();
        this._secrets = new SecretStore();
        this._clients = new Map();
        this._replayText = this._settings.get_string('replay-state');
        this._replay = parseReplayState(this._replayText, Math.floor(Date.now() / 1000));
        this._statusRows = new Map();
        // Subscription id -> {server, topic, messages}; newest message first.
        this._history = new Map();
        this._source = null;
        this._sourceDestroyId = null;
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
        // Room for message text; a narrow menu wraps bodies into a thin column.
        menu.box.add_style_class_name('ntfy-menu');
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
        this._clearItem = menu.addAction(_('Clear all messages'), () => this._clearAll());
        menu.addAction(_('Reconnect'), () => {
            for (const client of this._clients.values())
                client.reconnect();
        });
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction(_('Preferences…'), () => this.openPreferences());

        this._settingsSignals = [
            this._settings.connect('changed::subscriptions', () => this._syncSubscriptions()),
            this._settings.connect('changed::notifications-enabled', () => this._syncMute()),
            this._settings.connect('changed::show-panel-icon', () => this._syncPanelIcon()),
            this._settings.connect('changed::server-credentials', () => this._syncSubscriptions()),
            this._settings.connect('changed::credential-retry', () => {
                const [server] = this._settings.get_value('credential-retry').deep_unpack();
                for (const client of this._clients.values()) {
                    if (client.subscription.server === server)
                        client.reconnect();
                }
            }),
        ];
        this._syncPanelIcon();
        this._syncMute();
        this._syncSubscriptions();
    }

    _syncPanelIcon() {
        this._indicator.visible = this._settings.get_boolean('show-panel-icon');
    }

    _syncMute() {
        const enabled = this._settings.get_boolean('notifications-enabled');
        this._notificationToggle.setToggleState(enabled);
        this._icon.opacity = enabled ? 255 : 128;
        this._syncMessageCount();
    }

    _messages(id) {
        return this._history.get(id)?.messages ?? [];
    }

    _syncMessageCount() {
        let count = 0;
        for (const entry of this._history.values())
            count += entry.messages.length;
        this._badge.text = String(count);
        this._badge.visible = count > 0;
        this._clearItem.setSensitive(count > 0);
        const name = this._settings.get_boolean('notifications-enabled')
            ? _('ntfy') : _('ntfy — notifications muted');
        this._indicator.accessible_name = count > 0 ? `${name} — ${_('Messages')} (${count})` : name;
    }

    // Messages belong to one server and topic. Forget them when the
    // subscription is removed or now points somewhere else.
    _pruneHistory(subscriptions) {
        const current = new Map(subscriptions.map(item => [item.id, item]));
        for (const [id, entry] of this._history) {
            const subscription = current.get(id);
            if (!subscription || subscription.server !== entry.server || subscription.topic !== entry.topic)
                this._history.delete(id);
        }
    }

    _clearAll() {
        this._history.clear();
        this._syncMessageCount();
        for (const id of this._statusRows.keys()) {
            this._syncRow(id);
            this._renderMessages(id);
        }
    }

    _clearTopic(id) {
        this._history.delete(id);
        this._syncMessageCount();
        this._syncRow(id);
        this._renderMessages(id);
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
            this._clearRows();
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
        this._pruneHistory(subscriptions);
        this._syncMessageCount();
        // Retain existing status text while replacing menu rows.
        const previous = new Map([...this._statusRows].map(([id, row]) => [id, row.status]));
        this._clearRows();
        if (!subscriptions.length) {
            this._subscriptionsSection.addAction(_('Add a topic in Preferences…'), () => this.openPreferences());
        }
        for (const subscription of subscriptions) {
            this._buildRow(subscription);
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
            const saved = this._replay.get(replayKey(subscription));
            const client = new SubscriptionClient(subscription, {
                since: saved?.since,
                seen: saved?.seen,
                transport,
                schedule: (seconds, callback) => this._timeouts.add(seconds, callback),
                cancelScheduled: id => this._timeouts.remove(id),
                onMessage: message => this._receive(subscription, message),
                onStatus: status => this._setStatus(subscription.id, status),
            });
            client.credentialId = credentialId;
            this._clients.set(subscription.id, client);
            client.start();
        }
        this._saveReplay();
    }

    // Persist where each running subscription stands. Removed and disabled
    // topics are forgotten, so enabling one later starts from the present.
    _saveReplay() {
        const state = new Map();
        for (const client of this._clients.values())
            state.set(replayKey(client.subscription), client.checkpoint);
        const text = serializeReplayState(state);
        if (text === this._replayText)
            return;
        this._replayText = text;
        this._replay = state;
        this._settings.set_string('replay-state', text);
    }

    _buildRow(subscription) {
        const item = new PopupMenu.PopupSubMenuMenuItem(subscription.topic);
        item.label.style_class = 'ntfy-topic-title';
        item.menu.addMenuItem(new PopupMenu.PopupMenuItem(subscription.server, {reactive: false}));
        const statusItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        item.menu.addMenuItem(statusItem);
        item.menu.addAction(_('Open topic'), () => this._openUrl(`${subscription.server}/${subscription.topic}`));
        const clearItem = item.menu.addAction(_('Clear messages'), () => this._clearTopic(subscription.id));
        item.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const messages = new PopupMenu.PopupMenuSection();
        item.menu.addMenuItem(messages);
        // Refresh actors only when the topic is opened. A burst of messages
        // should not rebuild the menu for every message or steal keyboard focus.
        const openId = item.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen)
                this._renderMessages(subscription.id);
        });
        this._subscriptionsSection.addMenuItem(item);
        this._statusRows.set(subscription.id, {
            item, statusItem, clearItem, messages, openId, topic: subscription.topic, statusText: '',
        });
        this._syncRow(subscription.id);
        this._renderMessages(subscription.id);
    }

    _clearRows() {
        for (const row of this._statusRows.values())
            row.item.menu.disconnect(row.openId);
        this._statusRows.clear();
        this._subscriptionsSection.removeAll();
    }

    _syncRow(id) {
        const row = this._statusRows.get(id);
        if (!row)
            return;
        const count = this._messages(id).length;
        const topic = count > 0 ? `${row.topic} (${count})` : row.topic;
        row.item.label.text = row.statusText ? `${topic} — ${row.statusText}` : topic;
        row.statusItem.label.text = row.statusText;
        row.clearItem.setSensitive(count > 0);
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
                : `${status.reason} — ${_('check server or topic')}`;
            text = `${text} — ${_('retrying in')} ${status.seconds}s`;
            break;
        case 'credentials':
            text = `${credentialStatus(status.code, _)} — ${_('retrying in')} ${status.seconds}s`;
            break;
        case 'disabled':
            text = _('Disabled');
            break;
        default:
            text = _('Connecting…');
        }
        row.statusText = text;
        this._syncRow(id);
    }

    _receive(subscription, message) {
        const entry = this._history.get(subscription.id) ??
            {server: subscription.server, topic: subscription.topic, messages: []};
        this._history.set(subscription.id, {...entry, messages: [message, ...entry.messages].slice(0, 20)});
        // Counts update immediately; message actors refresh when the topic opens.
        this._syncMessageCount();
        this._syncRow(subscription.id);
        this._saveReplay();
        if (!this._settings.get_boolean('notifications-enabled'))
            return;
        if (!this._source) {
            const source = new MessageTray.Source({
                title: _('ntfy'),
                icon: this._icon.gicon,
            });
            this._sourceDestroyId = source.connect('destroy', () => {
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

    _wrappedLabel(text, styleClass) {
        const label = new St.Label({text, style_class: styleClass, x_expand: true});
        label.clutter_text.line_wrap = true;
        label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        return label;
    }

    // One card per message. The item stays reactive because Shell paints a
    // non-reactive menu item as insensitive, which dims the text; it has no
    // activation or hover highlight, so selecting it does nothing.
    _messageItem(message) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: true, activate: false, hover: false, can_focus: false, style_class: 'ntfy-message',
        });
        item.track_hover = false;
        const box = new St.BoxLayout({x_expand: true, style_class: 'ntfy-message-box'});
        box.layout_manager.orientation = Clutter.Orientation.VERTICAL;
        const time = GLib.DateTime.new_from_unix_local(message.time);
        if (time) {
            const timestamp = new St.Label({text: time.format('%x %X'), style_class: 'ntfy-message-time'});
            timestamp.opacity = 170;
            box.add_child(timestamp);
        }
        // The topic names this submenu; repeat only a distinct title.
        if (message.title !== message.topic)
            box.add_child(this._wrappedLabel(message.title, 'ntfy-message-title'));
        box.add_child(this._wrappedLabel(message.body, 'ntfy-message-body'));
        item.add_child(box);
        return item;
    }

    _renderMessages(id) {
        const row = this._statusRows.get(id);
        if (!row)
            return;
        row.messages.removeAll();
        const messages = this._messages(id);
        if (!messages.length) {
            row.messages.addMenuItem(new PopupMenu.PopupMenuItem(
                _('New messages will appear here'), {reactive: false}));
            return;
        }
        for (const [index, message] of messages.entries()) {
            if (index > 0)
                row.messages.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            // Sections are always expanded. A submenu here would hide the body
            // behind a second arrow inside the topic.
            const section = new PopupMenu.PopupMenuSection();
            section.addMenuItem(this._messageItem(message));
            if (message.click)
                section.addAction(_('Open link'), () => this._openUrl(message.click));
            row.messages.addMenuItem(section);
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
        if (this._clients && this._settings)
            this._saveReplay();
        for (const client of this._clients?.values() ?? [])
            client.stop();
        this._clients?.clear();
        this._clients = null;
        this._timeouts?.clear();
        this._timeouts = null;
        this._transport?.destroy();
        this._transport = null;
        this._secrets = null;
        for (const id of this._settingsSignals ?? [])
            this._settings.disconnect(id);
        this._settingsSignals = null;
        this._settings = null;
        if (this._source) {
            this._source.disconnect(this._sourceDestroyId);
            this._source.destroy();
        }
        this._source = null;
        this._sourceDestroyId = null;
        // Destroy menu items and panel children explicitly; each removes itself
        // from its parent. The indicator then destroys the remaining menu tree.
        if (this._statusRows && this._subscriptionsSection)
            this._clearRows();
        this._subscriptionsSection?.destroy();
        this._notificationToggle?.destroy();
        this._badge?.destroy();
        this._icon?.destroy();
        this._indicator?.destroy();
        this._indicator = null;
        this._statusRows?.clear();
        this._statusRows = null;
        this._history = null;
        this._replay = null;
        this._replayText = null;
        this._icon = null;
        this._badge = null;
        this._notificationToggle = null;
        this._subscriptionsSection = null;
        this._clearItem = null;
    }
}
