// SPDX-License-Identifier: GPL-3.0-only

import Gio from 'gi://Gio';
import Secret from 'gi://Secret';

import {CredentialError, normalizeToken, tokenServer} from './auth.js';
import {normalizeServer} from './config.js';

function call(start, finish) {
    return new Promise((resolve, reject) => {
        start((source, result) => {
            try {
                resolve(finish(source, result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

export class SecretStore {
    constructor() {
        this._schema = new Secret.Schema('org.gnome.shell.extensions.ntfy.Token', Secret.SchemaFlags.NONE, {
            server: Secret.SchemaAttributeType.STRING,
            credential: Secret.SchemaAttributeType.STRING,
        });
    }

    _operation(work) {
        const cancellable = new Gio.Cancellable();
        const promise = work(cancellable).catch(error => {
            if (error instanceof CredentialError)
                throw error;
            if (cancellable.is_cancelled())
                throw new CredentialError('cancelled');
            if (error.matches?.(Secret.Error, Secret.Error.IS_LOCKED))
                throw new CredentialError('keyring-locked');
            // Raw DBus errors may contain identifying attributes. Expose only
            // fixed error codes to the UI and never log credential operations.
            throw new CredentialError('keyring-unavailable');
        });
        return {promise, cancel: () => cancellable.cancel()};
    }

    async _find(server, credential, cancellable, unlock = false) {
        const service = await call(
            callback => Secret.Service.get(Secret.ServiceFlags.OPEN_SESSION, cancellable, callback),
            (_source, result) => Secret.Service.get_finish(result));
        return call(
            callback => service.search(this._schema, {server: normalizeServer(server), credential},
                Secret.SearchFlags.ALL | (unlock ? Secret.SearchFlags.UNLOCK : Secret.SearchFlags.NONE),
                cancellable, callback),
            (source, result) => source.search_finish(result));
    }

    lookup(server, credential, {unlock = false} = {}) {
        return this._operation(async cancellable => {
            tokenServer(server);
            const items = await this._find(server, credential, cancellable, unlock);
            const item = items[0];
            if (!item)
                throw new CredentialError('token-missing');
            if (item.get_locked())
                throw new CredentialError('keyring-locked');
            await call(callback => item.load_secret(cancellable, callback),
                (source, result) => source.load_secret_finish(result));
            return normalizeToken(item.get_secret()?.get_text());
        });
    }

    store(server, credential, value) {
        return this._operation(async cancellable => {
            const origin = tokenServer(server);
            const token = normalizeToken(value);
            const saved = await call(
                callback => Secret.password_store(this._schema, {server: origin, credential},
                    Secret.COLLECTION_DEFAULT, `ntfy — ${origin}`, token, cancellable, callback),
                (_source, result) => Secret.password_store_finish(result));
            if (!saved)
                throw new CredentialError('keyring-locked');
        });
    }

    remove(server, credential) {
        return this._operation(async cancellable => {
            const items = await this._find(server, credential, cancellable);
            // password_clear silently skips locked items. Keep the reference
            // until explicit deletion succeeds instead of claiming removal.
            if (items.some(item => item.get_locked()))
                throw new CredentialError('keyring-locked');
            for (const item of items) {
                await call(callback => item.delete(cancellable, callback),
                    (source, result) => source.delete_finish(result));
            }
        });
    }
}
