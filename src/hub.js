// -----------------------------------------------------------------------------
// The receivers, seen from Gladys.
//
// One object owns them all: it finds them (network scan, addresses typed by
// hand, devices already created), keeps one Receiver per MAC address, turns
// what they report into Gladys states, transport badges, connection status and
// scene events, and turns Gladys orders into ISCP commands.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { Receiver } from './onkyo/receiver.js';
import { probeHost, parseHosts, scanLan } from './onkyo/discovery.js';
import { inputLabel, percentToVolume, volumeToPercent, ZONE_KEYS } from './onkyo/codes.js';
import {
  buildDevices,
  FEATURES,
  locateDevice,
  locateFeature,
  receiverName,
  receiversFromDevices,
  zoneIds,
  zonesFor,
} from './devices.js';
import { normalizeConfig } from './config.js';

const logger = createLogger({ name: 'hub' });

export const SCENE_TRIGGERS = {
  SOURCE_CHANGED: 'source_changed',
  TRACK_CHANGED: 'track_changed',
  CONNECTION_CHANGED: 'connection_changed',
};

// An input change that follows a Gladys order by less than this is that
// order's echo: it never fires `source_changed`, so a scene reacting to it
// cannot loop through the integration.
export const OWN_ORDER_WINDOW_MS = 5000;

const NO_TRACK = '—';

export class ReceiverHub {
  /**
   * @param {object} gladys the SDK instance
   * @param {object} [options] injections for the tests
   */
  constructor(gladys, options = {}) {
    this.gladys = gladys;
    this.config = normalizeConfig();
    this.receivers = new Map();
    this.everOnline = new Set();
    this.ownOrders = new Map();
    this.published = new Map();
    this.lastStatus = null;
    this.reportTimer = null;
    this.publishTimer = null;
    this.onWidgetChange = () => {};
    this.createReceiver = options.createReceiver ?? ((info) => new Receiver(info));
    this.probe = options.probe ?? probeHost;
    this.scan = options.scan ?? scanLan;
    this.now = options.now ?? (() => Date.now());
    this.reportDelayMs = options.reportDelayMs ?? 500;
  }

  setConfig(config) {
    this.config = config;
  }

  get list() {
    return [...this.receivers.values()];
  }

  /**
   * (Re)connect every receiver Gladys already knows (created devices) and
   * every one typed by hand, then publish them. Run at every connection to
   * Gladys and every configuration change.
   */
  async sync() {
    for (const info of receiversFromDevices(this.gladys.devices)) {
      this.ensure(info);
    }
    await this.probeConfiguredHosts();
    await this.publishDevices();
    this.publishAll();
    this.scheduleReport();
  }

  /**
   * Publish every state already known again: Gladys may have missed them
   * while it was away, and a device just created has none yet.
   */
  publishAll() {
    this.published.clear();
    for (const receiver of this.list) {
      for (const zone of ZONE_KEYS) {
        const { power, volume, source } = receiver.zones[zone];
        if (power !== null) {
          this.publish(receiver, zone, FEATURES.POWER, power);
        }
        if (volume !== null) {
          const percent = volumeToPercent(volume, this.config.volume_resolution);
          this.publish(receiver, zone, FEATURES.VOLUME, percent);
        }
        if (source !== null) {
          this.publish(receiver, zone, FEATURES.SOURCE, { text: source });
        }
      }
      const { listeningMode, preset } = receiver.main;
      if (listeningMode !== null) {
        this.publish(receiver, 'main', FEATURES.LISTENING_MODE, { text: listeningMode });
      }
      if (preset !== null) {
        this.publish(receiver, 'main', FEATURES.PRESET, preset);
      }
      if (receiver.online) {
        this.publish(receiver, 'main', FEATURES.NOW_PLAYING, {
          text: receiver.nowPlaying || NO_TRACK,
        });
      }
    }
  }

  /** The Discovery tab: scan the LAN through the core, plus the typed hosts. */
  async discover() {
    try {
      for (const info of await this.scan(this.gladys)) {
        this.ensure(info);
      }
    } catch (err) {
      // An older core, or a scan asked twice within 10 s: the typed addresses
      // and the known receivers still make the list.
      logger.warn(`Network scan failed: ${err.message}`);
    }
    await this.probeConfiguredHosts();
    await this.publishDevices();
    this.scheduleReport();
  }

  async probeConfiguredHosts() {
    const hosts = parseHosts(this.config.hosts);
    const found = await Promise.all(hosts.map((target) => this.probe(target)));
    found.forEach((info, index) => {
      if (info) {
        this.ensure(info);
      } else {
        logger.warn(`No Onkyo receiver answered at ${hosts[index].host}:${hosts[index].port}`);
      }
    });
    return found;
  }

  /**
   * The Receiver of a MAC address: created and connected the first time,
   * pointed at its new IP when DHCP moved it.
   */
  ensure({ id, host, port, model }) {
    const known = this.receivers.get(id);
    if (known) {
      if (host) {
        known.moveTo(host, port ?? known.port);
      }
      if (model && !known.model) {
        known.model = model;
      }
      return known;
    }
    const receiver = this.createReceiver({ id, host, port, model });
    this.receivers.set(id, receiver);
    receiver.on('change', (change) => this.handleChange(receiver, change));
    receiver.on('track', (track) => this.handleTrack(receiver, track));
    receiver.on('online', () => this.handleOnline(receiver, true));
    receiver.on('offline', () => this.handleOnline(receiver, false));
    receiver.on('description', () => this.schedulePublishDevices());
    logger.info(`Receiver ${receiver.label} [${id}]`);
    receiver.start();
    return receiver;
  }

  stop() {
    clearTimeout(this.reportTimer);
    clearTimeout(this.publishTimer);
    for (const receiver of this.receivers.values()) {
      receiver.stop();
    }
  }

  async publishDevices() {
    await this.gladys.publishDiscoveredDevices(buildDevices(this.gladys, this.list, this.config));
  }

  // The description (zones, input names) arrives after the connection: publish
  // once it is there, not once per receiver.
  schedulePublishDevices() {
    clearTimeout(this.publishTimer);
    this.publishTimer = setTimeout(() => {
      this.publishDevices().catch((err) => logger.warn(`Publish failed: ${err.message}`));
    }, this.reportDelayMs);
    this.publishTimer.unref?.();
  }

  // --- What the receivers report ---------------------------------------------

  isCreated(deviceExternalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === deviceExternalId);
  }

  async publish(receiver, zone, key, value) {
    if (!zonesFor(receiver, this.config).includes(zone)) {
      return;
    }
    const ids = zoneIds(this.gladys, receiver.id, zone);
    if (!this.isCreated(ids.device)) {
      return;
    }
    const featureId = ids.feature(key);
    const signature = JSON.stringify(value);
    if (this.published.get(featureId) === signature) {
      return;
    }
    this.published.set(featureId, signature);
    try {
      await this.gladys.publishState(featureId, value);
    } catch (err) {
      this.published.delete(featureId);
      logger.warn(`State of ${featureId} not published: ${err.message}`);
    }
  }

  handleChange(receiver, { zone, key, value, previous }) {
    this.onWidgetChange();
    switch (key) {
      case 'power':
        this.publish(receiver, zone, FEATURES.POWER, value);
        break;
      case 'volume':
        this.publish(
          receiver,
          zone,
          FEATURES.VOLUME,
          volumeToPercent(value, this.config.volume_resolution),
        );
        break;
      case 'source':
        this.publish(receiver, zone, FEATURES.SOURCE, { text: value });
        if (previous !== null && previous !== undefined) {
          this.fireSourceChanged(receiver, zone, value);
        }
        break;
      case 'listeningMode':
        this.publish(receiver, 'main', FEATURES.LISTENING_MODE, { text: value });
        break;
      case 'preset':
        this.publish(receiver, 'main', FEATURES.PRESET, value);
        break;
      case 'title':
      case 'artist':
        this.publish(receiver, 'main', FEATURES.NOW_PLAYING, {
          text: receiver.nowPlaying || NO_TRACK,
        });
        break;
      default:
        break;
    }
  }

  fireSourceChanged(receiver, zone, source) {
    if (!zonesFor(receiver, this.config).includes(zone)) {
      return;
    }
    const ordered = this.ownOrders.get(`${receiver.id}:${zone}:source`);
    if (ordered !== undefined && this.now() - ordered < OWN_ORDER_WINDOW_MS) {
      return;
    }
    this.fireSceneEvent(SCENE_TRIGGERS.SOURCE_CHANGED, {
      device: zoneIds(this.gladys, receiver.id, zone).device,
      source,
      source_name: inputLabel(source, receiver.description?.inputs),
    });
  }

  handleTrack(receiver, { title, artist, album }) {
    this.fireSceneEvent(SCENE_TRIGGERS.TRACK_CHANGED, {
      device: zoneIds(this.gladys, receiver.id, 'main').device,
      title,
      artist,
      album,
    });
  }

  handleOnline(receiver, online) {
    this.onWidgetChange();
    this.scheduleReport();
    if (online && !this.everOnline.has(receiver.id)) {
      // The first connection is not a change: a restart of Gladys must not
      // run the "receiver back online" scenes.
      this.everOnline.add(receiver.id);
      return;
    }
    if (!this.everOnline.has(receiver.id)) {
      return;
    }
    for (const zone of zonesFor(receiver, this.config)) {
      this.fireSceneEvent(SCENE_TRIGGERS.CONNECTION_CHANGED, {
        device: zoneIds(this.gladys, receiver.id, zone).device,
        state: online ? 'online' : 'offline',
      });
    }
  }

  fireSceneEvent(key, data) {
    this.gladys
      .publishSceneEvent(key, data)
      .catch((err) => logger.warn(`Scene event ${key} not sent: ${err.message}`));
  }

  // --- Badges and connection status --------------------------------------------

  scheduleReport() {
    clearTimeout(this.reportTimer);
    this.reportTimer = setTimeout(() => {
      this.report().catch((err) => logger.warn(`Status not reported: ${err.message}`));
    }, this.reportDelayMs);
    this.reportTimer.unref?.();
  }

  async report() {
    const entries = this.list.flatMap((receiver) =>
      zonesFor(receiver, this.config).map((zone) => ({
        external_id: zoneIds(this.gladys, receiver.id, zone).device,
        transport: receiver.online ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE,
      })),
    );
    if (entries.length > 0) {
      await this.gladys.publishTransports(entries);
    }
    const status = this.connectionStatus();
    const signature = JSON.stringify(status);
    if (signature !== this.lastStatus) {
      this.lastStatus = signature;
      await this.gladys.setConnectionStatus(status.connected, status.message);
    }
  }

  connectionStatus() {
    if (this.receivers.size === 0) {
      return {
        connected: true,
        message: {
          en: 'No receiver yet: open the Discovery tab, or type its address in the configuration.',
          fr: "Aucun ampli pour l'instant : ouvrez l'onglet Découverte, ou saisissez son adresse dans la configuration.",
        },
      };
    }
    const offline = this.list.filter((receiver) => !receiver.online);
    if (offline.length === 0) {
      return { connected: true };
    }
    const names = offline.map((receiver) => receiver.label).join(', ');
    return {
      connected: false,
      message: {
        en: `Unreachable: ${names}. Check that it is plugged in and that its network standby is on.`,
        fr: `Injoignable : ${names}. Vérifiez qu'il est branché et que sa veille réseau est activée.`,
      },
    };
  }

  // --- Orders ------------------------------------------------------------------

  /** The receiver and zone behind a Gladys device external id. */
  target(deviceExternalId) {
    const located = locateDevice(this.gladys, [...this.receivers.keys()], deviceExternalId);
    if (!located) {
      throw new Error(`Unknown Onkyo device ${deviceExternalId}`);
    }
    const receiver = this.receivers.get(located.receiverId);
    if (!receiver.online) {
      throw new Error(`${receiver.label} is not reachable`);
    }
    return { receiver, zone: located.zone };
  }

  async handleSetValue(feature, value) {
    const located = locateFeature(this.gladys, [...this.receivers.keys()], feature.external_id);
    if (!located) {
      throw new Error(`Unknown Onkyo feature ${feature.external_id}`);
    }
    const receiver = this.receivers.get(located.receiverId);
    if (!receiver.online) {
      throw new Error(`${receiver.label} is not reachable`);
    }
    const { zone, key } = located;
    switch (key) {
      case FEATURES.POWER:
        return receiver.setPower(zone, Number(value) === 1);
      case FEATURES.VOLUME:
        return this.setVolume(receiver, zone, value);
      case FEATURES.MUTE:
        return receiver.setMute(zone, 'toggle');
      case FEATURES.VOLUME_UP:
        return this.volumeStep(receiver, zone, true);
      case FEATURES.VOLUME_DOWN:
        return this.volumeStep(receiver, zone, false);
      case FEATURES.SOURCE:
        return this.setSource(receiver, zone, String(value));
      case FEATURES.LISTENING_MODE:
        return receiver.setListeningMode(String(value));
      case FEATURES.PRESET:
        return receiver.setPreset(value);
      case FEATURES.PLAY:
      case FEATURES.PAUSE:
      case FEATURES.STOP:
      case FEATURES.NEXT:
      case FEATURES.PREVIOUS:
        return receiver.netKey(key);
      default:
        throw new Error(`Feature ${key} cannot be controlled`);
    }
  }

  /** @returns {Promise<number>} the volume really asked, in percent */
  async setVolume(receiver, zone, percent) {
    const { percent: sent, hex } = percentToVolume(
      percent,
      this.config.volume_resolution,
      this.config.max_volume,
    );
    if (sent < Number(percent)) {
      logger.info(`Volume ${percent}% capped to ${sent}% (maximum volume setting)`);
    }
    await receiver.setVolumeHex(zone, hex);
    return sent;
  }

  async volumeStep(receiver, zone, up) {
    const current = receiver.zones[zone].volume;
    const resolution = this.config.volume_resolution;
    if (
      up &&
      current !== null &&
      volumeToPercent(current + 1, resolution) > this.config.max_volume
    ) {
      // One more step would cross the safety cap: stay on the cap.
      await this.setVolume(receiver, zone, this.config.max_volume);
      return;
    }
    await receiver.volumeStep(zone, up);
  }

  async setSource(receiver, zone, code) {
    this.ownOrders.set(`${receiver.id}:${zone}:source`, this.now());
    await receiver.setSource(zone, code);
  }

  // --- Read side, for the widget and the actions -------------------------------

  /**
   * A readable snapshot of one zone.
   * @returns {object | null}
   */
  zoneState(receiver, zone) {
    const state = receiver.zones[zone];
    return {
      id: receiver.id,
      zone,
      name: [receiverName(receiver), zone === 'main' ? '' : zone.replace('zone', 'Zone ')]
        .filter(Boolean)
        .join(' '),
      online: receiver.online,
      host: receiver.host,
      power: state.power,
      volume:
        state.volume === null ? null : volumeToPercent(state.volume, this.config.volume_resolution),
      mute: state.mute,
      source: state.source,
      sourceName: state.source ? inputLabel(state.source, receiver.description?.inputs) : null,
      listeningMode: zone === 'main' ? receiver.main.listeningMode : null,
      nowPlaying: zone === 'main' ? receiver.nowPlaying : '',
      deviceExternalId: zoneIds(this.gladys, receiver.id, zone).device,
    };
  }

  /** The zone a widget shows: the one chosen, or the first receiver's main zone. */
  findZone(deviceExternalId) {
    if (deviceExternalId) {
      const located = locateDevice(this.gladys, [...this.receivers.keys()], deviceExternalId);
      if (located) {
        return this.zoneState(this.receivers.get(located.receiverId), located.zone);
      }
    }
    const first = this.list[0];
    return first ? this.zoneState(first, 'main') : null;
  }

  /** Every zone of every receiver, for the connection test. */
  allZones() {
    return this.list.flatMap((receiver) =>
      ZONE_KEYS.filter((zone) => zonesFor(receiver, this.config).includes(zone)).map((zone) =>
        this.zoneState(receiver, zone),
      ),
    );
  }
}
