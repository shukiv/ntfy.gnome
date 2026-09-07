import assert from 'node:assert/strict';
import test from 'node:test';
import {SubscriptionClient} from '../lib/client.js';

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

function harness(responses = []) {
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

test('permanent HTTP failures wait for manual reconnect', async () => {
    for (const status of [301, 302, 400, 401, 403, 404]) {
        const h = harness([{status}]);
        h.client.start();
        await flush();
        assert.equal(h.statuses.at(-1).state, 'error');
        assert.equal(h.statuses.at(-1).reason, `HTTP ${status}`);
        assert.equal(h.timers.size, 0);
        assert.equal(h.requests[0].closed, true);
        h.client.reconnect();
        await flush();
        assert.equal(h.requests.length, 2);
        h.client.stop();
    }
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
