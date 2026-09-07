import GLib from 'gi://GLib';
import {SubscriptionClient} from '../lib/client.js';
import {SoupTransport, schedule} from '../lib/transport.js';

const server = ARGV[0];
const transport = new SoupTransport();
const statuses = [];
const messages = [];
const wait = seconds => new Promise(resolve => schedule(seconds, resolve));
const assert = (condition, message) => {
    if (!condition)
        throw new Error(message);
};

function makeClient(topic, onMessage, onStatus) {
    return new SubscriptionClient({id: topic, server, topic, enabled: true}, {
        transport, schedule, cancelScheduled: id => GLib.Source.remove(id),
        onMessage, onStatus, random: () => 0,
    });
}

const client = makeClient('alerts', message => messages.push(message), status => statuses.push(status));
const deniedStatuses = [];
const denied = makeClient('denied', () => {}, status => deniedStatuses.push(status));
try {
    client.start();
    denied.start();
    for (let i = 0; i < 60 && messages.length < 2; i++)
        await wait(0.05);
    assert(messages.length === 2, `Expected two unique messages, got ${messages.length}; ${JSON.stringify(statuses)}`);
    assert(messages.every(message => message.body === 'שלום 🌍 café'), 'UTF-8 was not preserved');
    assert(messages[0].id === 'one' && messages[1].id === 'two', 'Replay did not deduplicate');
    assert(statuses.some(status => status.state === 'retrying'), 'EOF did not reconnect');
    assert(deniedStatuses.at(-1)?.state === 'error', '403 must stop retrying');
    client.stop();
    denied.stop();
    const count = statuses.length;
    await wait(1.2);
    assert(messages.length === 2 && statuses.length === count, 'Callbacks fired after stop');

    const redirected = transport.open(`${server}/redirect/json`);
    const response = await redirected.response;
    assert(response.status === 302, 'Transport followed a redirect');
    await response.close();
} finally {
    client.stop();
    denied.stop();
    transport.destroy();
}
