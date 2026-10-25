// -----------------------------------------------------------------------------
// The covers Gladys shows in its music box.
//
// The browser never loads an image from the LAN, and the core never fetches
// one: the integration publishes a KEY and serves the bytes when Gladys asks
// for that key (onMusicGetArtwork). The receiver sends its cover as image
// bytes (or as a link to its own web server, read at once): they are kept
// here, under a key derived from their content — the same cover is one key,
// one entry in the core's cache, whatever the track.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { artworkKey } from '@gladysassistant/integration-sdk';
import { MAX_ARTWORK_BYTES, sniffImage } from './onkyo/jacketArt.js';

// A few covers per receiver are enough: the core caches what it showed for an
// hour, and only ever asks for the keys it saw published.
const MAX_STORED = 32;
const FETCH_TIMEOUT_MS = 10_000;

export class ArtworkStore {
  constructor({ max = MAX_STORED } = {}) {
    this.max = max;
    this.images = new Map();
  }

  /**
   * Keep an image and give the source "URL" to publish as `artwork_url`:
   * publishNowPlaying turns it into the same key as `artworkKey()` here.
   * @param {Buffer} data a PNG, JPEG or WebP
   * @returns {string}
   */
  add(data) {
    const url = `onkyo-artwork:${createHash('sha1').update(data).digest('hex')}`;
    const key = artworkKey(url);
    this.images.delete(key);
    this.images.set(key, data.toString('base64'));
    if (this.images.size > this.max) {
      this.images.delete(this.images.keys().next().value);
    }
    return url;
  }

  /**
   * The raw base64 of a cover, what onMusicGetArtwork answers.
   * @param {string} key
   */
  get(key) {
    const image = this.images.get(key);
    if (image === undefined) {
      throw new Error(`Unknown artwork ${key}`);
    }
    return image;
  }
}

/**
 * Read the cover a receiver links to (NJA type 2). Only from the receiver
 * itself: an address elsewhere is not followed.
 * @param {string} url the link the receiver gave
 * @param {string} host the receiver's address
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<Buffer | null>} the image, or null when unusable
 */
export async function fetchReceiverArtwork(url, host, { fetchImpl = fetch } = {}) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.hostname !== host || !['http:', 'https:'].includes(target.protocol)) {
    return null;
  }
  const response = await fetchImpl(target, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok || Number(response.headers?.get?.('content-length')) > MAX_ARTWORK_BYTES) {
    return null;
  }
  const data = Buffer.from(await response.arrayBuffer());
  return data.length <= MAX_ARTWORK_BYTES && sniffImage(data) ? data : null;
}
