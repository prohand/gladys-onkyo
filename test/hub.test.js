import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_TRIGGERS } from '../src/hub.js';
import { HOST, RECEIVER_ID, setupHub } from './helpers/hubSetup.js';
import { settle, until } from './helpers/fakeReceiver.js';

const MAIN = `ext:onkyo:receiver:${RECEIVER_ID}`;
const ZONE2 = `ext:onkyo:zone2:${RECEIVER_ID}`;

async function ready({ hub, fake }) {
  await hub.sync();
  await until(() => hub.list[0]?.online);
  await until(() => fake.commands.includes('NRIQSTN'));
  await settle(40);
}

test('sync connects the created receivers and publishes their states', async () => {
  const ctx = setupHub();
  await ready(ctx);
  const { gladys, hub } = ctx;
  assert.equal(hub.list.length, 1);
  assert.equal(hub.list[0].host, HOST);
  assert.deepEqual(gladys.statesOf(`${MAIN}:power`), [1]);
  assert.deepEqual(gladys.statesOf(`${MAIN}:volume`), [50]); // 0x28 = 40 of 80
  assert.deepEqual(gladys.statesOf(`${MAIN}:source`), [{ text: '2B' }]);
  assert.deepEqual(gladys.statesOf(`${MAIN}:listening-mode`), [{ text: '00' }]);
  // Zone 2 has no device in Gladys: nothing is published for it.
  assert.equal(gladys.published.filter((s) => s.featureExternalId.startsWith(ZONE2)).length, 0);
  assert.deepEqual(gladys.transports.at(-1), { external_id: MAIN, transport: 'local' });
  assert.deepEqual(gladys.connectionStatuses.at(-1), { connected: true, message: undefined });
  hub.stop();
});

test('an unchanged value is not sent twice; a reconnection to Gladys re-sends everything', async () => {
  const ctx = setupHub();
  await ready(ctx);
  const { gladys, hub } = ctx;
  hub.list[0].handleMessage({ command: 'MVL', value: '28' });
  await settle(10);
  assert.deepEqual(gladys.statesOf(`${MAIN}:volume`), [50]);
  // sync() runs at every connection to Gladys and every device creation.
  await hub.sync();
  await settle(10);
  assert.deepEqual(gladys.statesOf(`${MAIN}:volume`), [50, 50]);
  assert.deepEqual(gladys.statesOf(`${MAIN}:source`), [{ text: '2B' }, { text: '2B' }]);
  hub.stop();
});

test('a state Gladys refused is sent again with the next publication', async () => {
  const ctx = setupHub();
  await ready(ctx);
  const { gladys, hub } = ctx;
  gladys.refuseStates = new Error('HTTP 429');
  hub.list[0].handleMessage({ command: 'MVL', value: '20' });
  await settle(10);
  assert.deepEqual(gladys.statesOf(`${MAIN}:volume`), [50]);
  gladys.refuseStates = null;
  // Not remembered as published: the same value goes out on the next try.
  await hub.publish(hub.list[0], 'main', 'volume', 40);
  assert.deepEqual(gladys.statesOf(`${MAIN}:volume`), [50, 40]);
  hub.stop();
});

test('no receiver yet: connected, with the way to add one', async () => {
  const { gladys, hub } = setupHub({ created: [] });
  await hub.sync();
  await settle(10);
  assert.equal(gladys.connectionStatuses.at(-1).connected, true);
  assert.match(gladys.connectionStatuses.at(-1).message.fr, /Découverte/);
  assert.deepEqual(Object.keys(gladys.connectionStatuses.at(-1).message), ['en', 'fr', 'de', 'es']);
  hub.stop();
});

test('the Discovery tab scans through the core and publishes every zone', async () => {
  const ctx = setupHub({ created: [], config: { zones: '2' } });
  await ctx.hub.discover();
  const devices = ctx.gladys.discovered.at(-1);
  assert.deepEqual(
    devices.map((d) => d.external_id),
    [MAIN, ZONE2],
  );
  ctx.hub.stop();
});

test('a typed address is probed and added', async () => {
  const ctx = setupHub({ created: [], config: { hosts: `${HOST}, 10.9.9.9` } });
  ctx.hub.scan = async () => {
    throw new Error('scan not supported');
  };
  await ctx.hub.discover();
  assert.equal(ctx.hub.list.length, 1);
  assert.equal(ctx.gladys.discovered.at(-1).length, 1);
  ctx.hub.stop();
});

test('Gladys orders become ISCP commands', async () => {
  const ctx = setupHub({ created: ['main', 'zone2'], config: { zones: '2' } });
  await ready(ctx);
  const { fake, hub } = ctx;
  fake.commands.length = 0;
  const feature = (id) => ({ external_id: id });
  await hub.handleSetValue(feature(`${MAIN}:power`), 0);
  await hub.handleSetValue(feature(`${MAIN}:volume`), 25);
  await hub.handleSetValue(feature(`${ZONE2}:mute`), 1);
  await hub.handleSetValue(feature(`${ZONE2}:source`), '23');
  await hub.handleSetValue(feature(`${MAIN}:listening-mode`), '01');
  await hub.handleSetValue(feature(`${MAIN}:play`), 1);
  await hub.handleSetValue(feature(`${MAIN}:preset`), 3);
  assert.deepEqual(fake.commands, [
    'PWR00',
    'MVL14',
    'ZMTTG',
    'SLZ23',
    'LMD01',
    'NTCPLAY',
    'PRS03',
  ]);
  await assert.rejects(
    hub.handleSetValue(feature(`${MAIN}:now-playing`), 'x'),
    /cannot be controlled/,
  );
  await assert.rejects(hub.handleSetValue(feature('ext:onkyo:receiver:nope:power'), 1), /Unknown/);
  hub.stop();
});

test('the volume never goes past the safety cap, slider or button', async () => {
  const ctx = setupHub({ config: { max_volume: 50 }, receiver: { state: { MVL: '28' } } });
  await ready(ctx);
  const { fake, hub, gladys } = ctx;
  fake.commands.length = 0;
  await hub.handleSetValue({ external_id: `${MAIN}:volume` }, 90);
  // Already at 50 %: "volume up" stays on the cap instead of stepping over it.
  await hub.handleSetValue({ external_id: `${MAIN}:volume-up` }, 1);
  await hub.handleSetValue({ external_id: `${MAIN}:volume-down` }, 1);
  assert.deepEqual(fake.commands, ['MVL28', 'MVL28', 'MVLDOWN']);
  await settle(10);
  assert.equal(gladys.statesOf(`${MAIN}:volume`).at(-1), 49);
  hub.stop();
});

test('an input picked on the remote fires source_changed; a Gladys order does not', async () => {
  const ctx = setupHub();
  await ready(ctx);
  const { fake, gladys, hub, advance } = ctx;
  fake.push('SLI23');
  await settle(10);
  assert.deepEqual(gladys.sceneEvents, [
    {
      key: SCENE_TRIGGERS.SOURCE_CHANGED,
      data: { device: MAIN, source: '23', source_name: 'CD' },
    },
  ]);

  await hub.handleSetValue({ external_id: `${MAIN}:source` }, '10');
  await settle(10);
  assert.equal(gladys.sceneEvents.length, 1, 'the echo of a Gladys order is not an event');
  assert.deepEqual(gladys.statesOf(`${MAIN}:source`).at(-1), { text: '10' });

  advance(10_000);
  fake.push('SLI24');
  await settle(10);
  assert.equal(gladys.sceneEvents.length, 2);
  hub.stop();
});

test('connection_changed: not at startup, then on every loss and return', async () => {
  const ctx = setupHub();
  await ready(ctx);
  const { fake, gladys, hub } = ctx;
  assert.equal(gladys.sceneEvents.length, 0);

  fake.refuse = true;
  fake.drop();
  await until(() => gladys.sceneEvents.length === 1);
  assert.deepEqual(gladys.sceneEvents[0], {
    key: SCENE_TRIGGERS.CONNECTION_CHANGED,
    data: { device: MAIN, state: 'offline' },
  });
  await until(() => gladys.connectionStatuses.at(-1)?.connected === false);
  assert.match(gladys.connectionStatuses.at(-1).message.en, /Unreachable: TX-NR686/);
  assert.deepEqual(gladys.transports.at(-1), { external_id: MAIN, transport: 'unreachable' });
  await assert.rejects(hub.handleSetValue({ external_id: `${MAIN}:power` }, 1), /not reachable/);

  fake.refuse = false;
  await until(() => gladys.sceneEvents.length === 2, 2000);
  assert.equal(gladys.sceneEvents[1].data.state, 'online');
  hub.stop();
});

test('a new track fires track_changed and updates "now playing"', async (t) => {
  const ctx = setupHub();
  await ready(ctx);
  const { gladys, hub } = ctx;
  const receiver = hub.list[0];
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const say = (command, value) => receiver.handleMessage({ command, value });
  say('NTI', 'First');
  t.mock.timers.tick(2000);
  say('NTI', 'Song');
  say('NAT', 'Band');
  say('NAL', 'Record');
  t.mock.timers.tick(2000);
  t.mock.timers.reset();
  await settle(10);
  assert.deepEqual(gladys.sceneEvents.at(-1), {
    key: SCENE_TRIGGERS.TRACK_CHANGED,
    data: { device: MAIN, title: 'Song', artist: 'Band', album: 'Record' },
  });
  assert.deepEqual(gladys.statesOf(`${MAIN}:now-playing`).at(-1), { text: 'Band – Song' });
  hub.stop();
});

test('a receiver moved by DHCP is followed, same devices', async () => {
  const ctx = setupHub();
  await ready(ctx);
  const { hub } = ctx;
  hub.ensure({ id: RECEIVER_ID, host: '192.168.1.77', port: 60128 });
  assert.equal(hub.list.length, 1);
  assert.equal(hub.list[0].host, '192.168.1.77');
  hub.stop();
});
