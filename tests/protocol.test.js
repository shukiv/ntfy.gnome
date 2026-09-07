import assert from 'node:assert/strict';
import test from 'node:test';
import {JsonLines, MAX_LINE_BYTES, parseMessage, retryAfterSeconds, retryDelay, SeenMessages} from '../lib/protocol.js';

const event = {id: 'message1', time: 100, event: 'message', topic: 'alerts', message: 'Backup complete'};

test('JSON framing preserves UTF-8 across every possible byte boundary', () => {
    const line = JSON.stringify({...event, message: 'שלום 🌍 café'});
    const bytes = new TextEncoder().encode(`${line}\r\n\n`);
    for (let split = 0; split <= bytes.length; split++) {
        const stream = new JsonLines();
        const lines = [...stream.push(bytes.slice(0, split)), ...stream.push(bytes.slice(split))];
        assert.equal(parseMessage(lines[0], 'alerts').body, 'שלום 🌍 café');
        assert.equal(lines.length, 2);
    }
});

test('multiple messages and partial lines are separated correctly', () => {
    const stream = new JsonLines();
    const encode = text => new TextEncoder().encode(text);
    assert.deepEqual(stream.push(encode('first\nsecond\nthi')), ['first', 'second']);
    assert.deepEqual(stream.push(encode('rd\n')), ['third']);
});

test('oversized unterminated lines are rejected before unbounded buffering', () => {
    const stream = new JsonLines();
    stream.push(new Uint8Array(MAX_LINE_BYTES).fill(65));
    assert.throws(() => stream.push(new Uint8Array([65])));
    assert.throws(() => new JsonLines().push(new Uint8Array(MAX_LINE_BYTES + 2).fill(65)));
});

test('invalid UTF-8 lines do not prevent later valid lines', () => {
    const stream = new JsonLines();
    assert.deepEqual(stream.push(new Uint8Array([0xff, 10, 111, 107, 10])), ['ok']);
});

test('control, malformed and cross-topic messages are ignored', () => {
    for (const data of [null, {}, {...event, event: 'open'}, {...event, event: 'message_delete'},
        {...event, topic: 'other'}, {...event, id: ''}, {...event, message: null},
        {...event, time: -1}, {...event, time: 2.5}, {...event, time: 1e100}])
        assert.equal(parseMessage(JSON.stringify(data), 'alerts'), null);
    assert.equal(parseMessage('not json', 'alerts'), null);
});

test('notification normalization applies safe defaults and size bounds', () => {
    const parsed = parseMessage(JSON.stringify({...event, title: ' ', priority: 99, click: 'file:///tmp'}), 'alerts');
    assert.equal(parsed.title, 'alerts');
    assert.equal(parsed.priority, 3);
    assert.equal(parsed.click, null);
    const long = parseMessage(JSON.stringify({...event, title: 't'.repeat(1000), message: 'm'.repeat(5000)}), 'alerts');
    assert.equal(long.title.length, 256);
    assert.equal(long.body.length, 4096);
});

test('deduplication suppresses repeats and evicts oldest IDs at its bound', () => {
    const seen = new SeenMessages(2);
    assert.equal(seen.accept('a'), true);
    assert.equal(seen.accept('a'), false);
    assert.equal(seen.accept('b'), true);
    assert.equal(seen.accept('c'), true);
    assert.equal(seen.accept('b'), false);
    assert.equal(seen.accept('a'), true);
});

test('retry delay grows and remains capped, with bounded server guidance', () => {
    assert.equal(retryDelay(0, () => 0), 0.75);
    assert.equal(retryDelay(1, () => 1), 2);
    assert.equal(retryDelay(100, () => 1), 60);
    assert.equal(retryAfterSeconds('120', 0), 120);
    assert.equal(retryAfterSeconds('99999', 0), 300);
    assert.equal(retryAfterSeconds('Thu, 01 Jan 1970 00:01:00 GMT', 0), 60);
    assert.equal(retryAfterSeconds('invalid', 0), 0);
});
