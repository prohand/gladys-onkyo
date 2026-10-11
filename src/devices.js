// -----------------------------------------------------------------------------
// The Gladys devices: one per zone of each receiver.
//
// Zone 2 and zone 3 are separate rooms with their own power, volume and input:
// one device each lets the user put them in the right room and drive them on
// their own. The main zone carries what only it has: listening mode, tuner
// preset, network player keys and "now playing".
//
// External ids are built on the receiver's MAC address (what it answers to the
// discovery query): an IP changes with DHCP, a MAC does not. Feature keys are
// forever too: renaming one orphans the history and the scenes built on it.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { INPUTS, LISTENING_MODES, ZONE_EXTRA_INPUTS, ZONE_KEYS } from './onkyo/codes.js';

/** Device type namespace of each zone, part of the external ids. */
export const DEVICE_TYPES = { main: 'receiver', zone2: 'zone2', zone3: 'zone3' };

export const FEATURES = {
  POWER: 'power',
  VOLUME: 'volume',
  MUTE: 'mute',
  VOLUME_UP: 'volume-up',
  VOLUME_DOWN: 'volume-down',
  SOURCE: 'source',
  LISTENING_MODE: 'listening-mode',
  PLAY: 'play',
  PAUSE: 'pause',
  STOP: 'stop',
  NEXT: 'next',
  PREVIOUS: 'previous',
  PRESET: 'preset',
  NOW_PLAYING: 'now-playing',
};

const ZONE_NAMES = { main: '', zone2: 'Zone 2', zone3: 'Zone 3' };

/** `{ device, feature(key) }` of one zone of one receiver. */
export function zoneIds(gladys, receiverId, zone) {
  return gladys.externalIds(DEVICE_TYPES[zone], receiverId);
}

/**
 * The zones that get a Gladys device.
 * @param {{ description: object | null }} receiver
 * @param {{ zones: string }} config
 * @returns {string[]}
 */
export function zonesFor(receiver, config) {
  if (config.zones !== 'auto') {
    return ZONE_KEYS.slice(0, Number(config.zones));
  }
  const declared = (receiver.description?.zones ?? []).map((zone) => zone.key);
  return ZONE_KEYS.filter((zone) => zone === 'main' || declared.includes(zone));
}

/**
 * Inputs offered in a zone's source select: the ones the receiver declared for
 * that zone, under the names the user gave them, or the generic list.
 * @returns {Array<{ value: string, label: string, sort_order: number }>}
 */
export function inputOptions(receiver, zone) {
  const declared = (receiver.description?.inputs ?? []).filter((input) =>
    input.zones.includes(zone),
  );
  const list = declared.length > 0 ? declared : INPUTS;
  const withExtra =
    zone !== 'main' && !list.some((input) => input.code === ZONE_EXTRA_INPUTS[0].code)
      ? [...list, ...ZONE_EXTRA_INPUTS]
      : list;
  return withExtra.map((input, index) => ({
    value: input.code,
    label: input.label,
    sort_order: index,
  }));
}

export function listeningModeOptions() {
  return LISTENING_MODES.map((mode, index) => ({
    value: mode.code,
    label: mode.label,
    sort_order: index,
  }));
}

function pushButton(ids, key, name, type) {
  return {
    name,
    external_id: ids.feature(key),
    category: CATEGORIES.TELEVISION,
    type,
    min: 0,
    max: 1,
    read_only: false,
    has_feedback: false,
    keep_history: false,
  };
}

/** Brand + model, the default name of the device. */
export function receiverName(receiver) {
  const brand = receiver.description?.brand || 'Onkyo';
  const model = receiver.model || receiver.description?.model || 'AV receiver';
  return model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`;
}

/**
 * The discovery payload of one zone.
 * @param {object} gladys the SDK instance
 * @param {object} receiver a Receiver (id, host, port, model, description)
 * @param {string} zone 'main' | 'zone2' | 'zone3'
 */
export function buildZoneDevice(gladys, receiver, zone) {
  const ids = zoneIds(gladys, receiver.id, zone);
  const name = [receiverName(receiver), ZONE_NAMES[zone]].filter(Boolean).join(' ');
  const features = [
    {
      name: 'Power',
      external_id: ids.feature(FEATURES.POWER),
      category: CATEGORIES.TELEVISION,
      type: TYPES.TELEVISION.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    },
    {
      name: 'Volume',
      external_id: ids.feature(FEATURES.VOLUME),
      category: CATEGORIES.TELEVISION,
      type: TYPES.TELEVISION.VOLUME,
      unit: UNITS.PERCENT,
      min: 0,
      max: 100,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    },
    pushButton(ids, FEATURES.MUTE, 'Mute (toggle)', TYPES.TELEVISION.VOLUME_MUTE),
    pushButton(ids, FEATURES.VOLUME_UP, 'Volume up', TYPES.TELEVISION.VOLUME_UP),
    pushButton(ids, FEATURES.VOLUME_DOWN, 'Volume down', TYPES.TELEVISION.VOLUME_DOWN),
    {
      name: 'Input',
      external_id: ids.feature(FEATURES.SOURCE),
      category: CATEGORIES.TEXT,
      type: TYPES.TEXT.SELECT,
      min: 0,
      max: 0,
      read_only: false,
      has_feedback: true,
      keep_history: false,
      supported_options: inputOptions(receiver, zone),
    },
  ];

  if (zone === 'main') {
    features.push(
      {
        name: 'Listening mode',
        external_id: ids.feature(FEATURES.LISTENING_MODE),
        category: CATEGORIES.TEXT,
        type: TYPES.TEXT.SELECT,
        min: 0,
        max: 0,
        read_only: false,
        has_feedback: true,
        keep_history: false,
        supported_options: listeningModeOptions(),
      },
      pushButton(ids, FEATURES.PLAY, 'Play', TYPES.TELEVISION.PLAY),
      pushButton(ids, FEATURES.PAUSE, 'Pause', TYPES.TELEVISION.PAUSE),
      pushButton(ids, FEATURES.STOP, 'Stop', TYPES.TELEVISION.STOP),
      pushButton(ids, FEATURES.PREVIOUS, 'Previous track', TYPES.TELEVISION.PREVIOUS),
      pushButton(ids, FEATURES.NEXT, 'Next track', TYPES.TELEVISION.NEXT),
      {
        name: 'Tuner preset',
        external_id: ids.feature(FEATURES.PRESET),
        category: CATEGORIES.TELEVISION,
        type: TYPES.TELEVISION.CHANNEL,
        min: 1,
        max: 40,
        read_only: false,
        has_feedback: true,
        keep_history: false,
      },
      {
        name: 'Now playing',
        external_id: ids.feature(FEATURES.NOW_PLAYING),
        category: CATEGORIES.TEXT,
        type: TYPES.TEXT.TEXT,
        min: 0,
        max: 0,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
    );
  }

  return {
    name,
    external_id: ids.device,
    params: [
      { name: 'IP_ADDRESS', value: receiver.host },
      { name: 'PORT', value: String(receiver.port) },
      { name: 'RECEIVER_ID', value: receiver.id },
      { name: 'ZONE', value: zone },
      { name: 'MODEL', value: receiver.model || '' },
    ],
    features,
  };
}

/** Every zone device of every receiver. */
export function buildDevices(gladys, receivers, config) {
  return receivers.flatMap((receiver) =>
    zonesFor(receiver, config).map((zone) => buildZoneDevice(gladys, receiver, zone)),
  );
}

/**
 * Which receiver, zone and control a feature external id points at.
 * @returns {{ receiverId: string, zone: string, key: string } | null}
 */
export function locateFeature(gladys, receiverIds, featureExternalId) {
  for (const receiverId of receiverIds) {
    for (const zone of ZONE_KEYS) {
      const prefix = `${zoneIds(gladys, receiverId, zone).device}:`;
      if (featureExternalId.startsWith(prefix)) {
        return { receiverId, zone, key: featureExternalId.slice(prefix.length) };
      }
    }
  }
  return null;
}

/** Which receiver and zone a device external id points at. */
export function locateDevice(gladys, receiverIds, deviceExternalId) {
  for (const receiverId of receiverIds) {
    for (const zone of ZONE_KEYS) {
      if (zoneIds(gladys, receiverId, zone).device === deviceExternalId) {
        return { receiverId, zone };
      }
    }
  }
  return null;
}

/**
 * The receivers the user already created, read back from their device params:
 * at startup they are known before any scan.
 * @returns {Array<{ id: string, host: string, port: number, model: string }>}
 */
export function receiversFromDevices(devices) {
  const found = new Map();
  for (const device of devices ?? []) {
    const params = Object.fromEntries((device.params ?? []).map((p) => [p.name, p.value]));
    if (!params.RECEIVER_ID || !params.IP_ADDRESS || found.has(params.RECEIVER_ID)) {
      continue;
    }
    found.set(params.RECEIVER_ID, {
      id: params.RECEIVER_ID,
      host: params.IP_ADDRESS,
      port: Number(params.PORT) || undefined,
      model: params.MODEL ?? '',
    });
  }
  return [...found.values()];
}
