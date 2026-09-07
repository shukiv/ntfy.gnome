import {normalizeServer} from './config.js';

export class CredentialError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

export function normalizeToken(value) {
    const token = typeof value === 'string' ? value.trim() : '';
    if (!/^[A-Za-z0-9._~+/-]{1,512}=*$/.test(token) || token.length > 512)
        throw new CredentialError('invalid-token');
    return token;
}

export function tokenServer(value) {
    const server = normalizeServer(value);
    if (!server.startsWith('https://') &&
        !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(server))
        throw new CredentialError('https-required');
    return server;
}

export function parseCredentials(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 100)
        throw new CredentialError('invalid-settings');
    const credentials = Object.create(null);
    for (const [server, id] of Object.entries(value)) {
        if (normalizeServer(server) !== server || typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(id))
            throw new CredentialError('invalid-settings');
        credentials[server] = id;
    }
    return credentials;
}

// This adapter also cancels the credential lookup, before a network request
// exists. A missing/locked credential must never fall back to anonymous access.
export class AuthenticatedTransport {
    constructor(transport, secrets, server, credentialId = null) {
        this._transport = transport;
        this._secrets = secrets;
        this._server = normalizeServer(server);
        this._credentialId = credentialId;
    }

    open(url) {
        if (!url.startsWith(`${this._server}/`))
            throw new CredentialError('wrong-server');
        if (!this._credentialId)
            return this._transport.open(url);
        tokenServer(this._server);
        let lookup = this._secrets.lookup(this._server, this._credentialId);
        let request = null;
        let cancelled = false;
        const response = lookup.promise.then(token => {
            lookup = null;
            if (cancelled)
                throw new CredentialError('cancelled');
            request = this._transport.open(url, normalizeToken(token));
            return request.response;
        });
        return {
            response,
            cancel() {
                cancelled = true;
                lookup?.cancel();
                request?.cancel();
            },
        };
    }
}
