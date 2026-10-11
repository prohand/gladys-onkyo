// -----------------------------------------------------------------------------
// A ReceiverHub wired to a fake Gladys and to fake receivers, for the tests.
// -----------------------------------------------------------------------------

import { ReceiverHub } from '../../src/hub.js';
import { Receiver } from '../../src/onkyo/receiver.js';
import { normalizeConfig } from '../../src/config.js';
import { buildZoneDevice } from '../../src/devices.js';
import { createFakeGladys } from './fakeGladys.js';
import { createFakeReceiver } from './fakeReceiver.js';

export const RECEIVER_ID = '0009b0e1f2a3';
export const HOST = '192.168.1.40';

/**
 * @param {object} [options]
 * @param {string[]} [options.created] zones whose device the user created
 * @param {object} [options.config] raw configuration
 * @param {object} [options.receiver] options of the fake receiver
 */
export function setupHub({ created = ['main'], config = {}, receiver = {} } = {}) {
  const fake = createFakeReceiver(receiver);
  const gladys = createFakeGladys();
  let clock = 1_000_000;
  const hub = new ReceiverHub(gladys, {
    createReceiver: (info) =>
      new Receiver({
        ...info,
        socketFactory: fake.socketFactory,
        writeGapMs: 0,
        describeTimeoutMs: 20,
        reconnectBaseMs: 5,
      }),
    probe: async ({ host, port }) =>
      host === HOST ? { id: RECEIVER_ID, host, port, model: 'TX-NR686' } : null,
    scan: async () => [{ id: RECEIVER_ID, host: HOST, port: 60128, model: 'TX-NR686' }],
    now: () => clock,
    reportDelayMs: 1,
  });
  hub.setConfig(normalizeConfig(config));
  const stub = { id: RECEIVER_ID, host: HOST, port: 60128, model: 'TX-NR686', description: null };
  gladys.devices = created.map((zone) => buildZoneDevice(gladys, stub, zone));
  return {
    fake,
    gladys,
    hub,
    advance(ms) {
      clock += ms;
    },
  };
}
