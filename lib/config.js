export const MAX_SUBSCRIPTIONS = 20;

// Deliberately accept origins only. Avoid relying on the browser-only URL API
// in GJS, and never allow credentials, query strings, or fragments here.
export function normalizeServer(value) {
    if (typeof value !== 'string')
        throw new Error('Enter a server URL.');
    const match = /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?\/*$/i.exec(value.trim());
    if (!match)
        throw new Error('Use an HTTP or HTTPS server origin, without a path or credentials.');
    const [, rawScheme, rawHost, rawPort] = match;
    const scheme = rawScheme.toLowerCase();
    const host = rawHost.toLowerCase();
    if (!host.startsWith('[') && host.split('.').some(label =>
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
        throw new Error('Enter a valid server hostname.');
    const port = rawPort ? Number(rawPort) : null;
    if (port !== null && (port < 1 || port > 65535))
        throw new Error('Server port must be between 1 and 65535.');
    const defaultPort = scheme === 'https' ? 443 : 80;
    return `${scheme}://${host}${port && port !== defaultPort ? `:${port}` : ''}`;
}

export function normalizeSubscription(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid subscription.');
    if (typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(value.id))
        throw new Error('Invalid subscription ID.');
    const topic = typeof value.topic === 'string' ? value.topic.trim() : '';
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(topic))
        throw new Error('Topics must contain 1–64 letters, numbers, underscores, or hyphens.');
    if (typeof value.enabled !== 'boolean')
        throw new Error('Invalid subscription enabled state.');
    return {id: value.id, server: normalizeServer(value.server), topic, enabled: value.enabled};
}

export function parseSubscriptions(raw) {
    let values;
    try {
        values = JSON.parse(raw);
    } catch {
        throw new Error('Saved subscriptions are not valid JSON.');
    }
    if (!Array.isArray(values) || values.length > MAX_SUBSCRIPTIONS)
        throw new Error(`Use a list of at most ${MAX_SUBSCRIPTIONS} subscriptions.`);
    const subscriptions = values.map(normalizeSubscription);
    const ids = new Set();
    const topics = new Set();
    for (const subscription of subscriptions) {
        const key = `${subscription.server}/${subscription.topic}`;
        if (ids.has(subscription.id) || topics.has(key))
            throw new Error('This topic is already subscribed on this server.');
        ids.add(subscription.id);
        topics.add(key);
    }
    return subscriptions;
}

export function subscriptionUrl(subscription, since) {
    return `${subscription.server}/${subscription.topic}/json?since=${encodeURIComponent(since)}`;
}

export function safeWebUrl(value) {
    if (typeof value !== 'string' || value.length > 4096 || /[\s\\\x00-\x1f\x7f]/.test(value))
        return null;
    const match = /^(https?:\/\/[^/?#]+)([/?#].*)?$/i.exec(value);
    if (!match)
        return null;
    try {
        return normalizeServer(match[1]) + (match[2] ?? '');
    } catch {
        return null;
    }
}
