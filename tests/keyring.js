import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Secret from 'gi://Secret';
import {SecretStore} from '../lib/secrets.js';

if (GLib.getenv('NTFY_KEYRING_TEST') !== '1')
    throw new Error('Run via tests/with_keyring.py to use a disposable keyring.');
const assert = (condition, message) => {
    if (!condition)
        throw new Error(message);
};
const rejects = async (promise, code) => {
    try {
        await promise;
    } catch (error) {
        assert(error.code === code, `Expected ${code}, got ${error.code}`);
        return;
    }
    throw new Error(`Expected ${code}`);
};
const secrets = new SecretStore();
const server = 'https://notify.example.org';
const id = GLib.uuid_string_random();
const token = 'tk_keyring_fixture_only';
await secrets.store(server, id, token).promise;
assert(await secrets.lookup(server, id).promise === token, 'Stored token did not round-trip');
await rejects(secrets.lookup('https://another.example.org', id).promise, 'token-missing');
await rejects(secrets.lookup(server, 'missing-id').promise, 'token-missing');
const cancelled = secrets.lookup(server, id);
cancelled.cancel();
await rejects(cancelled.promise, 'cancelled');
await secrets.remove(server, id).promise;
await rejects(secrets.lookup(server, id).promise, 'token-missing');

await secrets.store(server, id, token).promise;
const service = await new Promise((resolve, reject) => {
    Secret.Service.get(Secret.ServiceFlags.LOAD_COLLECTIONS, null, (_source, result) => {
        try { resolve(Secret.Service.get_finish(result)); } catch (error) { reject(error); }
    });
});
const collections = service.get_collections();
await new Promise((resolve, reject) => {
    service.lock(collections, null, (source, result) => {
        try { source.lock_finish(result); resolve(); } catch (error) { reject(error); }
    });
});
await rejects(secrets.lookup(server, id).promise, 'keyring-locked');
await rejects(secrets.remove(server, id).promise, 'keyring-locked');
// The whole encrypted keyring is discarded by the runner, including this item.
Gio.DBus.session.flush_sync(null);
print('Real keyring passed: save, read, server isolation, missing token, cancellation, removal, locked state.');
