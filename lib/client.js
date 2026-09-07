import {subscriptionUrl} from './config.js';
import {JsonLines, parseMessage, retryAfterSeconds, retryDelay, SeenMessages} from './protocol.js';

export class SubscriptionClient {
    constructor(subscription, {transport, schedule, cancelScheduled, now = Date.now,
        random = Math.random, onMessage, onStatus}) {
        this.subscription = subscription;
        this._transport = transport;
        this._schedule = schedule;
        this._cancelScheduled = cancelScheduled;
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
        this._request?.cancel();
        this._request = null;
    }

    reconnect() {
        this.stop();
        this._attempt = 0;
        this.start();
    }

    _current(generation) {
        return this._active && generation === this._generation;
    }

    async _connect(generation) {
        let response;
        let reason = 'Connection interrupted';
        let retryAfter = 0;
        let permanent = false;
        const started = this._now();
        try {
            this._onStatus({state: 'connecting'});
            this._request = this._transport.open(subscriptionUrl(this.subscription, this._since));
            response = await this._request.response;
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
                    const chunk = await response.read();
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
        } catch {
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
