// SPDX-License-Identifier: GPL-3.0-only

import {safeWebUrl} from './config.js';

export const MAX_LINE_BYTES = 64 * 1024;

// Decode complete lines, so a multibyte UTF-8 character may span any number
// of network chunks without requiring TextDecoder's streaming option in GJS.
export class JsonLines {
    constructor() {
        this._pending = new Uint8Array();
        this._decoder = new TextDecoder('utf-8', {fatal: true});
    }

    push(chunk) {
        const bytes = new Uint8Array(this._pending.length + chunk.length);
        bytes.set(this._pending);
        bytes.set(chunk, this._pending.length);
        const lines = [];
        let start = 0;
        for (let index = 0; index < bytes.length; index++) {
            if (index - start > MAX_LINE_BYTES)
                throw new Error('Server message exceeds the 64 KiB limit.');
            if (bytes[index] === 10) {
                try {
                    lines.push(this._decoder.decode(bytes.subarray(start, index)));
                } catch {
                    // A malformed UTF-8 line does not poison the next message.
                }
                start = index + 1;
            }
        }
        this._pending = bytes.slice(start);
        if (this._pending.length > MAX_LINE_BYTES)
            throw new Error('Server message exceeds the 64 KiB limit.');
        return lines;
    }
}

export function parseMessage(line, expectedTopic) {
    let value;
    try {
        value = JSON.parse(line);
    } catch {
        return null;
    }
    if (!value || value.event !== 'message' || value.topic !== expectedTopic ||
        typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.id) ||
        !Number.isSafeInteger(value.time) || value.time < 0 ||
        typeof value.message !== 'string')
        return null;
    // Banner titles render on one line; fold publisher line breaks and tabs.
    const title = typeof value.title === 'string' ? value.title.replace(/\s+/g, ' ').trim() : '';
    return {
        id: value.id,
        time: value.time,
        topic: value.topic,
        title: title ? title.slice(0, 256) : expectedTopic,
        body: value.message.slice(0, 4096),
        priority: Number.isInteger(value.priority) && value.priority >= 1 && value.priority <= 5 ? value.priority : 3,
        click: safeWebUrl(value.click),
    };
}

export class SeenMessages {
    constructor(limit = 1000) {
        this._limit = limit;
        this._ids = new Set();
    }

    accept(id) {
        if (this._ids.has(id))
            return false;
        this._ids.add(id);
        if (this._ids.size > this._limit)
            this._ids.delete(this._ids.values().next().value);
        return true;
    }
}

export function retryDelay(attempt, random = Math.random) {
    return Math.min(60, 2 ** Math.min(attempt, 6)) * (0.75 + random() * 0.25);
}

export function retryAfterSeconds(value, now) {
    if (!value)
        return 0;
    const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - now) / 1000;
    return Number.isFinite(seconds) ? Math.min(300, Math.max(0, seconds)) : 0;
}
