// SPDX-License-Identifier: GPL-3.0-only

// Replay checkpoints survive screen locking, logout and Shell restarts, so a
// new client asks the server for everything published since the last message
// it handled. Recent message ids are kept so that overlap is not shown twice.
export const MAX_SEEN = 20;
const MAX_ENTRIES = 100;
const MESSAGE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export function replayKey(subscription) {
    return `${subscription.server}/${subscription.topic}`;
}

// Saved state is untrusted input: anything malformed is dropped, which only
// means starting from the present as a new subscription does.
export function parseReplayState(text, nowSeconds) {
    const state = new Map();
    let value;
    try {
        value = JSON.parse(text);
    } catch {
        return state;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return state;
    const entries = Object.entries(value);
    if (entries.length > MAX_ENTRIES)
        return state;
    for (const [key, entry] of entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
        if (key.length > 600 || !entry || !Number.isSafeInteger(entry.since) || entry.since < 0)
            continue;
        const seen = Array.isArray(entry.seen)
            ? entry.seen.filter(id => typeof id === 'string' && MESSAGE_ID.test(id)).slice(-MAX_SEEN) : [];
        state.set(key, {since: Math.min(entry.since, Math.max(0, nowSeconds - 1)), seen});
    }
    return state;
}

export function serializeReplayState(state) {
    const keys = [...state.keys()].sort();
    return JSON.stringify(Object.fromEntries(keys.map(key => {
        const {since, seen} = state.get(key);
        return [key, {since, seen: seen.slice(-MAX_SEEN)}];
    })));
}
