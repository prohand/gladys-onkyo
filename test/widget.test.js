import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  buildWidgetContent,
  createWidgetNudger,
  handleWidgetAction,
  RECEIVER_WIDGET,
  WIDGET_ACTIONS,
} from '../src/capabilities/widget.js';
import { RECEIVER_ID, setupHub } from './helpers/hubSetup.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { settle, until } from './helpers/fakeReceiver.js';

const MAIN = `ext:onkyo:receiver:${RECEIVER_ID}`;

async function ready(options) {
  const ctx = setupHub(options);
  await ctx.hub.sync();
  await until(() => ctx.hub.list[0]?.online);
  await until(() => ctx.fake.commands.includes('NRIQSTN'));
  await settle(40);
  return ctx;
}

const buttons = (content) => content.components.filter((c) => c.type === 'button');

test('no receiver: a valid empty state that says what to do', () => {
  const { hub } = setupHub({ created: [] });
  const content = buildWidgetContent(hub, {});
  assert.deepEqual(validateWidgetContent(content), []);
  assert.match(content.components[0].text.fr, /Découverte/);
});

test('a receiver on: valid content, volume, input, what plays, four buttons', async () => {
  const { hub } = await ready();
  hub.list[0].handleMessage({ command: 'NTI', value: 'A very long title '.repeat(10) });
  const content = buildWidgetContent(hub, { settings: { device: MAIN } });
  assert.deepEqual(validateWidgetContent(content), []);
  const values = content.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    values.map((v) => v.value),
    [50, 'NET'],
  );
  const playing = content.components
    .find((c) => c.type === 'status')
    .items.find((item) => item.label.en === 'Playing');
  assert.equal(playing.value.length, 40);
  assert.deepEqual(
    buttons(content).map((b) => b.action.key),
    [
      WIDGET_ACTIONS.POWER,
      WIDGET_ACTIONS.VOLUME_DOWN,
      WIDGET_ACTIONS.VOLUME_UP,
      WIDGET_ACTIONS.MUTE,
    ],
  );
  assert.deepEqual(buttons(content)[0].action.params, { device: MAIN, on: false });
  hub.stop();
});

test('in standby: only the power button; unreachable: no button at all', async () => {
  const { fake, hub } = await ready({ receiver: { state: { PWR: '00' } } });
  let content = buildWidgetContent(hub, {});
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(
    buttons(content).map((b) => b.action.params.on),
    [true],
  );

  fake.refuse = true;
  fake.drop();
  await until(() => !hub.list[0].online);
  content = buildWidgetContent(hub, {});
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(buttons(content).length, 0);
  hub.stop();
});

test('the buttons drive the receiver', async () => {
  const { fake, hub } = await ready();
  fake.commands.length = 0;
  await handleWidgetAction(hub, { actionKey: WIDGET_ACTIONS.VOLUME_UP, params: { device: MAIN } });
  await handleWidgetAction(hub, { actionKey: WIDGET_ACTIONS.MUTE, params: { device: MAIN } });
  const toast = await handleWidgetAction(hub, {
    actionKey: WIDGET_ACTIONS.POWER,
    params: { device: MAIN, on: false },
  });
  assert.deepEqual(fake.commands, ['MVLUP', 'AMTTG', 'PWR00']);
  assert.equal(toast.fr, 'Mise en veille');
  await assert.rejects(
    handleWidgetAction(hub, { actionKey: 'dance', params: { device: MAIN } }),
    /Unknown widget action/,
  );
  hub.stop();
});

test('nudges: at most one per interval, and one after the last change', async () => {
  const gladys = createFakeGladys();
  let clock = 0;
  const nudge = createWidgetNudger(gladys, { intervalMs: 20, now: () => clock });
  nudge();
  nudge();
  nudge();
  assert.deepEqual(gladys.widgetRefreshes, [RECEIVER_WIDGET]);
  clock = 25;
  await settle(30);
  assert.deepEqual(gladys.widgetRefreshes, [RECEIVER_WIDGET, RECEIVER_WIDGET]);
});
