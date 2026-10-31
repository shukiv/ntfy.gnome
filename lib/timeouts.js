// SPDX-License-Identifier: GPL-3.0-only

import GLib from 'gi://GLib';

// Every main-loop timeout the extension creates is registered here, so
// disable() removes all of them in one place.
export class Timeouts {
    constructor() {
        this._ids = new Set();
    }

    add(seconds, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.ceil(seconds * 1000), () => {
            this._ids.delete(id);
            callback();
            return GLib.SOURCE_REMOVE;
        });
        this._ids.add(id);
        return id;
    }

    remove(id) {
        if (this._ids.delete(id))
            GLib.Source.remove(id);
    }

    clear() {
        for (const id of this._ids)
            GLib.Source.remove(id);
        this._ids.clear();
    }
}
