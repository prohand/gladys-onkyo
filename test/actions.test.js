import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendCommand, testConnection } from '../src/capabilities/actions.js';
import { RECEIVER_ID, setupHub } from './helpers/hubSetup.js';
import { settle, until } from './helpers/fakeReceiver.js';

const MAIN = `ext:onkyo:receiver:${RECEIVER_ID}`;

test('test_connection: one line per zone, and the addresses that answered nothing', async () => {
  const ctx = setupHub({ config: { hosts: '10.9.9.9' } });
  await ctx.hub.sync();
  await until(() => ctx.hub.list[0]?.online);
  await until(() => ctx.fake.commands.includes('NRIQSTN'));
  await settle(40);
  const message = await testConnection(ctx.hub);
  assert.match(message.en, /Onkyo TX-NR686 \(192\.168\.1\.40\) — connected : on, NET, 50 %/);
  assert.match(message.fr, /10\.9\.9\.9:60128 — aucune réponse/);
  assert.deepEqual(Object.keys(message), ['en', 'fr', 'de', 'es']);
  assert.match(message.de, /— verbunden : ein, NET, 50 %/);
  assert.match(message.de, /10\.9\.9\.9:60128 — keine Antwort/);
  assert.match(message.es, /— conectado : encendido, NET, 50 %/);
  assert.match(message.es, /10\.9\.9\.9:60128 — sin respuesta/);
  ctx.hub.stop();
});

test('test_connection with nothing at all says how to start', async () => {
  const { hub } = setupHub({ created: [] });
  const message = await testConnection(hub);
  assert.match(message.en, /Discover tab/);
  assert.match(message.de, /„Entdecken“/);
  assert.match(message.es, /«Descubrir»/);
});

test('send_command: answer shown, bad command explained', async () => {
  const ctx = setupHub();
  await ctx.hub.sync();
  await until(() => ctx.hub.list[0]?.online);
  assert.match(
    (await sendCommand(ctx.hub, { device: MAIN, command: 'MVLQSTN' })).en,
    /Answer: MVL28/,
  );
  const refused = await sendCommand(ctx.hub, { device: MAIN, command: 'PW' });
  assert.match(refused.fr, /n'est pas/);
  assert.deepEqual(Object.keys(refused), ['en', 'fr', 'de', 'es']);
  ctx.hub.stop();
});
