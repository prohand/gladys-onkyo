// -----------------------------------------------------------------------------
// NRI: the receiver describes itself.
//
// `NRIQSTN` makes a network receiver (Onkyo 2014 and later, most Pioneer and
// Integra models) answer with an XML document: model, MAC address, the zones it
// has, and the inputs it shows — with the names the user gave them. Older models
// answer nothing: every caller treats a missing description as "use the
// defaults", never as an error.
//
// No XML library for one flat document: a few patterns are enough, and they
// never throw on a malformed answer.
// -----------------------------------------------------------------------------

const ZONE_IDS = { 1: 'main', 2: 'zone2', 3: 'zone3' };
// The `zone` attribute of a selector is a bit field: which zones can use it.
const ZONE_BITS = { main: 1, zone2: 2, zone3: 4 };

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([a-zA-Z_]+)="([^"]*)"/g)) {
    result[match[1]] = decodeEntities(match[2]);
  }
  return result;
}

function element(xml, name) {
  const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return match ? decodeEntities(match[1]).trim() : '';
}

/**
 * @param {string} xml the NRI answer
 * @returns {{
 *   model: string, brand: string, friendlyName: string, id: string,
 *   zones: Array<{ key: string, name: string, volmax: number | null, volstep: number | null }>,
 *   inputs: Array<{ code: string, label: string, zones: string[] }>,
 * } | null}
 */
export function parseNri(xml) {
  if (typeof xml !== 'string' || !xml.includes('<')) {
    return null;
  }
  const id = (element(xml, 'macaddress') || element(xml, 'deviceid'))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  const zones = [];
  for (const match of xml.matchAll(/<zone\s[^>]*>/g)) {
    const zone = attributes(match[0]);
    const key = ZONE_IDS[zone.id];
    if (key && zone.value === '1') {
      zones.push({
        key,
        name: zone.name ?? key,
        volmax: Number.isFinite(Number(zone.volmax)) ? Number(zone.volmax) : null,
        volstep: Number.isFinite(Number(zone.volstep)) ? Number(zone.volstep) : null,
      });
    }
  }

  const inputs = [];
  for (const match of xml.matchAll(/<selector\s[^>]*>/g)) {
    const selector = attributes(match[0]);
    const code = String(selector.id ?? '').toUpperCase();
    if (!/^[0-9A-F]{2}$/.test(code) || selector.value !== '1') {
      continue;
    }
    const bits = Number.parseInt(selector.zone ?? '1', 16) || 1;
    inputs.push({
      code,
      label: (selector.name ?? '').trim() || code,
      zones: Object.entries(ZONE_BITS)
        .filter(([, bit]) => (bits & bit) !== 0)
        .map(([zone]) => zone),
    });
  }

  return {
    model: element(xml, 'model'),
    brand: element(xml, 'brand'),
    friendlyName: element(xml, 'friendlyname'),
    id,
    zones,
    inputs,
  };
}
