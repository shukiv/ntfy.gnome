import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import {SecretStore} from '../lib/secrets.js';

if (GLib.getenv('NTFY_KEYRING_TEST') !== '1')
    throw new Error('Run via tests/with_keyring.py to use a disposable keyring.');

Gio.resources_register(Gio.Resource.load(ARGV[0]));
const {default: Preferences} = await import('../prefs.js');
const source = Gio.SettingsSchemaSource.new_from_directory(ARGV[1], Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.ntfy', false)});
const assert = (condition, message) => {
    if (!condition)
        throw new Error(message);
};
const tick = () => new Promise(resolve => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    });
});
async function until(predicate) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate())
            return;
        await tick();
    }
    throw new Error('Timed out waiting for preferences operation');
}
function widgets(root) {
    const result = [root];
    for (let child = root.get_first_child(); child; child = child.get_next_sibling())
        result.push(...widgets(child));
    return result;
}

Adw.init();
const window = new Adw.PreferencesWindow();
new Preferences(settings).fillPreferencesWindow(window);
window.present();
await tick();
const find = (type, predicate) => widgets(window).find(widget => widget instanceof type && predicate(widget));
const topic = find(Adw.EntryRow, row => row.title === 'Topic');
const server = find(Adw.EntryRow, row => row.title === 'Server URL');
const subscribe = find(Gtk.Button, button => button.label === 'Subscribe');
assert(topic && server && subscribe, 'Missing subscription controls');
topic.text = 'test-topic';
subscribe.emit('clicked');
await tick();
let saved = JSON.parse(settings.get_string('subscriptions'));
assert(saved.length === 1 && saved[0].topic === 'test-topic', 'Subscription was not saved');
assert(server.text === 'https://ntfy.sh' && topic.text === '', 'Form was not normalized/reset');

// The subscription's key button takes the user directly to its server token.
const access = find(Gtk.Button, button => button.tooltip_text === 'Set server access token');
access.emit('clicked');
await tick();
const tokenPage = window.get_visible_page();
assert(tokenPage.title === 'Access tokens', 'Subscription token button did not open Access tokens');
const tokenField = widgets(tokenPage).find(widget => widget instanceof Adw.PasswordEntryRow);
const tokenServer = widgets(tokenPage).find(widget => widget instanceof Adw.EntryRow && widget.title === 'Server URL');
const saveToken = widgets(tokenPage).find(widget => widget instanceof Gtk.Button && widget.label === 'Save token');
assert(tokenServer.text === 'https://ntfy.sh', 'Token editor did not select the subscription server');
const secrets = new SecretStore();
const readCredentials = () => settings.get_value('server-credentials').deep_unpack();
tokenField.text = 'tk_preferences_fixture';
saveToken.emit('clicked');
assert(tokenField.text === '' && !saveToken.sensitive, 'Token field was not cleared during asynchronous save');
await until(() => saveToken.sensitive);
const firstId = readCredentials()['https://ntfy.sh'];
assert(firstId, 'Token reference was not saved');
assert(!JSON.stringify(readCredentials()).includes('tk_preferences_fixture'), 'Token leaked into GSettings');
assert(await secrets.lookup('https://ntfy.sh', firstId).promise === 'tk_preferences_fixture', 'Token did not reach keyring');
tokenField.text = 'tk_replacement_fixture';
saveToken.emit('clicked');
await until(() => saveToken.sensitive);
const replacementId = readCredentials()['https://ntfy.sh'];
assert(replacementId !== firstId, 'Replacing a token did not change its reference');
assert(await secrets.lookup('https://ntfy.sh', replacementId).promise === 'tk_replacement_fixture', 'Replacement token was not saved');
const tokenRemove = widgets(tokenPage).find(widget => widget instanceof Gtk.Button && widget.tooltip_text === 'Remove token');
tokenRemove.emit('clicked');
await until(() => saveToken.sensitive);
assert(Object.keys(readCredentials()).length === 0, 'Token reference was not removed');
let removed = false;
try { await secrets.lookup('https://ntfy.sh', replacementId).promise; } catch (error) { removed = error.code === 'token-missing'; }
assert(removed, 'Token remained in the keyring after removal');

// Invalid tokens leave configuration untouched and show feedback beside Save.
tokenField.text = 'Bearer not-a-raw-token';
saveToken.emit('clicked');
await until(() => saveToken.sensitive);
assert(Object.keys(readCredentials()).length === 0, 'Invalid token was saved');
assert(widgets(tokenPage).some(widget => widget instanceof Adw.ActionRow && widget.subtitle.includes('without spaces')), 'No inline token validation error');
window.set_visible_page(widgets(window).find(widget => widget instanceof Adw.PreferencesPage && widget.title === 'ntfy'));

topic.text = 'test-topic';
subscribe.emit('clicked');
await tick();
assert(JSON.parse(settings.get_string('subscriptions')).length === 1, 'Duplicate subscription accepted');
assert(find(Adw.ActionRow, row => row.title === 'Could not save subscription'), 'Missing inline error');

let row = find(Adw.ActionRow, item => item.title === 'test-topic');
row.activatable_widget.active = false;
await tick();
saved = JSON.parse(settings.get_string('subscriptions'));
assert(saved[0].enabled === false, 'Topic switch did not update settings');
row = find(Adw.ActionRow, item => item.title === 'test-topic');
const remove = widgets(row).find(widget => widget instanceof Gtk.Button && widget.icon_name === 'user-trash-symbolic');
remove.emit('clicked');
await tick();
assert(settings.get_string('subscriptions') === '[]', 'Remove did not update settings');

settings.set_string('subscriptions', '{broken');
await tick();
assert(!subscribe.sensitive, 'Malformed saved data can be accidentally overwritten');
window.close();
await tick();
