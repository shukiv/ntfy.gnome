import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {replayKey, serializeReplayState} from '../lib/replay.js';

// Exercise the real history renderer without a running Shell. These doubles
// model menu visibility and actions, not St allocation or visual appearance.
class Menu {
    items = [];
    isOpen = true;
    handlers = [];
    removeAll() { this.items = []; }
    connect(signal, handler) { return this.handlers.push({signal, handler}); }
    disconnect(id) { this.handlers[id - 1] = {signal: null}; }
    open() {
        this.isOpen = true;
        for (const {signal, handler} of this.handlers) {
            if (signal === 'open-state-changed')
                handler(this, true);
        }
    }
    addMenuItem(item) { this.items.push(item); }
    addAction(text, action) {
        const item = new Item(text);
        item.action = action;
        this.addMenuItem(item);
        return item;
    }
}
class Item {
    sensitive = true;
    constructor(text, params = {}) {
        this.label = {text, clutter_text: {}};
        Object.assign(this, params);
    }
    setSensitive(value) { this.sensitive = value; }
}
// St doubles: a label answers the same `.label.text` probes as a menu item.
class Label {
    constructor(params = {}) {
        Object.assign(this, params);
        this.clutter_text = {};
    }
    get label() { return this; }
}
class Box {
    children = [];
    layout_manager = {};
    constructor(params = {}) { Object.assign(this, params); }
    add_child(child) { this.children.push(child); }
}
class BaseItem extends Box {
    sensitive = true;
    setSensitive(value) { this.sensitive = value; }
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
    PopupBaseMenuItem: BaseItem,
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
    Extension: class {}, PopupMenu, _: text => text, replayKey, serializeReplayState,
    St: {Label, BoxLayout: Box},
    Clutter: {Orientation: {VERTICAL: 'vertical'}},
    GLib: {DateTime: {new_from_unix_local: time => ({format: () => `time:${time}`})}},
    Pango: {WrapMode: {WORD_CHAR: 'word-char'}, EllipsizeMode: {NONE: 'none'}},
});

const descendants = widget => (widget.children ?? []).flatMap(child => [child, ...descendants(child)]);

function visibleItems(menu) {
    return menu.items.flatMap(item => [item, ...descendants(item),
        ...(item instanceof Section ? visibleItems(item) : []),
        ...(item.menu?.isOpen ? visibleItems(item.menu) : []),
    ]);
}

const backups = {id: 'sub-backups', server: 'https://notify.example.org', topic: 'jabali-backups', enabled: true};
const support = {id: 'sub-support', server: 'https://notify.example.org', topic: 'jabali-support', enabled: true};

function setup(subscriptions = [backups, support]) {
    const extension = new Extension();
    const opened = [];
    extension._history = new Map();
    extension._statusRows = new Map();
    extension._subscriptionsSection = new Section();
    extension._badge = {text: '0', visible: false};
    extension._indicator = {};
    extension._icon = {};
    extension._notificationToggle = {setToggleState(value) { this.state = value; }};
    const written = [];
    extension._settings = {get_boolean: () => false, set_string: (name, value) => written.push([name, value])};
    extension._clients = new Map();
    extension._replayText = '{}';
    extension._clearItem = new Item('Clear all messages');
    extension._openUrl = url => opened.push(url);
    for (const subscription of subscriptions) {
        extension._buildRow(subscription);
        extension._setStatus(subscription.id, {state: 'connected'});
    }
    extension._syncMessageCount();
    const row = subscription => extension._statusRows.get(subscription.id);
    const open = subscription => {
        row(subscription).item.menu.open();
        return visibleItems(row(subscription).item.menu);
    };
    return {extension, opened, row, open, written};
}

let sequence = 0;
const message = {
    topic: 'jabali-backups', title: 'jabali-backups',
    body: 'Backup complete.\nשלום — <b>literal text</b>\n' + 'x'.repeat(1500),
    time: 1788778800, click: null,
};
const unique = (fields = {}) => ({...message, id: `message-${++sequence}`, ...fields});

test('there is no shared Recent messages row and each topic starts with guidance', () => {
    const {extension, open} = setup();
    assert.equal(extension._recentMenu, undefined);
    const texts = open(backups).map(item => item.label?.text);
    assert.ok(texts.includes(backups.server));
    assert.ok(texts.includes('Open topic'));
    assert.ok(texts.includes('New messages will appear here'));
    assert.ok(!visibleItems(extension._subscriptionsSection).some(item => /Recent messages/.test(item.label?.text)));
});

test('opening a topic exposes its complete message body without another expansion', () => {
    const {extension, open} = setup();
    extension._receive(backups, unique());
    const items = open(backups);
    const body = items.find(item => item.label?.text === message.body);
    assert.ok(body, 'Message body must be visible after opening the topic');
    assert.equal(body.label.clutter_text.line_wrap, true);
    assert.equal(body.label.clutter_text.line_wrap_mode, 'word-char');
    assert.equal(body.label.clutter_text.ellipsize, 'none');
    const card = items.find(item => item instanceof BaseItem);
    assert.equal(card.reactive, true, 'A non-reactive item is painted insensitive and dims the message');
    assert.equal(card.activate, false);
    assert.equal(card.track_hover, false);
    assert.equal(card.children[0].layout_manager.orientation, 'vertical');
    assert.deepEqual(card.children[0].children.map(child => child.style_class),
        ['ntfy-message-time', 'ntfy-message-body']);
    assert.ok(!items.some(item => item instanceof Submenu), 'Messages must not hide behind a second arrow');
    assert.ok(!items.some(item => item.label?.text === message.topic),
        'A title equal to the topic is not repeated inside the topic');
});

test('a topic shows only its own messages', () => {
    const {extension, open} = setup();
    extension._receive(backups, unique({body: 'Backup body'}));
    extension._receive(support, unique({topic: support.topic, title: 'Ticket', body: 'Support body'}));
    const backupTexts = open(backups).map(item => item.label?.text);
    const supportTexts = open(support).map(item => item.label?.text);
    assert.ok(backupTexts.includes('Backup body'));
    assert.ok(!backupTexts.includes('Support body'));
    assert.ok(supportTexts.includes('Support body'));
    assert.ok(supportTexts.includes('Ticket'));
    assert.ok(!supportTexts.includes('Backup body'));
});

test('messages keep newest-first order, timestamps and explicit browser actions', () => {
    const {extension, open, opened} = setup();
    extension._receive(backups, unique());
    extension._receive(backups, unique({body: 'New message', title: 'Finished',
        click: 'https://example.org/report', time: message.time + 1}));
    const items = open(backups);
    const texts = items.map(item => item.label?.text);
    assert.ok(texts.indexOf('New message') < texts.indexOf(message.body));
    assert.ok(texts.includes('Finished'));
    assert.ok(texts.includes(`time:${message.time + 1}`));
    assert.deepEqual(opened, []);
    assert.equal(texts.filter(text => text === 'Open topic').length, 1);
    items.find(item => item.label?.text === 'Open link').action();
    items.find(item => item.label?.text === 'Open topic').action();
    assert.deepEqual(opened, ['https://example.org/report', `${backups.server}/${backups.topic}`]);
});

test('the row label combines topic, message count and connection status', () => {
    const {extension, row} = setup();
    assert.equal(row(backups).item.label.text, 'jabali-backups — Connected');
    extension._receive(backups, unique());
    extension._receive(backups, unique());
    assert.equal(row(backups).item.label.text, 'jabali-backups (2) — Connected');
    extension._setStatus(backups.id, {state: 'retrying', reason: 'No data received', seconds: 4});
    assert.equal(row(backups).item.label.text, 'jabali-backups (2) — Reconnecting (4s)');
    assert.equal(row(support).item.label.text, 'jabali-support — Connected');
});

test('the panel badge sums all topics while desktop notifications are muted', () => {
    const {extension} = setup();
    assert.equal(extension._badge.visible, false);
    assert.equal(extension._clearItem.sensitive, false);
    extension._receive(backups, unique());
    extension._receive(support, unique({topic: support.topic}));
    assert.equal(extension._badge.text, '2');
    assert.equal(extension._badge.visible, true);
    assert.equal(extension._clearItem.sensitive, true);
    assert.equal(extension._indicator.accessible_name, 'ntfy — notifications muted — Messages (2)');
});

test('each topic retains its own last 20 messages and a busy topic cannot displace another', () => {
    const {extension, open} = setup();
    extension._receive(support, unique({topic: support.topic, body: 'Quiet topic'}));
    for (let i = 0; i < 25; i++)
        extension._receive(backups, unique({body: `Burst ${i}`}));
    assert.equal(extension._badge.text, '21');
    const texts = open(backups).map(item => item.label?.text);
    assert.ok(texts.includes('Burst 24'));
    assert.ok(!texts.includes('Burst 4'));
    assert.ok(open(support).some(item => item.label?.text === 'Quiet topic'));
});

test('clearing one topic leaves the others and updates the badge and label', () => {
    const {extension, open, row} = setup();
    extension._receive(backups, unique());
    extension._receive(support, unique({topic: support.topic, body: 'Support body'}));
    const items = open(backups);
    const clear = items.find(item => item.label?.text === 'Clear messages');
    assert.equal(clear.sensitive, true);
    clear.action();
    assert.equal(extension._badge.text, '1');
    assert.equal(row(backups).item.label.text, 'jabali-backups — Connected');
    assert.equal(row(backups).clearItem.sensitive, false);
    const texts = visibleItems(row(backups).item.menu).map(item => item.label?.text);
    assert.ok(texts.includes('New messages will appear here'));
    assert.ok(!texts.includes(message.body));
    assert.ok(open(support).some(item => item.label?.text === 'Support body'));
});

test('clearing all messages empties every topic and hides the badge', () => {
    const {extension, open, row} = setup();
    extension._receive(backups, unique());
    extension._receive(support, unique({topic: support.topic}));
    extension._clearAll();
    assert.equal(extension._badge.visible, false);
    assert.equal(extension._badge.text, '0');
    assert.equal(extension._clearItem.sensitive, false);
    assert.equal(extension._indicator.accessible_name, 'ntfy — notifications muted');
    assert.equal(row(support).item.label.text, 'jabali-support — Connected');
    assert.ok(open(backups).some(item => item.label?.text === 'New messages will appear here'));
});

test('history survives a menu rebuild but not a removed or retargeted subscription', () => {
    const {extension, open} = setup();
    extension._receive(backups, unique({body: 'Kept'}));
    extension._receive(support, unique({topic: support.topic, body: 'Dropped'}));
    const retargeted = {...support, topic: 'other-topic'};
    extension._pruneHistory([backups, retargeted]);
    const oldMenu = extension._statusRows.get(backups.id).item.menu;
    extension._clearRows();
    assert.ok(oldMenu.handlers.every(entry => entry.signal === null), 'Open handlers must be disconnected');
    extension._buildRow(backups);
    extension._buildRow(retargeted);
    extension._syncMessageCount();
    assert.equal(extension._badge.text, '1');
    assert.ok(open(backups).some(item => item.label?.text === 'Kept'));
    assert.ok(!open(retargeted).some(item => item.label?.text === 'Dropped'));
    extension._pruneHistory([]);
    extension._syncMessageCount();
    assert.equal(extension._badge.visible, false);
});

test('changing the notification switch preserves the badge and updates its accessible description', () => {
    const {extension} = setup();
    extension._receive(backups, unique());
    extension._settings.get_boolean = () => true;
    extension._syncMute();
    assert.equal(extension._badge.text, '1');
    assert.equal(extension._badge.visible, true);
    assert.equal(extension._notificationToggle.state, true);
    assert.equal(extension._indicator.accessible_name, 'ntfy — Messages (1)');
    extension._settings.get_boolean = () => false;
    extension._syncMute();
    assert.equal(extension._badge.text, '1');
    assert.equal(extension._notificationToggle.state, false);
    assert.equal(extension._indicator.accessible_name, 'ntfy — notifications muted — Messages (1)');
});

test('replay checkpoints are saved per topic and only when they change', () => {
    const {extension, written} = setup();
    extension._clients.set(backups.id, {subscription: backups, checkpoint: {since: 100, seen: ['a']}});
    extension._clients.set(support.id, {subscription: support, checkpoint: {since: 90, seen: []}});
    extension._saveReplay();
    extension._saveReplay();
    assert.equal(written.length, 1);
    assert.equal(written[0][0], 'replay-state');
    assert.deepEqual(JSON.parse(written[0][1]), {
        'https://notify.example.org/jabali-backups': {since: 100, seen: ['a']},
        'https://notify.example.org/jabali-support': {since: 90, seen: []},
    });
    extension._clients.delete(support.id);
    extension._receive(backups, unique());
    assert.equal(written.length, 2, 'Receiving a message saves; a removed or disabled topic is forgotten');
    assert.deepEqual(Object.keys(JSON.parse(written[1][1])), ['https://notify.example.org/jabali-backups']);
});
