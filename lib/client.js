// SPDX-License-Identifier: GPL-3.0-only

import {subscriptionUrl} from './config.js';
import {CredentialError} from './auth.js';
import {JsonLines, parseMessage, retryAfterSeconds, retryDelay, SeenMessages} from './protocol.js';

// ntfy sends a keepalive event every 45 seconds. A stream without any data
// for this long has silently died (for example a dropped HTTP/2 connection
// that the library never reports) and is abandoned in favour of a reconnect.
// Kept below the transport's 90 second socket timeout so the stall is
// reported consistently as "No data received".
export const DEFAULT_IDLE_TIMEOUT = 75;

export class SubscriptionClient {
    constructor(subscription, {transport, schedule, cancelScheduled, now = Date.now,
        random = Math.random, onMessage, onStatus, idleTimeout = DEFAULT_IDLE_TIMEOUT}) {
        this.subscription = subscription;
        this._transport = transport;
        this._schedule = schedule;
        this._cancelScheduled = cancelScheduled;
        this._idleTimeout = idleTimeout;
        this._now = now;
        this._random = random;
        this._onMessage = onMessage;
        this._onStatus = onStatus;
        this._seen = new SeenMessages();
        this._since = Math.max(0, Math.floor(now() / 1000) - 1);
        this._attempt = 0;
        this._generation = 0;
        this._active = false;
        this._timer = null;
        this._watchdog = null;
        this._request = null;
    }

    start() {
        if (this._active)
            return;
        this._active = true;
        void this._connect(++this._generation);
    }

    stop() {
        this._active = false;
        this._generation++;
        if (this._timer !== null)
            this._cancelScheduled(this._timer);
        this._timer = null;
        this._disarm(this._watchdog);
        this._request?.cancel();
        this._request = null;
    }

    reconnect() {
        this.stop();
        this._attempt = 0;
        this.start();
    }

    setTransport(transport) {
        this.stop();
        this._transport = transport;
        this._attempt = 0;
        this.start();
    }

    _current(generation) {
        return this._active && generation === this._generation;
    }

    _disarm(watchdog) {
        if (watchdog?.id !== null && watchdog?.id !== undefined)
            this._cancelScheduled(watchdog.id);
        if (watchdog)
            watchdog.id = null;
        if (this._watchdog === watchdog)
            this._watchdog = null;
    }

    // Await a transport promise while a watchdog cancels the request if it
    // has not settled within the idle timeout. Each watchdog is bound to its
    // own request so a late completion cannot disturb a newer stream.
    async _watched(promise, request, generation, onStall) {
        const watchdog = {id: null};
        watchdog.id = this._schedule(this._idleTimeout, () => {
            watchdog.id = null;
            this._disarm(watchdog);
            if (this._current(generation)) {
                onStall();
                request.cancel();
            }
        });
        this._watchdog = watchdog;
        try {
            return await promise;
        } finally {
            this._disarm(watchdog);
        }
    }

    async _connect(generation) {
        let response;
        let reason = 'Connection interrupted';
        let retryAfter = 0;
        let permanent = false;
        let credentialError = null;
        let stalled = false;
        const started = this._now();
        try {
            this._onStatus({state: 'connecting'});
            const request = this._transport.open(subscriptionUrl(this.subscription, this._since));
            this._request = request;
            const watched = promise => this._watched(promise, request, generation, () => {
                stalled = true;
            });
            response = await watched(request.response);
            if (!this._current(generation))
                return;
            if (response.status !== 200) {
                reason = `HTTP ${response.status}`;
                permanent = response.status >= 300 && response.status < 500 &&
                    ![408, 425, 429].includes(response.status);
                retryAfter = retryAfterSeconds(response.retryAfter, this._now());
            } else {
                this._onStatus({state: 'connected', truncated: response.truncated});
                const lines = new JsonLines();
                while (this._current(generation)) {
                    const chunk = await watched(response.read());
                    if (!this._current(generation) || chunk === null)
                        break;
                    for (const line of lines.push(chunk)) {
                        if (!this._current(generation))
                            break;
                        const message = parseMessage(line, this.subscription.topic);
                        if (!message)
                            continue;
                        // Timestamp replay is resilient to deleted/expired message IDs.
                        // Bound a publisher's future timestamp to the local clock.
                        this._since = Math.max(this._since,
                            Math.min(message.time - 1, Math.floor(this._now() / 1000) - 1));
                        if (this._seen.accept(message.id))
                            this._onMessage(message);
                    }
                }
            }
        } catch (error) {
            if (error instanceof CredentialError)
                credentialError = error.code;
            // Do not leak server URLs, topic names, or response bodies to logs.
            reason = 'Network or stream error';
        } finally {
            if (response)
                await response.close().catch(() => {});
            if (this._current(generation))
                this._request = null;
        }
        if (!this._current(generation))
            return;
        if (stalled)
            reason = 'No data received';
        if (credentialError) {
            this._onStatus({state: 'credentials', code: credentialError});
            return;
        }
        if (permanent) {
            this._onStatus({state: 'error', reason});
            return;
        }
        if (this._now() - started >= 60_000)
            this._attempt = 0;
        const delay = Math.max(retryAfter, retryDelay(this._attempt++, this._random));
        this._onStatus({state: 'retrying', reason, seconds: Math.ceil(delay)});
        this._timer = this._schedule(delay, () => {
            this._timer = null;
            if (this._current(generation))
                void this._connect(generation);
        });
    }
}
