import assert from 'node:assert/strict';
import test from 'node:test';
import {SubscriptionClient} from '../lib/client.js';
import {CredentialError} from '../lib/auth.js';

const subscription = {id: 'a', server: 'https://ntfy.sh', topic: 'alerts', enabled: true};
const flush = async () => {
    for (let i = 0; i < 30; i++)
        await Promise.resolve();
};
const event = (id, time = 101, topic = 'alerts') => JSON.stringify({
    id, time, topic, event: 'message', message: `Message ${id}`,
});
const chunk = (...lines) => new TextEncoder().encode(`${lines.join('\n')}\n`);
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return {promise, resolve, reject};
};

function harness(responses = [], options = {}) {
    const timers = new Map();
    const requests = [];
    const messages = [];
    const statuses = [];
    let clock = 200_000;
    let nextTimer = 0;
    const transport = {
        open(url) {
            const fixture = responses.shift() ?? {};
            const reads = [...(fixture.chunks ?? [])];
            const request = {url, cancelled: false, closed: false};
            request.cancel = () => { request.cancelled = true; fixture.cancel?.(); };
            request.response = fixture.response ?? Promise.resolve({
                status: fixture.status ?? 200,
                retryAfter: fixture.retryAfter,
                read: fixture.read ?? (async () => reads.shift() ?? null),
                close: async () => { request.closed = true; },
            });
            requests.push(request);
            return request;
        },
    };
    const client = new SubscriptionClient(subscription, {
        transport,
        schedule: (seconds, callback) => {
            const id = ++nextTimer;
            timers.set(id, {seconds, callback});
            return id;
        },
        cancelScheduled: id => timers.delete(id),
        now: () => clock,
        random: () => 1,
        onMessage: message => messages.push(message),
        onStatus: status => statuses.push(status),
        ...options,
    });
    const retry = async () => {
        const [id, timer] = timers.entries().next().value;
        timers.delete(id);
        timer.callback();
        await flush();
    };
    return {client, timers, requests, messages, statuses, retry,
        advanceTime: milliseconds => { clock += milliseconds; }};
}

test('disconnect retries with overlapping checkpoint and suppresses duplicate delivery', async () => {
    const h = harness([
        {chunks: [chunk(event('a', 200), event('b', 200), '{invalid')]},
        {chunks: [chunk(event('b', 200), event('c', 200))]},
    ]);
    h.client.start();
    await flush();
    assert.deepEqual(h.messages.map(m => m.id), ['a', 'b']);
    assert.equal(h.timers.values().next().value.seconds, 1);
    await h.retry();
    assert.deepEqual(h.messages.map(m => m.id), ['a', 'b', 'c']);
    assert.match(h.requests[1].url, /since=199$/);
    assert.equal(h.requests[0].closed, true);
    assert.equal(h.timers.values().next().value.seconds, 2);
    h.client.stop();
});

test('replay advances to one second before last received message without clock poisoning', async () => {
    const h = harness([
        {chunks: [chunk(event('a', 250))]},
        {chunks: [chunk(event('future', 9_999_999))]},
        {},
    ]);
    h.advanceTime(100_000);
    h.client.start();
    await flush();
    await h.retry();
    assert.match(h.requests[1].url, /since=249$/);
    await h.retry();
    assert.match(h.requests[2].url, /since=299$/);
    h.client.stop();
});

test('HTTP 3xx/4xx failures keep retrying on a slow schedule that spares the server', async () => {
    for (const status of [301, 302, 400, 401, 403, 404]) {
        const h = harness([{status}, {status}, {status}, {status}, {status}, {chunks: [chunk(event('ok'))]}]);
        h.client.start();
        await flush();
        const delays = [];
        for (let i = 0; i < 5; i++) {
            assert.deepEqual(h.statuses.at(-1), {state: 'error', reason: `HTTP ${status}`,
                seconds: h.timers.values().next().value.seconds});
            assert.equal(h.requests.at(-1).closed, true);
            assert.equal(h.timers.size, 1);
            delays.push(h.timers.values().next().value.seconds);
            await h.retry();
        }
        assert.deepEqual(delays, [30, 60, 120, 240, 300]);
        assert.equal(h.requests.length, 6);
        assert.deepEqual(h.messages.map(m => m.id), ['ok']);
        h.client.stop();
    }
});

test('manual reconnect after an HTTP error retries at once and restarts the schedule', async () => {
    const h = harness([{status: 403}, {status: 403}]);
    h.client.start();
    await flush();
    await h.retry();
    assert.equal(h.timers.values().next().value.seconds, 60);
    h.client.reconnect();
    await flush();
    assert.equal(h.requests.length, 3);
    h.client.stop();
    assert.equal(h.timers.size, 0);
});

test('rate limiting honors Retry-After and transient server failures retry', async () => {
    for (const status of [408, 429, 500, 503]) {
        const h = harness([{status, retryAfter: '120'}]);
        h.client.start();
        await flush();
        assert.equal(h.timers.values().next().value.seconds, 120);
        assert.equal(h.statuses.at(-1).state, 'retrying');
        h.client.stop();
    }
});

test('stop cancels pending connection and ignores late completion', async () => {
    const pending = deferred();
    const h = harness([{response: pending.promise}]);
    h.client.start();
    h.client.stop();
    let closed = false;
    pending.resolve({status: 200, close: async () => { closed = true; }});
    await flush();
    assert.equal(closed, true);
    assert.equal(h.requests[0].cancelled, true);
    assert.equal(h.statuses.length, 1);
    assert.equal(h.timers.size, 0);
});

test('stop during read prevents late messages, UI callbacks and retries', async () => {
    const pending = deferred();
    const h = harness([{read: () => pending.promise}]);
    h.client.start();
    await flush();
    h.client.stop();
    const count = h.statuses.length;
    pending.resolve(chunk(event('late')));
    await flush();
    assert.equal(h.messages.length, 0);
    assert.equal(h.statuses.length, count);
    assert.equal(h.timers.size, 0);
    assert.equal(h.requests[0].closed, true);
});

test('stop during backoff removes the timer and stale callbacks do nothing', async () => {
    const h = harness();
    h.client.start();
    await flush();
    const stale = h.timers.values().next().value.callback;
    h.client.stop();
    assert.equal(h.timers.size, 0);
    stale();
    await flush();
    assert.equal(h.requests.length, 1);
});

test('manual reconnect cannot let an old request replace the new stream', async () => {
    const first = deferred();
    const second = deferred();
    const h = harness([{response: first.promise}, {response: second.promise}]);
    h.client.start();
    h.client.reconnect();
    first.reject(new Error('cancelled'));
    await flush();
    h.client.stop();
    assert.equal(h.requests[1].cancelled, true);
    second.reject(new Error('cancelled'));
    await flush();
    assert.equal(h.timers.size, 0);
});

test('simultaneous clients keep independent duplicate caches', async () => {
    const first = harness([{chunks: [chunk(event('same'))]}]);
    const second = harness([{chunks: [chunk(event('same'))]}]);
    first.client.start();
    second.client.start();
    await flush();
    assert.equal(first.messages.length, 1);
    assert.equal(second.messages.length, 1);
    first.client.stop();
    second.client.stop();
});

test('credential errors show an actionable state and keep retrying until the keyring answers', async () => {
    for (const code of ['keyring-locked', 'token-missing', 'keyring-unavailable']) {
        const first = deferred();
        const second = deferred();
        const h = harness([{response: first.promise}, {response: second.promise}, {chunks: [chunk(event('ok'))]}]);
        h.client.start();
        first.reject(new CredentialError(code));
        await flush();
        assert.deepEqual(h.statuses.at(-1), {state: 'credentials', code, seconds: 1});
        assert.equal(h.timers.size, 1);
        const retrying = h.retry();
        second.reject(new CredentialError(code));
        await retrying;
        assert.deepEqual(h.statuses.at(-1), {state: 'credentials', code, seconds: 2});
        await h.retry();
        assert.ok(h.statuses.some(status => status.state === 'connected'));
        assert.deepEqual(h.messages.map(m => m.id), ['ok']);
        h.client.stop();
        assert.equal(h.timers.size, 0);
    }
});

test('replacing the authenticated transport retains the replay checkpoint and deduplication', async () => {
    const h = harness([{chunks: [chunk(event('one', 250))]}]);
    h.advanceTime(100_000);
    h.client.start();
    await flush();
    let opened;
    const chunks = [chunk(event('one', 250), event('two', 251))];
    h.client.setTransport({open(url) {
        opened = url;
        return {response: Promise.resolve({status: 200,
            read: async () => chunks.shift() ?? null, close: async () => {}}), cancel() {}};
    }});
    await flush();
    assert.match(opened, /since=249$/);
    assert.deepEqual(h.messages.map(message => message.id), ['one', 'two']);
    h.client.stop();
});

test('a stream with no data before the idle timeout is cancelled and retried', async () => {
    const pending = deferred();
    const h = harness([
        {read: () => pending.promise, cancel: () => pending.reject(new Error('cancelled'))},
        {chunks: [chunk(event('after'))]},
    ], {idleTimeout: 120});
    h.client.start();
    await flush();
    assert.equal(h.statuses.at(-1).state, 'connected');
    assert.equal(h.timers.size, 1);
    assert.equal(h.timers.values().next().value.seconds, 120);
    await h.retry();
    assert.equal(h.requests[0].cancelled, true);
    assert.equal(h.requests[0].closed, true);
    assert.equal(h.statuses.at(-1).state, 'retrying');
    assert.equal(h.statuses.at(-1).reason, 'No data received');
    assert.equal(h.timers.size, 1);
    await h.retry();
    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.messages.map(m => m.id), ['after']);
    h.client.stop();
    assert.equal(h.timers.size, 0);
});

test('every received chunk re-arms the idle watchdog and keepalives count as data', async () => {
    const reads = [deferred(), deferred(), deferred()];
    let index = 0;
    const h = harness([{read: () => reads[index++].promise}], {idleTimeout: 120});
    h.client.start();
    await flush();
    const first = h.timers.keys().next().value;
    reads[0].resolve(chunk('{"event":"keepalive"}'));
    await flush();
    const second = h.timers.keys().next().value;
    assert.notEqual(first, second);
    assert.equal(h.timers.size, 1);
    reads[1].resolve(chunk(event('x')));
    await flush();
    assert.equal(h.timers.size, 1);
    assert.notEqual(h.timers.keys().next().value, second);
    assert.equal(h.messages.length, 1);
    h.client.stop();
    assert.equal(h.timers.size, 0);
});

test('a stalled response header wait is also covered by the idle watchdog', async () => {
    const pending = deferred();
    const h = harness([{response: pending.promise, cancel: () => pending.reject(new Error('cancelled'))}],
        {idleTimeout: 120});
    h.client.start();
    await flush();
    assert.equal(h.timers.size, 1);
    await h.retry();
    assert.equal(h.requests[0].cancelled, true);
    assert.equal(h.statuses.at(-1).state, 'retrying');
    assert.equal(h.statuses.at(-1).reason, 'No data received');
    h.client.stop();
});

test('a stale idle watchdog from a stopped stream never cancels the replacement', async () => {
    const pending = deferred();
    const h = harness([{read: () => pending.promise}, {read: () => new Promise(() => {})}], {idleTimeout: 120});
    h.client.start();
    await flush();
    h.client.reconnect();
    await flush();
    assert.equal(h.requests.length, 2);
    assert.equal(h.timers.size, 1);
    pending.resolve(null);
    await flush();
    assert.equal(h.timers.size, 1);
    assert.equal(h.requests[1].cancelled, false);
    h.client.stop();
    assert.equal(h.timers.size, 0);
});

test('a saved checkpoint replays messages missed while the client did not exist', async () => {
    const h = harness([{chunks: [chunk(event('old', 150), event('missed', 160))]}], {since: 149, seen: ['old']});
    h.client.start();
    await flush();
    assert.match(h.requests[0].url, /since=149$/);
    assert.deepEqual(h.messages.map(m => m.id), ['missed'], 'A message shown before the restart is not repeated');
    assert.deepEqual(h.client.checkpoint, {since: 159, seen: ['old', 'missed']});
    h.client.stop();
});

test('a checkpoint is available before any message and rejects invalid saved values', async () => {
    const fresh = harness();
    assert.deepEqual(fresh.client.checkpoint, {since: 199, seen: []});
    for (const since of [-1, 1.5, '149', null, 10_000_000]) {
        const h = harness([], {since});
        assert.equal(h.client.checkpoint.since, 199, String(since));
    }
});

test('the checkpoint keeps only the newest message ids', async () => {
    const events = Array.from({length: 30}, (_, i) => event(`m${i}`, 150));
    const h = harness([{chunks: [chunk(...events)]}]);
    h.client.start();
    await flush();
    const {seen} = h.client.checkpoint;
    assert.equal(seen.length, 20);
    assert.equal(seen[0], 'm10');
    assert.equal(seen.at(-1), 'm29');
    h.client.stop();
});

test('a watchdog stall during the keyring lookup is not reported as a credential error', async () => {
    const pending = deferred();
    const h = harness([{response: pending.promise, cancel: () => pending.reject(new CredentialError('cancelled'))}],
        {idleTimeout: 120});
    h.client.start();
    await flush();
    await h.retry();
    assert.deepEqual(h.statuses.at(-1), {state: 'retrying', reason: 'No data received', seconds: 1});
    h.client.stop();
});
