// -----------------------------------------------------------------------------
// One receiver: its link, what it last reported, and the orders it takes.
//
// The state kept here is the receiver's own word: a value is only ever set
// from a message the receiver sent, never from the order Gladys gave. An order
// the receiver ignores (an input it does not have, a zone switched off) thus
// never shows as done in Gladys.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createLogger, MUSIC_PLAYBACK_STATE } from '@gladysassistant/integration-sdk';
import { EiscpConnection } from './connection.js';
import {
  MAIN_ONLY,
  NET_KEYS,
  PLAYBACK_KEYS,
  ZONES,
  parseHex,
  parseNetStatus,
  parseNetTime,
  parseOnOff,
} from './codes.js';
import { JacketArt } from './jacketArt.js';
import { parseNri } from './nri.js';

const logger = createLogger({ name: 'receiver' });

// Track title, artist and album arrive as three messages: wait for the three
// before saying "the track changed", so a scene gets the whole of it, once.
export const TRACK_SETTLE_MS = 1500;

// Command → which zone and which control it reports.
const ROUTES = new Map(
  Object.entries(ZONES).flatMap(([zone, commands]) =>
    Object.entries(commands).map(([key, command]) => [command, { zone, key }]),
  ),
);

export class Receiver extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.id stable identifier (the receiver's MAC address)
   * @param {string} options.host
   * @param {number} [options.port]
   * @param {string} [options.model]
   * @param {object} [options.connection] an EiscpConnection-like object, for the tests
   * @param {number} [options.describeTimeoutMs] how long to wait for the NRI answer
   */
  constructor({ id, host, port, model = '', connection, describeTimeoutMs = 5000, ...rest }) {
    super();
    this.id = id;
    this.describeTimeoutMs = describeTimeoutMs;
    this.model = model;
    this.description = null;
    this.zones = Object.fromEntries(
      Object.keys(ZONES).map((zone) => [
        zone,
        { power: null, volume: null, mute: null, source: null },
      ]),
    );
    this.main = {
      listeningMode: null,
      preset: null,
      title: '',
      artist: '',
      album: '',
      // Network player: MUSIC_PLAYBACK_STATE, and seconds (NTM).
      playback: null,
      position: null,
      duration: null,
    };
    this.jacketArt = new JacketArt();
    this.lastTrack = null;
    this.trackTimer = null;
    this.connection = connection ?? new EiscpConnection({ host, port, ...rest });
    this.connection.on('message', (message) => this.handleMessage(message));
    this.connection.on('online', () => {
      this.emit('online');
      this.refresh().catch((err) => logger.warn(`${this.label}: refresh failed: ${err.message}`));
    });
    this.connection.on('offline', () => this.emit('offline'));
  }

  get host() {
    return this.connection.host;
  }

  get port() {
    return this.connection.port;
  }

  get online() {
    return this.connection.online;
  }

  get label() {
    return `${this.model || 'Receiver'} (${this.host})`;
  }

  /** Point the link at a new address (DHCP gave the receiver another IP). */
  moveTo(host, port = this.port) {
    if (host === this.host && port === this.port) {
      return;
    }
    logger.info(`${this.label} moved to ${host}:${port}`);
    this.connection.stop();
    this.connection.host = host;
    this.connection.port = port;
    this.connection.start();
  }

  start() {
    this.connection.start();
  }

  stop() {
    clearTimeout(this.trackTimer);
    this.connection.stop();
  }

  /**
   * Ask the receiver for everything it can report. The answers come back as
   * ordinary messages, through handleMessage.
   * @param {string[]} [zones] zones to read (main always included)
   */
  async refresh(zones = Object.keys(ZONES)) {
    const commands = [];
    for (const zone of new Set(['main', ...zones])) {
      commands.push(...Object.values(ZONES[zone]).map((command) => `${command}QSTN`));
    }
    commands.push(`${MAIN_ONLY.listeningMode}QSTN`, `${MAIN_ONLY.title}QSTN`);
    commands.push(`${MAIN_ONLY.artist}QSTN`, `${MAIN_ONLY.album}QSTN`);
    commands.push(`${MAIN_ONLY.netStatus}QSTN`, `${MAIN_ONLY.netTime}QSTN`);
    // The cover is only sent on a track change: ask for the current one (a
    // model without this request just ignores it).
    commands.push(`${MAIN_ONLY.jacketArt}REQ`);
    for (const command of commands) {
      await this.connection.send(command);
    }
    if (!this.description) {
      await this.describe();
    }
  }

  /** Ask the receiver to describe itself (NRI). Older models never answer. */
  async describe() {
    try {
      // The answer goes through handleMessage like any other (it runs before
      // this await resumes), which is what fills `this.description`.
      await this.connection.query('NRIQSTN', this.describeTimeoutMs);
      return this.description;
    } catch {
      logger.debug(`${this.label} gave no NRI description (older model)`);
      return null;
    }
  }

  handleMessage({ command, value }) {
    const route = ROUTES.get(command);
    if (route) {
      this.update(route.zone, route.key, parseZoneValue(route.key, value));
      if (route.zone === 'main' && route.key === 'power' && value === '00') {
        // A receiver in standby plays nothing, whatever its player said last.
        this.update('main', 'playback', MUSIC_PLAYBACK_STATE.IDLE);
      }
      return;
    }
    switch (command) {
      case MAIN_ONLY.listeningMode:
        this.update('main', 'listeningMode', /^[0-9A-F]{2}$/.test(value) ? value : null);
        break;
      case MAIN_ONLY.preset:
        this.update('main', 'preset', parseHex(value));
        break;
      case MAIN_ONLY.title:
      case MAIN_ONLY.artist:
      case MAIN_ONLY.album:
        this.updateTrack(command, value);
        break;
      case MAIN_ONLY.netStatus:
        this.update('main', 'playback', parseNetStatus(value));
        break;
      case MAIN_ONLY.netTime:
        this.updateTime(value);
        break;
      case MAIN_ONLY.jacketArt: {
        const artwork = this.jacketArt.push(value);
        if (artwork !== undefined) {
          this.emit('artwork', artwork);
        }
        break;
      }
      case 'NRI': {
        const description = parseNri(value);
        if (description) {
          this.description = description;
          if (description.model && !this.model) {
            this.model = description.model;
          }
          this.emit('description', description);
        }
        break;
      }
      default:
        break;
    }
  }

  update(zone, key, value) {
    if (value === null || value === undefined) {
      return;
    }
    const holder = key in this.zones[zone] ? this.zones[zone] : this.main;
    const previous = holder[key];
    if (previous === value) {
      return;
    }
    holder[key] = value;
    this.emit('change', { zone, key, value, previous });
  }

  updateTrack(command, value) {
    const key = { NTI: 'title', NAT: 'artist', NAL: 'album' }[command];
    const text = value === 'N/A' ? '' : value.trim();
    if (this.main[key] === text) {
      return;
    }
    this.main[key] = text;
    this.emit('change', { zone: 'main', key, value: text });
    clearTimeout(this.trackTimer);
    this.trackTimer = setTimeout(() => this.settleTrack(), TRACK_SETTLE_MS);
    this.trackTimer.unref?.();
  }

  /**
   * NTM, sent every second while a track plays: a `time` event, not a
   * `change` (it would nudge the widget every second).
   */
  updateTime(value) {
    const time = parseNetTime(value);
    if (!time || (time.position === this.main.position && time.duration === this.main.duration)) {
      return;
    }
    this.main.position = time.position;
    this.main.duration = time.duration;
    this.emit('time', time);
  }

  settleTrack() {
    const { title, artist, album } = this.main;
    const signature = `${title}\u0000${artist}\u0000${album}`;
    if (!title || signature === this.lastTrack) {
      return;
    }
    // The first track known after a (re)connection is not a change: a restart
    // of Gladys must not re-run the scenes.
    const first = this.lastTrack === null;
    this.lastTrack = signature;
    if (!first) {
      this.emit('track', { title, artist, album });
    }
  }

  /** Text shown as "now playing": the artist and the title the receiver gave. */
  get nowPlaying() {
    const { title, artist } = this.main;
    return [artist, title].filter(Boolean).join(' – ');
  }

  // --- Orders ----------------------------------------------------------------

  setPower(zone, on) {
    return this.connection.send(`${ZONES[zone].power}${on ? '01' : '00'}`);
  }

  setVolumeHex(zone, hex) {
    return this.connection.send(`${ZONES[zone].volume}${hex}`);
  }

  volumeStep(zone, up) {
    return this.connection.send(`${ZONES[zone].volume}${up ? 'UP' : 'DOWN'}`);
  }

  /** @param {'on' | 'off' | 'toggle'} mode */
  setMute(zone, mode) {
    const parameter = { on: '01', off: '00', toggle: 'TG' }[mode];
    if (!parameter) {
      throw new Error(`Unknown mute mode "${mode}"`);
    }
    return this.connection.send(`${ZONES[zone].mute}${parameter}`);
  }

  setSource(zone, code) {
    if (!/^[0-9A-F]{2}$/.test(code)) {
      throw new Error(`Invalid input code "${code}"`);
    }
    return this.connection.send(`${ZONES[zone].source}${code}`);
  }

  setListeningMode(code) {
    if (!/^[0-9A-F]{2}$/.test(code)) {
      throw new Error(`Invalid listening mode "${code}"`);
    }
    return this.connection.send(`${MAIN_ONLY.listeningMode}${code}`);
  }

  setPreset(number) {
    const preset = Math.round(Number(number));
    if (!Number.isInteger(preset) || preset < 1 || preset > 40) {
      throw new Error(`Invalid preset "${number}" (1 to 40)`);
    }
    return this.connection.send(
      `${MAIN_ONLY.preset}${preset.toString(16).toUpperCase().padStart(2, '0')}`,
    );
  }

  /** @param {keyof NET_KEYS} key play, pause, stop, next, previous */
  netKey(key) {
    const parameter = NET_KEYS[key];
    if (!parameter) {
      throw new Error(`Unknown player key "${key}"`);
    }
    return this.connection.send(`${MAIN_ONLY.netControl}${parameter}`);
  }

  /**
   * Play, pause or stop the network player.
   * @param {number} state MUSIC_PLAYBACK_STATE: PLAYING, PAUSED or IDLE (stop)
   */
  setPlayback(state) {
    const key = PLAYBACK_KEYS[Number(state)];
    if (!key) {
      throw new Error(`Unsupported playback state "${state}" (0 pause, 1 play, 2 stop)`);
    }
    return this.netKey(key);
  }

  /**
   * Wait until the receiver REPORTS a value (a power-on takes a few seconds,
   * and orders sent before it are ignored).
   * @returns {Promise<boolean>} false when it did not come in time
   */
  waitFor(zone, key, value, timeoutMs = 8000) {
    const holder = key in this.zones[zone] ? this.zones[zone] : this.main;
    if (holder[key] === value) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const onChange = (change) => {
        if (change.zone === zone && change.key === key && change.value === value) {
          done(true);
        }
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      const done = (result) => {
        clearTimeout(timer);
        this.off('change', onChange);
        resolve(result);
      };
      this.on('change', onChange);
    });
  }

  /** Ask the mute state again: 1, 0, or null when the receiver did not say. */
  async readMute(zone) {
    try {
      const answer = await this.connection.query(`${ZONES[zone].mute}QSTN`);
      return parseOnOff(answer.value);
    } catch {
      return null;
    }
  }

  /** A raw ISCP command, and the receiver's answer to it (or null). */
  async raw(command) {
    try {
      const answer = await this.connection.query(command);
      return `${answer.command}${answer.value}`;
    } catch (err) {
      if (!this.online) {
        throw err;
      }
      return null;
    }
  }
}

function parseZoneValue(key, value) {
  switch (key) {
    case 'power':
    case 'mute':
      return parseOnOff(value);
    case 'volume':
      return parseHex(value);
    case 'source':
      return /^[0-9A-F]{2}$/.test(value) ? value : null;
    default:
      return null;
  }
}
