import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Receiver } from '../src/onkyo/receiver.js';
import { createFakeReceiver, settle, until } from './helpers/fakeReceiver.js';
import { NRI_SAMPLE } from './helpers/samples.js';

function start(fakeOptions = {}) {
  const fake = createFakeReceiver(fakeOptions);
  const receiver = new Receiver({
    id: '0009b0e1f2a3',
    host: '192.168.1.40',
    model: 'TX-NR686',
    socketFactory: fake.socketFactory,
    writeGapMs: 0,
    describeTimeoutMs: 20,
  });
  receiver.start();
  return { fake, receiver };
}

// The reading done at connection ends with the NRI query, answered or not.
async function readDone(fake) {
  await until(() => fake.commands.includes('NRIQSTN'));
  await settle(30);
}

test('on connection the receiver is read whole', async () => {
  const { receiver } = start({ nri: NRI_SAMPLE });
  await until(() => receiver.description !== null);
  assert.equal(receiver.zones.main.power, 1);
  assert.equal(receiver.zones.main.volume, 0x28);
  assert.equal(receiver.zones.main.mute, 0);
  assert.equal(receiver.zones.main.source, '2B');
  assert.equal(receiver.zones.zone2.power, 0);
  assert.equal(receiver.main.listeningMode, '00');
  assert.equal(receiver.description.inputs[0].label, 'Blu-ray');
  receiver.stop();
});

test('changes reported by the receiver are events; repeats are not', async () => {
  const { fake, receiver } = start();
  await readDone(fake);
  const changes = [];
  receiver.on('change', (change) => changes.push(change));
  fake.push('SLI23');
  fake.push('SLI23');
  fake.push('ZVL1E');
  fake.push('MVLN/A');
  await settle();
  assert.deepEqual(changes, [
    { zone: 'main', key: 'source', value: '23', previous: '2B' },
    { zone: 'zone2', key: 'volume', value: 30, previous: null },
  ]);
  receiver.stop();
});

test('orders are the ISCP commands the receiver expects', async () => {
  const { fake, receiver } = start();
  await readDone(fake);
  fake.commands.length = 0;
  await receiver.setPower('zone2', true);
  await receiver.setVolumeHex('main', '20');
  await receiver.volumeStep('zone3', false);
  await receiver.setMute('main', 'toggle');
  await receiver.setSource('zone2', '80');
  await receiver.setListeningMode('01');
  await receiver.setPreset(12);
  await receiver.netKey('next');
  assert.deepEqual(fake.commands, [
    'ZPW01',
    'MVL20',
    'VL3DOWN',
    'AMTTG',
    'SLZ80',
    'LMD01',
    'PRS0C',
    'NTCTRUP',
  ]);
  assert.throws(() => receiver.setSource('main', '1;2'), /Invalid input/);
  assert.throws(() => receiver.setPreset(41), /Invalid preset/);
  assert.throws(() => receiver.setMute('main', 'loud'), /Unknown mute/);
  receiver.stop();
});

test('a new track is one event, once title, artist and album are in', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const receiver = new Receiver({
    id: 'x',
    host: 'h',
    connection: Object.assign(new (await import('node:events')).EventEmitter(), {
      start() {},
      stop() {},
      online: true,
    }),
  });
  const tracks = [];
  receiver.on('track', (track) => tracks.push(track));
  const say = (command, value) => receiver.handleMessage({ command, value });

  // The first track after a connection is not a change.
  say('NTI', 'One');
  say('NAT', 'Artist A');
  t.mock.timers.tick(2000);
  assert.deepEqual(tracks, []);

  say('NTI', 'Two');
  say('NAT', 'Artist B');
  say('NAL', 'Album B');
  t.mock.timers.tick(2000);
  assert.deepEqual(tracks, [{ title: 'Two', artist: 'Artist B', album: 'Album B' }]);
  assert.equal(receiver.nowPlaying, 'Artist B – Two');
});

test('waitFor resolves on the reported value, or false in time', async () => {
  const { fake, receiver } = start({ state: { PWR: '00' } });
  await until(() => receiver.zones.main.power === 0);
  const waiting = receiver.waitFor('main', 'power', 1, 500);
  fake.push('PWR01');
  assert.equal(await waiting, true);
  assert.equal(await receiver.waitFor('main', 'power', 0, 10), false);
  receiver.stop();
});

test('a raw command returns the answer of the receiver', async () => {
  const { receiver } = start();
  await until(() => receiver.online);
  assert.equal(await receiver.raw('PWRQSTN'), 'PWR01');
  receiver.stop();
});
