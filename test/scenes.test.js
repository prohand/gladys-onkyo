import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_ACTIONS } from '../src/capabilities/scenes.js';
import { RECEIVER_ID, setupHub } from './helpers/hubSetup.js';
import { settle, until } from './helpers/fakeReceiver.js';

const MAIN = `ext:onkyo:receiver:${RECEIVER_ID}`;
const ZONE2 = `ext:onkyo:zone2:${RECEIVER_ID}`;

async function ready(options) {
  const ctx = setupHub(options);
  await ctx.hub.sync();
  await until(() => ctx.hub.list[0]?.online);
  await until(() => ctx.fake.commands.includes('NRIQSTN'));
  await settle(40);
  ctx.fake.commands.length = 0;
  return ctx;
}

test('play_source wakes the zone, waits for it, then input and volume', async () => {
  const { fake, hub, gladys } = await ready({ config: { zones: '2' } });
  const outputs = await SCENE_ACTIONS.play_source(
    hub,
    { device: ZONE2, source: '24', volume: 30 },
    { settleMs: 1 },
  );
  assert.deepEqual(fake.commands, ['ZPW01', 'SLZ24', 'ZVL18']);
  assert.deepEqual(outputs, { source: '24', volume: 30 });
  await settle(10);
  // An action never fires a trigger: no loop through the integration.
  assert.deepEqual(gladys.sceneEvents, []);
  hub.stop();
});

test('play_source on a zone already on does not touch the power', async () => {
  const { fake, hub } = await ready();
  const outputs = await SCENE_ACTIONS.play_source(hub, { device: MAIN, source: '23' });
  assert.deepEqual(fake.commands, ['SLI23']);
  assert.deepEqual(outputs, { source: '23' });
  hub.stop();
});

test('set_mute says whether the zone is muted', async () => {
  const { hub } = await ready();
  assert.deepEqual(await SCENE_ACTIONS.set_mute(hub, { device: MAIN, mode: 'on' }), {
    muted: true,
  });
  assert.deepEqual(await SCENE_ACTIONS.set_mute(hub, { device: MAIN, mode: 'off' }), {
    muted: false,
  });
  hub.stop();
});

test('set_listening_mode belongs to the main zone', async () => {
  const { fake, hub } = await ready({ config: { zones: '2' } });
  assert.deepEqual(await SCENE_ACTIONS.set_listening_mode(hub, { device: MAIN, mode: '01' }), {
    mode: 'Direct',
  });
  assert.deepEqual(fake.commands, ['LMD01']);
  await assert.rejects(
    SCENE_ACTIONS.set_listening_mode(hub, { device: ZONE2, mode: '01' }),
    /main zone/,
  );
  hub.stop();
});

test('send_command checks the command and returns the answer', async () => {
  const { hub } = await ready();
  assert.deepEqual(await SCENE_ACTIONS.send_command(hub, { device: MAIN, command: 'pwrQSTN' }), {
    answer: 'PWR01',
  });
  await assert.rejects(
    SCENE_ACTIONS.send_command(hub, { device: MAIN, command: 'PWR01\r!1PWR00' }),
    /not an ISCP command/,
  );
  await assert.rejects(
    SCENE_ACTIONS.send_command(hub, { device: 'nope', command: 'PWR01' }),
    /Unknown/,
  );
  hub.stop();
});
