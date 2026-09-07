import assert from 'node:assert/strict';
import test from 'node:test';
import {AuthenticatedTransport, CredentialError, normalizeToken, parseCredentials, tokenServer} from '../lib/auth.js';
import {TokenSettings} from '../lib/tokenSettings.js';

const server = 'https://notify.example.org';
const token = 'tk_fixture_only';
const completed = value => ({promise: Promise.resolve(value), cancel() {}});

test('token fields accept raw bearer tokens and reject header injection', () => {
    assert.equal(normalizeToken(` ${token} `), token);
    for (const value of ['', null, 'Bearer tk_example', 'tk_a\r\nX-Header: bad', 'a'.repeat(513)])
        assert.throws(() => normalizeToken(value), CredentialError);
});

test('authenticated connections require HTTPS except explicit loopback servers', () => {
    assert.equal(tokenServer('https://ntfy.jabali-panel.com/'), 'https://ntfy.jabali-panel.com');
    for (const value of ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080'])
        assert.equal(tokenServer(value), value);
    for (const value of ['http://notify.example.org', 'http://localhost.evil.example', 'http://192.168.1.2'])
        assert.throws(() => tokenServer(value), error => error.code === 'https-required');
});

test('settings hold canonical origins and opaque references only', () => {
    assert.equal(parseCredentials({[server]: 'credential-1'})[server], 'credential-1');
    assert.throws(() => parseCredentials({[`${server}/`]: 'id'}));
    assert.throws(() => parseCredentials({[server]: {token}}));
    assert.throws(() => parseCredentials({[server]: ''}));
});

test('public subscriptions never access the keyring', async () => {
    let called = false;
    const transport = new AuthenticatedTransport({open(url, accessToken) {
        called = true;
        assert.equal(accessToken, undefined);
        return {response: Promise.resolve(url), cancel() {}};
    }}, {lookup() { throw new Error('keyring must not be called'); }}, server);
    assert.equal(await transport.open(`${server}/topic/json`).response, `${server}/topic/json`);
    assert.equal(called, true);
});

test('protected requests fetch the correct server token without putting it in the URL', async () => {
    const lookedUp = [];
    const requests = [];
    const transport = new AuthenticatedTransport({open(url, accessToken) {
        requests.push({url, accessToken});
        return {response: Promise.resolve({status: 200}), cancel() {}};
    }}, {lookup(origin, id) {
        lookedUp.push({origin, id});
        return completed(token);
    }}, server, 'credential-1');
    await transport.open(`${server}/topic/json?since=123`).response;
    assert.deepEqual(lookedUp, [{origin: server, id: 'credential-1'}]);
    assert.equal(requests[0].accessToken, token);
    assert.equal(requests[0].url.includes(token), false);
    assert.throws(() => transport.open('https://other.example.org/topic/json'), CredentialError);
    assert.throws(() => transport.open(`${server}.evil.example/topic/json`), CredentialError);
    assert.equal(lookedUp.length, 1);
});

test('missing and locked tokens never fall back to anonymous requests', async () => {
    for (const code of ['token-missing', 'keyring-locked', 'keyring-unavailable']) {
        let networkRequests = 0;
        const transport = new AuthenticatedTransport({open() { networkRequests++; }}, {
            lookup() { return {promise: Promise.reject(new CredentialError(code)), cancel() {}}; },
        }, server, 'credential-1');
        await assert.rejects(transport.open(`${server}/topic/json`).response, error => error.code === code);
        assert.equal(networkRequests, 0);
    }
});

test('cancelling a pending keyring lookup prevents late network requests', async () => {
    let resolve;
    let cancelled = false;
    let networkRequests = 0;
    const transport = new AuthenticatedTransport({open() { networkRequests++; }}, {
        lookup() {
            return {promise: new Promise(done => { resolve = done; }), cancel() { cancelled = true; }};
        },
    }, server, 'credential-1');
    const operation = transport.open(`${server}/topic/json`);
    operation.cancel();
    resolve(token);
    await assert.rejects(operation.response, error => error.code === 'cancelled');
    assert.equal(cancelled, true);
    assert.equal(networkRequests, 0);
});

test('cancelling after authentication cancels the network stream', async () => {
    let cancelled = false;
    const transport = new AuthenticatedTransport({open() {
        return {response: Promise.resolve({status: 200}), cancel() { cancelled = true; }};
    }}, {lookup: () => completed(token)}, server, 'credential-1');
    const operation = transport.open(`${server}/topic/json`);
    await operation.response;
    operation.cancel();
    assert.equal(cancelled, true);
});

function tokenSettings({storeError = false, writeError = false} = {}) {
    let saved = {[server]: 'old-id', 'https://other.example.org': 'other-id'};
    const calls = [];
    const manager = new TokenSettings({
        read: () => saved,
        write: value => {
            if (writeError)
                throw new Error('settings not writable');
            saved = value;
            calls.push(['write', value]);
        },
        newId: () => 'new-id',
        secrets: {
            store(origin, id, value) {
                calls.push(['store', origin, id, value]);
                return {promise: storeError ? Promise.reject(new CredentialError('keyring-unavailable')) : Promise.resolve(), cancel() {}};
            },
            remove(origin, id) {
                calls.push(['remove', origin, id]);
                return completed();
            },
        },
    });
    return {manager, calls, read: () => saved};
}

test('replacement stores the new secret before publishing its reference and deleting the old one', async () => {
    const h = tokenSettings();
    await h.manager.save(server, token);
    assert.deepEqual(h.calls.map(call => call[0]), ['store', 'write', 'remove']);
    assert.equal(h.read()[server], 'new-id');
    assert.equal(h.read()['https://other.example.org'], 'other-id');
    assert.equal(JSON.stringify(h.read()).includes(token), false);
    assert.deepEqual(h.calls.at(-1), ['remove', server, 'old-id']);
});

test('keyring failure preserves the previous token reference', async () => {
    const h = tokenSettings({storeError: true});
    await assert.rejects(h.manager.save(server, token));
    assert.equal(h.read()[server], 'old-id');
    assert.equal(h.calls.some(call => call[0] === 'write'), false);
});

test('settings failure removes the newly stored secret and retains the old reference', async () => {
    const h = tokenSettings({writeError: true});
    await assert.rejects(h.manager.save(server, token));
    assert.equal(h.read()[server], 'old-id');
    assert.deepEqual(h.calls.at(-1), ['remove', server, 'new-id']);
});

test('removing a server token preserves every other server', async () => {
    const h = tokenSettings();
    await h.manager.remove(server);
    assert.equal(h.read()[server], undefined);
    assert.equal(h.read()['https://other.example.org'], 'other-id');
    assert.deepEqual(h.calls[0], ['remove', server, 'old-id']);
});
