// The network player of a receiver, seen as a Gladys music player (5.3):
// now playing, play status, time and cover, all from what the receiver says.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artworkKey, MUSIC_PLAYBACK_STATE } from '@gladysassistant/integration-sdk';
import { Receiver } from '../src/onkyo/receiver.js';
import { createFakeReceiver, settle, until } from './helpers/fakeReceiver.js';
import { HOST, setupHub } from './helpers/hubSetup.js';
import { JPEG_SAMPLE } from './helpers/samples.js';

const MAIN = 'ext:onkyo:receiver:0009b0e1f2a3';
const ZONE2 = 'ext:onkyo:zone2:0009b0e1f2a3';
const HEX = JPEG_SAMPLE.toString('hex').toUpperCase();
const PLAYING = {
  NST: 'P--',
  NTM: '00:42/03:30',
  NTI: 'So What',
  NAT: 'Miles Davis',
  NAL: 'Kind of Blue',
};

function startReceiver(fakeOptions = {}) {
  const fake = createFakeReceiver(fakeOptions);
  const receiver = new Receiver({
    id: '0009b0e1f2a3',
    host: HOST,
    socketFactory: fake.socketFactory,
    writeGapMs: 0,
    describeTimeoutMs: 20,
  });
  receiver.start();
  return { fake, receiver };
}

async function ready({ hub, fake }) {
  await hub.sync();
  await until(() => hub.list[0]?.online);
  await until(() => fake.commands.includes('NRIQSTN'));
  await settle(40);
}

test('on connection the network player is read: status, time, track, cover', async () => {
  const { fake, receiver } = startReceiver({ state: PLAYING });
  await until(() => fake.commands.includes('NRIQSTN'));
  await settle(30);
  for (const command of ['NSTQSTN', 'NTMQSTN', 'NTIQSTN', 'NJAREQ']) {
    assert.ok(fake.commands.includes(command), command);
  }
  assert.equal(receiver.main.playback, MUSIC_PLAYBACK_STATE.PLAYING);
  assert.equal(receiver.main.position, 42);
  assert.equal(receiver.main.duration, 210);
  assert.equal(receiver.main.title, 'So What');
  receiver.stop();
});

test('play / pause / stop are NTC keys; the state is what NST reports back', async () => {
  const { fake, receiver } = startReceiver({ state: PLAYING });
  await until(() => fake.commands.includes('NRIQSTN'));
  await settle(30);
  assert.equal(receiver.main.playback, MUSIC_PLAYBACK_STATE.PLAYING);
  fake.commands.length = 0;
  await receiver.setPlayback(MUSIC_PLAYBACK_STATE.PAUSED);
  await until(() => receiver.main.playback === MUSIC_PLAYBACK_STATE.PAUSED);
  await receiver.setPlayback('2');
  await until(() => receiver.main.playback === MUSIC_PLAYBACK_STATE.IDLE);
  await receiver.setPlayback(1);
  assert.deepEqual(fake.commands, ['NTCPAUSE', 'NTCSTOP', 'NTCPLAY']);
  assert.throws(() => receiver.setPlayback(MUSIC_PLAYBACK_STATE.BUFFERING), /Unsupported/);
  assert.throws(() => receiver.setPlayback('x'), /Unsupported/);
  receiver.stop();
});

test('the time is its own event, sent only when it moves; standby means idle', async () => {
  const { fake, receiver } = startReceiver({ state: PLAYING });
  await until(() => receiver.main.position === 42);
  const times = [];
  const changes = [];
  receiver.on('time', (time) => times.push(time));
  receiver.on('change', (change) => changes.push(change.key));
  fake.push('NTM00:43/03:30');
  fake.push('NTM00:43/03:30');
  fake.push('NTMN/A');
  await settle();
  assert.deepEqual(times, [{ position: 43, duration: 210 }]);
  fake.push('PWR00');
  await settle();
  assert.equal(receiver.main.playback, MUSIC_PLAYBACK_STATE.IDLE);
  assert.deepEqual(changes, ['power', 'playback']);
  receiver.stop();
});

test('a created main zone gets the whole now playing at connection', async () => {
  const ctx = setupHub({ receiver: { state: PLAYING } });
  await ready(ctx);
  const { gladys, hub } = ctx;
  assert.equal(gladys.statesOf(`${MAIN}:playback_state`).at(-1), MUSIC_PLAYBACK_STATE.PLAYING);
  assert.deepEqual(gladys.statesOf(`${MAIN}:title`).at(-1), { text: 'So What' });
  assert.deepEqual(gladys.statesOf(`${MAIN}:artist`).at(-1), { text: 'Miles Davis' });
  assert.deepEqual(gladys.statesOf(`${MAIN}:album`).at(-1), { text: 'Kind of Blue' });
  assert.equal(gladys.statesOf(`${MAIN}:duration`).at(-1), 210);
  assert.equal(gladys.statesOf(`${MAIN}:position`).at(-1), 42);
  assert.ok(gladys.nowPlaying.every((call) => call.device === MAIN));
  // A reconnection to Gladys sends the whole of it again.
  const before = gladys.nowPlaying.length;
  await hub.sync();
  await settle(10);
  assert.deepEqual(gladys.nowPlaying.at(-1).values, {
    title: 'So What',
    artist: 'Miles Davis',
    album: 'Kind of Blue',
    playback_state: MUSIC_PLAYBACK_STATE.PLAYING,
    duration: 210,
    position: 42,
  });
  assert.ok(gladys.nowPlaying.length > before);
  hub.stop();
});

test('nothing is published for a main zone not created in Gladys', async () => {
  const ctx = setupHub({
    created: ['zone2'],
    config: { zones: '2' },
    receiver: { state: PLAYING },
  });
  await ready(ctx);
  assert.deepEqual(ctx.gladys.nowPlaying, []);
  assert.equal(
    ctx.gladys.published.filter((s) => s.featureExternalId.startsWith(`${ZONE2}:title`)).length,
    0,
  );
  ctx.hub.stop();
});

test('a playback order publishes nothing itself: the receiver answer does', async () => {
  const ctx = setupHub({ receiver: { state: PLAYING } });
  await ready(ctx);
  const { fake, gladys, hub } = ctx;
  fake.silent = true;
  fake.commands.length = 0;
  await hub.handleSetValue({ external_id: `${MAIN}:playback_state` }, 0);
  await settle(10);
  assert.deepEqual(fake.commands, ['NTCPAUSE']);
  assert.deepEqual(gladys.statesOf(`${MAIN}:playback_state`), [MUSIC_PLAYBACK_STATE.PLAYING]);
  fake.silent = false;
  fake.push('NSTp--');
  await settle(10);
  assert.deepEqual(gladys.statesOf(`${MAIN}:playback_state`), [
    MUSIC_PLAYBACK_STATE.PLAYING,
    MUSIC_PLAYBACK_STATE.PAUSED,
  ]);
  // The pause carries the position the receiver gave last, for the dashboard.
  assert.deepEqual(gladys.nowPlaying.at(-1).values, { playback_state: 0, position: 42 });
  await assert.rejects(hub.handleSetValue({ external_id: `${MAIN}:title` }, 'x'), /cannot be/);
  hub.stop();
});

test('a new track and its time reach the music features', async () => {
  const ctx = setupHub({ receiver: { state: PLAYING } });
  await ready(ctx);
  const { fake, gladys, hub } = ctx;
  fake.push('NTIFreddie Freeloader');
  fake.push('NTM00:00/09:46');
  await settle(10);
  assert.deepEqual(gladys.statesOf(`${MAIN}:title`).at(-1), { text: 'Freddie Freeloader' });
  assert.equal(gladys.statesOf(`${MAIN}:duration`).at(-1), 586);
  assert.deepEqual(gladys.nowPlaying.at(-1).values, { duration: 586, position: 0 });
  // The old "now playing" text feature still follows, for existing dashboards.
  assert.deepEqual(gladys.statesOf(`${MAIN}:now-playing`).at(-1), {
    text: 'Miles Davis – Freddie Freeloader',
  });
  hub.stop();
});

test('the cover the receiver sends is published as a key and served on demand', async () => {
  const ctx = setupHub({
    receiver: { state: PLAYING, jacketArt: [`10${HEX.slice(0, 20)}`, `12${HEX.slice(20)}`] },
  });
  await ready(ctx);
  const { fake, gladys, hub } = ctx;
  const [key] = gladys.statesOf(`${MAIN}:artwork`).map((state) => state.text);
  assert.match(key, /^art-[0-9a-f]{12}$/);
  assert.equal(hub.artworkBytes(key), JPEG_SAMPLE.toString('base64'));
  assert.equal(gladys.nowPlaying.at(-1).values.artwork_url.startsWith('onkyo-artwork:'), true);
  assert.equal(artworkKey(gladys.nowPlaying.at(-1).values.artwork_url), key);
  // No cover for the next track: the artwork is emptied, not left on the old one.
  fake.push('NJAn-');
  await settle(10);
  assert.deepEqual(gladys.statesOf(`${MAIN}:artwork`).at(-1), { text: '' });
  assert.throws(() => hub.artworkBytes('art-000000000000'), /Unknown artwork/);
  hub.stop();
});

test('a cover link is read from the receiver, the latest one winning', async () => {
  const asked = [];
  const ctx = setupHub({
    receiver: { state: PLAYING },
    fetchArtwork: async (url, host) => {
      asked.push([url, host]);
      if (url.endsWith('slow')) {
        await settle(30);
      }
      return url.endsWith('none') ? null : JPEG_SAMPLE;
    },
  });
  await ready(ctx);
  const { fake, gladys, hub } = ctx;
  fake.push(`NJA2-http://${HOST}/slow`);
  fake.push(`NJA2-http://${HOST}/none`);
  await settle(60);
  assert.deepEqual(asked, [
    [`http://${HOST}/slow`, HOST],
    [`http://${HOST}/none`, HOST],
  ]);
  // The slow answer came last but belonged to an older track: not published.
  assert.deepEqual(
    gladys.nowPlaying.filter((call) => 'artwork_url' in call.values).map((c) => c.values),
    [{ artwork_url: null }],
  );
  fake.push(`NJA2-http://${HOST}/album_art.cgi`);
  await settle(10);
  const key = gladys.statesOf(`${MAIN}:artwork`).at(-1).text;
  assert.equal(hub.artworkBytes(key), JPEG_SAMPLE.toString('base64'));
  hub.stop();
});
