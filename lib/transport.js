import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {normalizeToken, tokenServer} from './auth.js';

export class SoupTransport {
    constructor() {
        this._session = new Soup.Session({
            user_agent: 'ntfy-gnome/0.2',
            timeout: 90,
            max_conns: 24,
            max_conns_per_host: 24,
        });
    }

    open(url, token = null) {
        const cancellable = new Gio.Cancellable();
        const message = Soup.Message.new('GET', url);
        if (!message)
            throw new Error('Invalid subscription URL');
        // Redirects should be fixed in preferences; don't silently move topics
        // or authorization headers to a different origin.
        message.add_flags(Soup.MessageFlags.NO_REDIRECT);
        message.request_headers.append('Accept', 'application/x-ndjson, application/json');
        if (token !== null) {
            const uri = message.get_uri();
            const origin = `${uri.get_scheme()}://${uri.get_host().includes(':') ? `[${uri.get_host()}]` : uri.get_host()}${uri.get_port() > 0 ? `:${uri.get_port()}` : ''}`;
            tokenServer(origin);
            message.request_headers.replace('Authorization', `Bearer ${normalizeToken(token)}`);
        }
        const response = new Promise((resolve, reject) => {
            this._session.send_async(message, GLib.PRIORITY_DEFAULT, cancellable, (session, result) => {
                try {
                    const stream = session.send_finish(result);
                    resolve({
                        status: message.status_code,
                        retryAfter: message.response_headers.get_one('Retry-After'),
                        truncated: message.response_headers.get_one('X-Messages-Truncated') === '1',
                        read: () => new Promise((readResolve, readReject) => {
                            stream.read_bytes_async(8192, GLib.PRIORITY_DEFAULT, cancellable, (input, readResult) => {
                                try {
                                    const bytes = input.read_bytes_finish(readResult);
                                    readResolve(bytes.get_size() ? bytes.get_data() : null);
                                } catch (error) {
                                    readReject(error);
                                }
                            });
                        }),
                        close: () => new Promise((closeResolve, closeReject) => {
                            stream.close_async(GLib.PRIORITY_DEFAULT, null, (input, closeResult) => {
                                try {
                                    input.close_finish(closeResult);
                                    closeResolve();
                                } catch (error) {
                                    closeReject(error);
                                }
                            });
                        }),
                    });
                } catch (error) {
                    reject(error);
                }
            });
        });
        return {response, cancel: () => cancellable.cancel()};
    }

    destroy() {
        this._session.abort();
        this._session = null;
    }
}

export function schedule(seconds, callback) {
    return GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.ceil(seconds * 1000), () => {
        callback();
        return GLib.SOURCE_REMOVE;
    });
}
