import assert from 'node:assert/strict';
import test from 'node:test';
import {MAX_SEEN, parseReplayState, replayKey, serializeReplayState} from '../lib/replay.js';

const key = 'https://ntfy.sh/alerts';

test('replay state round-trips checkpoints and recent message ids in a stable order', () => {
    const state = new Map([
        ['https://ntfy.sh/zeta', {since: 50, seen: []}],
        [key, {since: 100, seen: ['a', 'b_c-1']}],
    ]);
    const text = serializeReplayState(state);
    assert.equal(text, serializeReplayState(new Map([...state].reverse())));
    assert.deepEqual(parseReplayState(text, 1000), new Map([
        [key, {since: 100, seen: ['a', 'b_c-1']}],
        ['https://ntfy.sh/zeta', {since: 50, seen: []}],
    ]));
    assert.equal(replayKey({server: 'https://ntfy.sh', topic: 'alerts'}), key);
});

test('damaged or hostile replay state is discarded instead of trusted', () => {
    for (const text of ['', 'not json', 'null', '[]', '"text"', '{"a":1}', '{"a":{"since":-1}}',
        '{"a":{"since":1.5}}', '{"a":{"since":"5"}}'])
        assert.equal(parseReplayState(text, 1000).size, 0, text);
    const many = Object.fromEntries(Array.from({length: 101}, (_, i) => [`k${i}`, {since: 1, seen: []}]));
    assert.equal(parseReplayState(JSON.stringify(many), 1000).size, 0);
    const parsed = parseReplayState(JSON.stringify({[key]: {since: 5000, seen: ['ok', 'bad id', 7, 'x'.repeat(129),
        ...Array.from({length: 40}, (_, i) => `id${i}`)]}}), 1000);
    assert.equal(parsed.get(key).since, 999, 'A checkpoint in the future is bounded by the local clock');
    assert.equal(parsed.get(key).seen.length, MAX_SEEN);
    assert.ok(parsed.get(key).seen.every(id => /^[a-zA-Z0-9_-]{1,128}$/.test(id)));
    assert.equal(parsed.get(key).seen.at(-1), 'id39', 'The newest ids are the ones kept');
});
