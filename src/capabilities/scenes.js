// -----------------------------------------------------------------------------
// Scene actions (Gladys 5.1+).
//
// Power, volume and input are device features: the core "control a device"
// action already drives them one by one. The actions here are the ones a
// device feature cannot express:
//   - play_source: wake the receiver, wait for it, pick the input and set the
//     volume, in the right order and in one card ("radio in the kitchen at
//     7:00");
//   - set_mute: on, off or toggle — the dashboard button can only toggle;
//   - set_listening_mode: by name, without knowing the receiver's codes;
//   - send_command: any ISCP command, for what this integration does not cover.
//
// Fields arrive RESOLVED by the core. Throwing fails this action only; an
// action is never a condition, its outputs are. Triggers are fired by the hub
// (src/hub.js), never as a consequence of an action here.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isValidRawCommand, listeningModeLabel } from '../onkyo/codes.js';

const logger = createLogger({ name: 'scenes' });

// A receiver just switched on ignores orders for a moment after it says "on".
export const POWER_ON_SETTLE_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const SCENE_ACTIONS = {
  async play_source(hub, fields, { settleMs = POWER_ON_SETTLE_MS } = {}) {
    const { receiver, zone } = hub.target(fields.device);
    logger.info(`play_source ${fields.source} on ${receiver.label} ${zone}`);
    if (receiver.zones[zone].power !== 1) {
      await receiver.setPower(zone, true);
      if (!(await receiver.waitFor(zone, 'power', 1))) {
        throw new Error(`${receiver.label} did not switch on`);
      }
      await sleep(settleMs);
    }
    await hub.setSource(receiver, zone, String(fields.source));
    const outputs = { source: String(fields.source) };
    if (fields.volume !== undefined && fields.volume !== null && fields.volume !== '') {
      outputs.volume = await hub.setVolume(receiver, zone, Number(fields.volume));
    }
    return outputs;
  },

  async set_mute(hub, fields) {
    const { receiver, zone } = hub.target(fields.device);
    await receiver.setMute(zone, fields.mode ?? 'toggle');
    const muted = await receiver.readMute(zone);
    return { muted: muted === 1 };
  },

  async set_listening_mode(hub, fields) {
    const { receiver, zone } = hub.target(fields.device);
    if (zone !== 'main') {
      throw new Error('The listening mode belongs to the main zone');
    }
    await receiver.setListeningMode(String(fields.mode));
    return { mode: listeningModeLabel(String(fields.mode)) };
  },

  async send_command(hub, fields) {
    const typed = String(fields.command ?? '').trim();
    // The command letters are capitals; the parameter is sent as typed.
    const command = typed.slice(0, 3).toUpperCase() + typed.slice(3);
    if (!isValidRawCommand(command)) {
      throw new Error(`"${fields.command}" is not an ISCP command (e.g. PWR01, MVL20, SLI23)`);
    }
    const { receiver } = hub.target(fields.device);
    const answer = await receiver.raw(command);
    return { answer: (answer ?? '').slice(0, 1000) };
  },
};
