import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import {
  buildDevices,
  buildZoneDevice,
  FEATURES,
  inputOptions,
  locateDevice,
  locateFeature,
  receiverName,
  receiversFromDevices,
  zonesFor,
} from '../src/devices.js';
import { normalizeConfig } from '../src/config.js';
import { parseNri } from '../src/onkyo/nri.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { NRI_SAMPLE } from './helpers/samples.js';

const plain = {
  id: 'aabbccddeeff',
  host: '10.0.0.5',
  port: 60128,
  model: 'TX-SR508',
  description: null,
};
const described = { ...plain, model: 'TX-NR686', description: parseNri(NRI_SAMPLE) };

test('zones: automatic follows the receiver, a number forces it', () => {
  const auto = normalizeConfig();
  assert.deepEqual(zonesFor(plain, auto), ['main']);
  assert.deepEqual(zonesFor(described, auto), ['main', 'zone2']);
  assert.deepEqual(zonesFor(plain, normalizeConfig({ zones: '3' })), ['main', 'zone2', 'zone3']);
  assert.deepEqual(zonesFor(described, normalizeConfig({ zones: '1' })), ['main']);
});

test('external ids rest on the MAC address, not on the IP', () => {
  const gladys = createFakeGladys();
  const device = buildZoneDevice(gladys, plain, 'main');
  assert.equal(device.external_id, 'ext:onkyo:receiver:aabbccddeeff');
  assert.equal(device.name, 'Onkyo TX-SR508');
  const moved = buildZoneDevice(gladys, { ...plain, host: '10.0.0.99' }, 'main');
  assert.equal(moved.external_id, device.external_id);
  assert.equal(buildZoneDevice(gladys, plain, 'zone2').name, 'Onkyo TX-SR508 Zone 2');
});

test('every feature declares min and max, and a type Gladys renders', () => {
  const gladys = createFakeGladys();
  for (const zone of ['main', 'zone2', 'zone3']) {
    for (const feature of buildZoneDevice(gladys, described, zone).features) {
      assert.equal(typeof feature.min, 'number', feature.external_id);
      assert.equal(typeof feature.max, 'number', feature.external_id);
      assert.ok(feature.min <= feature.max, feature.external_id);
      const types = Object.values(DEVICE_FEATURE_TYPES).flatMap((group) => Object.values(group));
      assert.ok(types.includes(feature.type), feature.external_id);
      assert.ok(Object.values(DEVICE_FEATURE_CATEGORIES).includes(feature.category));
    }
  }
});

test('the main zone carries the player, the other zones do not', () => {
  const gladys = createFakeGladys();
  const keys = (zone) =>
    buildZoneDevice(gladys, plain, zone).features.map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(keys('main'), [
    FEATURES.POWER,
    FEATURES.VOLUME,
    FEATURES.MUTE,
    FEATURES.VOLUME_UP,
    FEATURES.VOLUME_DOWN,
    FEATURES.SOURCE,
    FEATURES.LISTENING_MODE,
    FEATURES.PLAY,
    FEATURES.PAUSE,
    FEATURES.STOP,
    FEATURES.PREVIOUS,
    FEATURES.NEXT,
    FEATURES.PRESET,
    FEATURES.NOW_PLAYING,
    FEATURES.PLAYBACK_STATE,
    FEATURES.TITLE,
    FEATURES.ARTIST,
    FEATURES.ALBUM,
    FEATURES.ARTWORK,
    FEATURES.DURATION,
    FEATURES.POSITION,
  ]);
  assert.deepEqual(keys('zone2'), keys('main').slice(0, 6));
});

test('the music player features: the keys publishNowPlaying uses, playback writable', () => {
  const gladys = createFakeGladys();
  const music = buildZoneDevice(gladys, plain, 'main').features.filter(
    (f) => f.category === 'music',
  );
  // The default ids of publishNowPlaying are `<device>:<music type>`.
  for (const feature of music) {
    assert.equal(feature.external_id, `ext:onkyo:receiver:aabbccddeeff:${feature.type}`);
    assert.equal(feature.keep_history, false, feature.type);
  }
  assert.deepEqual(
    music.map((f) => f.type),
    ['playback_state', 'title', 'artist', 'album', 'artwork', 'duration', 'position'],
  );
  const writable = music.filter((f) => !f.read_only);
  assert.deepEqual(
    writable.map((f) => [f.type, f.has_feedback, f.min, f.max]),
    [['playback_state', true, 0, 3]],
  );
  assert.equal(music.find((f) => f.type === 'position').unit, 'seconds');
});

test('input options use the names the receiver gave, per zone', () => {
  assert.deepEqual(inputOptions(described, 'main'), [
    { value: '10', label: 'Blu-ray', sort_order: 0 },
    { value: '23', label: 'CD & Co', sort_order: 1 },
    { value: '2B', label: 'NET', sort_order: 2 },
  ]);
  assert.deepEqual(
    inputOptions(described, 'zone2').map((o) => o.value),
    ['10', '2B', '80'],
  );
  assert.ok(inputOptions(plain, 'main').length > 20);
  assert.ok(!inputOptions(plain, 'main').some((o) => o.value === '80'));
});

test('names: brand and model, without repeating the brand', () => {
  assert.equal(receiverName(described), 'ONKYO TX-NR686');
  assert.equal(receiverName({ model: 'Onkyo TX-8270', description: null }), 'Onkyo TX-8270');
  assert.equal(receiverName({ model: '', description: null }), 'Onkyo AV receiver');
});

test('a feature or a device leads back to its receiver and zone', () => {
  const gladys = createFakeGladys();
  const ids = [plain.id];
  assert.deepEqual(locateFeature(gladys, ids, 'ext:onkyo:zone2:aabbccddeeff:volume'), {
    receiverId: plain.id,
    zone: 'zone2',
    key: 'volume',
  });
  assert.deepEqual(locateDevice(gladys, ids, 'ext:onkyo:receiver:aabbccddeeff'), {
    receiverId: plain.id,
    zone: 'main',
  });
  assert.equal(locateFeature(gladys, ids, 'ext:onkyo:receiver:other:volume'), null);
});

test('created devices give back their receivers, once each', () => {
  const gladys = createFakeGladys();
  const devices = buildDevices(gladys, [described], normalizeConfig());
  assert.equal(devices.length, 2);
  assert.deepEqual(receiversFromDevices(devices), [
    { id: 'aabbccddeeff', host: '10.0.0.5', port: 60128, model: 'TX-NR686' },
  ]);
  assert.deepEqual(receiversFromDevices([{ params: [] }]), []);
});
