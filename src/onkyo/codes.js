// -----------------------------------------------------------------------------
// The ISCP vocabulary this integration speaks: zones, inputs, listening modes,
// volume scale.
//
// The codes come from Onkyo's published ISCP command list. The labels are the
// ones printed on the receivers' front panel, so they need no translation; when
// the receiver describes itself (NRI, see nri.js), the names the user gave its
// inputs replace them.
// -----------------------------------------------------------------------------

/** The zones, and the command that drives each of their controls. */
export const ZONES = {
  main: { power: 'PWR', volume: 'MVL', mute: 'AMT', source: 'SLI' },
  zone2: { power: 'ZPW', volume: 'ZVL', mute: 'ZMT', source: 'SLZ' },
  zone3: { power: 'PW3', volume: 'VL3', mute: 'MT3', source: 'SL3' },
};

export const ZONE_KEYS = Object.keys(ZONES);

/** Commands only the main zone has. */
export const MAIN_ONLY = {
  listeningMode: 'LMD',
  preset: 'PRS',
  netControl: 'NTC',
  title: 'NTI',
  artist: 'NAT',
  album: 'NAL',
};

/**
 * Input selector codes (SLI / SLZ / SL3), in the order the options are shown.
 * A receiver only has some of them; the NRI description says which ones.
 */
export const INPUTS = [
  { code: '10', label: 'BD/DVD' },
  { code: '01', label: 'CBL/SAT' },
  { code: '00', label: 'STB/DVR' },
  { code: '02', label: 'GAME' },
  { code: '11', label: 'STRM BOX' },
  { code: '05', label: 'PC' },
  { code: '03', label: 'AUX' },
  { code: '04', label: 'AUX2' },
  { code: '12', label: 'TV' },
  { code: '23', label: 'CD' },
  { code: '22', label: 'PHONO' },
  { code: '20', label: 'TAPE' },
  { code: '24', label: 'FM' },
  { code: '25', label: 'AM' },
  { code: '26', label: 'TUNER' },
  { code: '33', label: 'DAB' },
  { code: '2B', label: 'NET' },
  { code: '27', label: 'MUSIC SERVER' },
  { code: '28', label: 'INTERNET RADIO' },
  { code: '29', label: 'USB (front)' },
  { code: '2A', label: 'USB (rear)' },
  { code: '2E', label: 'BLUETOOTH' },
  { code: '2D', label: 'AIRPLAY' },
  { code: '41', label: 'LINE' },
  { code: '44', label: 'OPTICAL' },
  { code: '45', label: 'COAXIAL' },
  { code: '30', label: 'MULTI CH' },
];

/** Zone 2 and 3 can also follow the main zone, or play nothing. */
export const ZONE_EXTRA_INPUTS = [{ code: '80', label: 'MAIN SOURCE' }];

/** Listening modes (LMD), the ones most receivers offer. */
export const LISTENING_MODES = [
  { code: '00', label: 'Stereo' },
  { code: '01', label: 'Direct' },
  { code: '11', label: 'Pure Audio' },
  { code: '0F', label: 'Mono' },
  { code: '0C', label: 'All Ch Stereo' },
  { code: '02', label: 'Surround' },
  { code: '40', label: 'Straight Decode' },
  { code: '80', label: 'Dolby Surround / PLII Movie' },
  { code: '81', label: 'PLII Music' },
  { code: '86', label: 'PLII Game' },
  { code: '82', label: 'DTS Neural:X / Neo:6 Cinema' },
  { code: '83', label: 'Neo:6 Music' },
  { code: '03', label: 'Film' },
  { code: '05', label: 'Action' },
  { code: '06', label: 'Musical' },
  { code: '08', label: 'Orchestra' },
  { code: '09', label: 'Unplugged' },
  { code: '0A', label: 'Studio-Mix' },
  { code: '0B', label: 'TV Logic' },
  { code: '0D', label: 'Theater-Dimensional' },
  { code: '0E', label: 'Enhance' },
  { code: '14', label: 'Dolby Virtual' },
  { code: 'FF', label: 'Auto Surround' },
];

/** Network / USB player keys (NTC). */
export const NET_KEYS = {
  play: 'PLAY',
  pause: 'PAUSE',
  stop: 'STOP',
  next: 'TRUP',
  previous: 'TRDN',
};

/** Volume scales a receiver may use: how many steps from silence to the top. */
export const VOLUME_RESOLUTIONS = [50, 80, 100, 200];

/**
 * Receiver volume step → percent of its scale.
 * @param {number} raw
 * @param {number} resolution steps of the receiver scale (see VOLUME_RESOLUTIONS)
 */
export function volumeToPercent(raw, resolution) {
  return Math.max(0, Math.min(100, Math.round((raw * 100) / resolution)));
}

/**
 * Percent → the receiver step to send, hex encoded as ISCP wants it, never
 * above the safety cap the user set.
 * @param {number} percent wanted volume, 0-100
 * @param {number} resolution steps of the receiver scale
 * @param {number} maxPercent safety cap (`max_volume`)
 * @returns {{ percent: number, hex: string }} what was really asked of the receiver
 */
export function percentToVolume(percent, resolution, maxPercent = 100) {
  const capped = Math.max(0, Math.min(Number(percent) || 0, maxPercent, 100));
  const raw = Math.round((capped * resolution) / 100);
  return {
    percent: volumeToPercent(raw, resolution),
    hex: raw.toString(16).toUpperCase().padStart(2, '0'),
  };
}

/** Parse a hex ISCP number (`28` → 40). `N/A` and garbage → null. */
export function parseHex(value) {
  return /^[0-9A-Fa-f]{1,4}$/.test(value) ? Number.parseInt(value, 16) : null;
}

/** ISCP on/off (`00` / `01`) → 0 / 1. Anything else → null. */
export function parseOnOff(value) {
  if (value === '01') {
    return 1;
  }
  if (value === '00') {
    return 0;
  }
  return null;
}

/** Label of an input code, from a list or the generic table. */
export function inputLabel(code, inputs = INPUTS) {
  return (
    inputs.find((input) => input.code === code)?.label ??
    [...INPUTS, ...ZONE_EXTRA_INPUTS].find((input) => input.code === code)?.label ??
    `Input ${code}`
  );
}

/** Label of a listening mode code. */
export function listeningModeLabel(code) {
  return LISTENING_MODES.find((mode) => mode.code === code)?.label ?? `Mode ${code}`;
}

/**
 * A raw ISCP command typed by a user: 3 capital letters and a parameter, plain
 * printable ASCII, nothing that could end the line early.
 */
export function isValidRawCommand(command) {
  return /^[A-Z0-9]{3}[\x20-\x7e]{1,60}$/.test(command);
}
