// SPDX-License-Identifier: GPL-2.0-or-later

import {CredentialError, normalizeToken, parseCredentials, tokenServer} from './auth.js';

// Commit only a reference to a successfully stored secret. Immutable IDs mean
// replacing a token never changes the value behind an in-flight lookup.
export class TokenSettings {
    constructor({read, write, secrets, newId}) {
        this._read = read;
        this._write = write;
        this._secrets = secrets;
        this._newId = newId;
    }

    async save(server, token, run = operation => operation.promise) {
        const origin = tokenServer(server);
        const value = normalizeToken(token);
        const previous = parseCredentials(this._read())[origin];
        const id = this._newId();
        await run(this._secrets.store(origin, id, value));
        try {
            const latest = parseCredentials(this._read());
            if (latest[origin] !== previous)
                throw new CredentialError('settings-changed');
            this._write(parseCredentials({...latest, [origin]: id}));
        } catch (error) {
            await this._secrets.remove(origin, id).promise.catch(() => {});
            throw error;
        }
        // An obsolete reference is safe to retain if the keyring becomes
        // unavailable during cleanup; it is never used for authentication.
        if (previous)
            await run(this._secrets.remove(origin, previous)).catch(() => {});
    }

    async remove(server, run = operation => operation.promise) {
        const previous = parseCredentials(this._read())[server];
        if (!previous)
            return;
        await run(this._secrets.remove(server, previous));
        const latest = parseCredentials(this._read());
        if (latest[server] !== previous)
            throw new CredentialError('settings-changed');
        delete latest[server];
        this._write(latest);
    }
}
