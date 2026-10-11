// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user from the `config_schema` of
// gladys-assistant-integration.json. This module provides the defaults (they
// MUST match the manifest `default` values, see test/manifest.test.js) and
// normalizes what Gladys sends, so the rest of the code never deals with
// strings where it expects numbers, or with `undefined`.
// -----------------------------------------------------------------------------

import { VOLUME_RESOLUTIONS } from './onkyo/codes.js';

export const DEFAULT_CONFIG = {
  // Receivers typed by hand, for the ones the network scan cannot reach.
  hosts: '',
  // 'auto' (what the receiver says it has, the main zone alone when it says
  // nothing), or '1', '2', '3': how many zones get a Gladys device.
  zones: 'auto',
  // Steps of the receiver volume scale, as a string (a select value).
  volume_resolution: '80',
  // Safety cap, in percent of the scale: Gladys never sends a volume above it.
  max_volume: 80,
  debug_logs: false,
};

/**
 * Merge the user config with the defaults, and fix the types.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const resolution = Number(raw.volume_resolution ?? DEFAULT_CONFIG.volume_resolution);
  const maxVolume = Number(raw.max_volume ?? DEFAULT_CONFIG.max_volume);
  const zones = String(raw.zones ?? DEFAULT_CONFIG.zones);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    hosts: typeof raw.hosts === 'string' ? raw.hosts : DEFAULT_CONFIG.hosts,
    zones: ['auto', '1', '2', '3'].includes(zones) ? zones : DEFAULT_CONFIG.zones,
    volume_resolution: VOLUME_RESOLUTIONS.includes(resolution)
      ? resolution
      : Number(DEFAULT_CONFIG.volume_resolution),
    max_volume:
      Number.isFinite(maxVolume) && maxVolume >= 1
        ? Math.min(100, Math.round(maxVolume))
        : DEFAULT_CONFIG.max_volume,
    debug_logs: raw.debug_logs === true,
  };
}
