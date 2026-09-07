import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {MAX_SUBSCRIPTIONS, normalizeSubscription, parseSubscriptions} from './lib/config.js';

export default class NtfyPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(620, 680);
        const page = new Adw.PreferencesPage({
            title: _('ntfy'),
            icon_name: 'preferences-system-notifications-symbolic',
        });
        window.add(page);

        const notifications = new Adw.PreferencesGroup({title: _('Notifications')});
        const showNotifications = new Adw.SwitchRow({
            title: _('Desktop notifications'),
            subtitle: _('When off, messages still appear in the panel menu. Do Not Disturb is respected.'),
        });
        settings.bind('notifications-enabled', showNotifications, 'active', Gio.SettingsBindFlags.DEFAULT);
        notifications.add(showNotifications);
        page.add(notifications);

        const subscriptionsGroup = new Adw.PreferencesGroup({title: _('Subscriptions')});
        page.add(subscriptionsGroup);
        let rows = [];
        const read = () => parseSubscriptions(settings.get_string('subscriptions'));
        const save = subscriptions => {
            const validated = parseSubscriptions(JSON.stringify(subscriptions));
            if (!settings.set_string('subscriptions', JSON.stringify(validated)))
                throw new Error(_('Could not save subscriptions.'));
        };

        const addGroup = new Adw.PreferencesGroup({
            title: _('Add a subscription'),
            description: _('Public topics on ntfy.sh or your own server. Anyone with access to a public topic can read or publish messages; choose a hard-to-guess name.'),
        });
        const server = new Adw.EntryRow({title: _('Server URL'), text: 'https://ntfy.sh'});
        const topic = new Adw.EntryRow({title: _('Topic')});
        const addButton = new Gtk.Button({
            label: _('Subscribe'),
            css_classes: ['suggested-action'],
            valign: Gtk.Align.CENTER,
        });
        const addRow = new Adw.ActionRow({
            title: _('Start receiving messages'),
            subtitle: _('Server example: https://ntfy.sh or http://localhost:8080'),
        });
        addRow.add_suffix(addButton);
        addRow.activatable_widget = addButton;
        addGroup.add(server);
        addGroup.add(topic);
        addGroup.add(addRow);
        page.add(addGroup);

        const showError = error => {
            addRow.title = _('Could not save subscription');
            addRow.subtitle = error.message;
        };
        const render = () => {
            for (const row of rows)
                subscriptionsGroup.remove(row);
            rows = [];
            let subscriptions;
            try {
                subscriptions = read();
                addButton.sensitive = subscriptions.length < MAX_SUBSCRIPTIONS;
            } catch (error) {
                subscriptionsGroup.description = `${_('Saved settings need attention:')} ${error.message}`;
                addButton.sensitive = false;
                return;
            }
            subscriptionsGroup.description = subscriptions.length
                ? _('Changes take effect immediately. Disable a topic to stop its connection.')
                : _('No subscriptions yet. Add your first topic below.');
            for (const subscription of subscriptions) {
                const row = new Adw.ActionRow({
                    title: subscription.topic,
                    subtitle: subscription.server,
                    use_markup: false,
                });
                const enabled = new Gtk.Switch({
                    active: subscription.enabled,
                    valign: Gtk.Align.CENTER,
                    tooltip_text: `${_('Receive messages from')} ${subscription.topic}`,
                });
                row.activatable_widget = enabled;
                enabled.connect('notify::active', () => {
                    try {
                        save(read().map(item => item.id === subscription.id ? {...item, enabled: enabled.active} : item));
                    } catch (error) {
                        showError(error);
                    }
                });
                const remove = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    css_classes: ['flat'],
                    valign: Gtk.Align.CENTER,
                    tooltip_text: `${_('Remove subscription')} ${subscription.topic}`,
                });
                remove.connect('clicked', () => {
                    try {
                        save(read().filter(item => item.id !== subscription.id));
                        const toast = new Adw.Toast({title: _('Subscription removed'), button_label: _('Undo')});
                        toast.connect('button-clicked', () => {
                            try {
                                save([...read(), subscription]);
                            } catch (error) {
                                showError(error);
                            }
                        });
                        window.add_toast(toast);
                    } catch (error) {
                        showError(error);
                    }
                });
                row.add_suffix(enabled);
                row.add_suffix(remove);
                subscriptionsGroup.add(row);
                rows.push(row);
            }
        };
        const subscribe = () => {
            try {
                const subscription = normalizeSubscription({
                    id: GLib.uuid_string_random(), server: server.text, topic: topic.text, enabled: true,
                });
                // GLib provides the final platform URI check, including IPv6.
                const uri = GLib.Uri.parse(subscription.server, GLib.UriFlags.NONE);
                if (!uri.get_host())
                    throw new Error(_('Enter a valid server hostname.'));
                save([...read(), subscription]);
                server.text = subscription.server;
                topic.text = '';
                addRow.title = _('Subscription added');
                addRow.subtitle = _('Check its connection status in the ntfy panel menu.');
                topic.remove_css_class('error');
                topic.grab_focus();
            } catch (error) {
                topic.add_css_class('error');
                showError(error);
            }
        };
        addButton.connect('clicked', subscribe);
        topic.connect('entry-activated', subscribe);
        const changedId = settings.connect('changed::subscriptions', render);
        window.connect('close-request', () => {
            settings.disconnect(changedId);
            return false;
        });
        render();
    }
}
