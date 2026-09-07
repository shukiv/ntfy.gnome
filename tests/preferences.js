import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

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
