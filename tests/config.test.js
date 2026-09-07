import assert from 'node:assert/strict';
import test from 'node:test';
import {MAX_SUBSCRIPTIONS, normalizeServer, parseSubscriptions, safeWebUrl} from '../lib/config.js';

const subscription = {id: 'a', server: 'https://ntfy.sh', topic: 'my_alerts-1', enabled: true};

test('canonical origins preserve local ports and IPv6', () => {
    assert.equal(normalizeServer(' HTTPS://NTFY.SH:443/// '), 'https://ntfy.sh');
    assert.equal(normalizeServer('http://localhost:8080/'), 'http://localhost:8080');
    assert.equal(normalizeServer('http://[::1]:8080'), 'http://[::1]:8080');
});

test('server input rejects credentials, paths, query strings and invalid hosts', () => {
    for (const input of ['ntfy.sh', 'file:///tmp', 'https://u:p@ntfy.sh', 'https://ntfy.sh/path',
        'https://ntfy.sh?auth=secret', 'https://ntfy.sh#fragment', 'https://a..b',
        'https://-bad.example', 'http://localhost:65536', 'http://localhost:0',
        'https://ntfy.sh\\@evil.test', 'https://ntfy.sh\n/evil', null])
        assert.throws(() => normalizeServer(input), undefined, String(input));
});

test('subscription validation retains topic case and requires explicit enabled state', () => {
    const [result] = parseSubscriptions(JSON.stringify([{...subscription, topic: ' MyTopic '} ]));
    assert.equal(result.topic, 'MyTopic');
    for (const topic of ['', 'space topic', 'a,b', '../secret', 'x'.repeat(65)])
        assert.throws(() => parseSubscriptions(JSON.stringify([{...subscription, topic}])));
    assert.throws(() => parseSubscriptions(JSON.stringify([{...subscription, enabled: 'false'}])));
});

test('duplicate topics are detected after origin normalization', () => {
    assert.throws(() => parseSubscriptions(JSON.stringify([
        subscription, {...subscription, id: 'b', server: 'https://NTFY.SH:443/'},
    ])));
    assert.equal(parseSubscriptions(JSON.stringify([
        subscription, {...subscription, id: 'b', server: 'https://example.org'},
    ])).length, 2);
    assert.throws(() => parseSubscriptions(JSON.stringify([
        subscription, {...subscription, topic: 'different'},
    ])));
});

test('invalid or oversized saved settings fail without silently discarding records', () => {
    for (const input of ['{', '{}', 'null', '[null]'])
        assert.throws(() => parseSubscriptions(input));
    const many = Array.from({length: MAX_SUBSCRIPTIONS + 1}, (_, i) => ({
        ...subscription, id: `${i}`, topic: `topic${i}`,
    }));
    assert.throws(() => parseSubscriptions(JSON.stringify(many)));
});

test('publisher links allow explicit HTTP(S) and reject dangerous schemes and userinfo', () => {
    assert.equal(safeWebUrl('https://example.org/path?q=test#result'), 'https://example.org/path?q=test#result');
    assert.equal(safeWebUrl('http://localhost:8080/test'), 'http://localhost:8080/test');
    for (const value of ['file:///tmp/script', 'javascript:alert(1)', 'data:text/html,test',
        'https://u:p@example.org/', 'https://example.org/\nabc', '//example.org',
        'https://example.org\\@evil.org', null, 42])
        assert.equal(safeWebUrl(value), null);
});
