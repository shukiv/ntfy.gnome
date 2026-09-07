import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

// Exercise the real history renderer without a running Shell. These doubles
// model menu visibility and actions, not St allocation or visual appearance.
class Menu {
    items = [];
    isOpen = true;
    removeAll() { this.items = []; }
    addMenuItem(item) { this.items.push(item); }
    addAction(text, action) {
        const item = new Item(text);
        item.action = action;
        this.addMenuItem(item);
        return item;
    }
}
class Item {
    constructor(text, params = {}) {
        this.label = {text, clutter_text: {}};
        Object.assign(this, params);
    }
}
class Submenu extends Item {
    constructor(text) {
        super(text);
        this.menu = new Menu();
        this.menu.isOpen = false;
    }
}
class Section extends Menu {}

const PopupMenu = {
    PopupMenuItem: Item,
    PopupSubMenuMenuItem: Submenu,
    PopupMenuSection: Section,
    PopupSeparatorMenuItem: class extends Item {},
};
// Replace imports at the host boundary; execute the unchanged extension class.
const source = readFileSync(new URL('../extension.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '')
    .replace('export default class', 'class');
const Extension = runInNewContext(`${source}\nNtfyExtension;`, {
    Extension: class {}, PopupMenu, _: text => text,
    GLib: {DateTime: {new_from_unix_local: time => ({format: () => `time:${time}`})}},
    Pango: {WrapMode: {WORD_CHAR: 'word-char'}, EllipsizeMode: {NONE: 'none'}},
});

function visibleItems(menu) {
    return menu.items.flatMap(item => [item,
        ...(item instanceof Section ? visibleItems(item) : []),
        ...(item.menu?.isOpen ? visibleItems(item.menu) : []),
    ]);
}

function render(messages) {
    const extension = new Extension();
    const opened = [];
    extension._history = messages;
    extension._recentMenu = new Submenu('Recent messages');
    extension._recentMenu.menu.isOpen = true;
    extension._clearItem = {setSensitive(value) { this.sensitive = value; }};
    extension._openUrl = url => opened.push(url);
    extension._renderHistory();
    return {extension, opened, items: visibleItems(extension._recentMenu.menu)};
}

const message = {
    topic: 'jabali-backups', title: 'jabali-backups',
    body: 'Backup complete.\nשלום — <b>literal text</b>\n' + 'x'.repeat(1500),
    time: 1788778800, server: 'https://notify.example.org', click: null,
};

test('opening Recent messages exposes the complete body without another expansion', () => {
    const {items} = render([message]);
    const body = items.find(item => item.label?.text === message.body);
    assert.ok(body, 'Message body must be visible after opening Recent messages');
    assert.equal(body.label.clutter_text.line_wrap, true);
    assert.equal(body.label.clutter_text.line_wrap_mode, 'word-char');
    assert.equal(body.label.clutter_text.ellipsize, 'none');
    assert.equal(items.filter(item => item.label?.text === message.topic).length, 1);
    assert.ok(!items.some(item => item instanceof Submenu));
});

test('history retains message order, timestamps and explicit browser actions', () => {
    const newest = {...message, body: 'New message', title: 'Finished',
        click: 'https://example.org/report', time: message.time + 1};
    const {items, opened} = render([newest, message]);
    const texts = items.map(item => item.label?.text);
    assert.ok(texts.indexOf(newest.body) < texts.indexOf(message.body));
    assert.ok(texts.includes('jabali-backups: Finished'));
    assert.ok(texts.includes(`time:${newest.time}`));
    assert.deepEqual(opened, []);
    items.find(item => item.label?.text === 'Open link').action();
    items.find(item => item.label?.text === 'Open topic').action();
    assert.deepEqual(opened, [newest.click, `${newest.server}/${newest.topic}`]);
});

test('clearing history removes old message rows and disables the clear action', () => {
    const {extension} = render([message]);
    extension._history = [];
    extension._renderHistory();
    assert.equal(extension._clearItem.sensitive, false);
    assert.equal(extension._recentMenu.label.text, 'Recent messages (0)');
    const items = visibleItems(extension._recentMenu.menu);
    assert.deepEqual(items.map(item => item.label.text), ['New messages will appear here']);
});
