// -----------------------------------------------------------------------------
// Jacket art (NJA): the cover of what the network player plays.
//
// The receiver sends it on its own when the track changes, in one of three
// shapes, told by the first character of the parameter:
//
//   0 / 1  a BMP / JPEG image, hex encoded, cut in packets: the second
//          character says which one this is (0 start, 1 next, 2 end, - alone);
//   2      a link to the image, on the receiver's own web server;
//   n      no image for this track.
//
// Gladys only takes PNG, JPEG or WebP of at most 300 KB: a BMP, an image too
// large or a stream of packets out of order give "no artwork" rather than a
// picture the core would refuse.
// -----------------------------------------------------------------------------

/** The largest artwork Gladys accepts, decoded. */
export const MAX_ARTWORK_BYTES = 300 * 1024;

/**
 * The type of an image, read from its first bytes (what the core checks too).
 * @param {Buffer} buffer
 * @returns {'image/jpeg' | 'image/png' | 'image/webp' | null}
 */
export function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return null;
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Puts the NJA packets back together. `push()` answers, for every packet:
 *   - `undefined`: nothing to say yet (a packet in the middle of an image, `N/A`);
 *   - `null`: no artwork Gladys can show for this track;
 *   - `{ data }`: a whole image (a Buffer, PNG / JPEG / WebP);
 *   - `{ url }`: the receiver serves the image at this address.
 */
export class JacketArt {
  constructor() {
    this.reset();
  }

  reset() {
    this.type = null;
    this.chunks = null;
    this.size = 0;
    this.broken = false;
  }

  push(value) {
    const type = value?.[0];
    const packet = value?.[1];
    const data = String(value ?? '').slice(2);
    if (type === 'n') {
      this.reset();
      return null;
    }
    if (type === '2') {
      this.reset();
      return /^https?:\/\/\S+$/.test(data.trim()) ? { url: data.trim() } : null;
    }
    if (type !== '0' && type !== '1') {
      // `N/A` (no network source), or a shape this code does not know.
      return undefined;
    }
    if (packet === '0' || packet === '-') {
      this.reset();
      this.type = type;
      this.chunks = [];
    } else if (this.chunks === null || this.type !== type) {
      // The start was missed (a connection opened mid-image): wait for the next one.
      return undefined;
    }
    if (!this.broken) {
      if (!/^[0-9A-Fa-f]*$/.test(data) || data.length % 2 !== 0) {
        this.broken = true;
      } else {
        this.size += data.length / 2;
        if (this.size > MAX_ARTWORK_BYTES) {
          this.broken = true;
          this.chunks = [];
        } else {
          this.chunks.push(data);
        }
      }
    }
    if (packet !== '2' && packet !== '-') {
      return undefined;
    }
    const usable = this.type === '1' && !this.broken;
    const image = usable ? Buffer.from(this.chunks.join(''), 'hex') : null;
    this.reset();
    return image && sniffImage(image) ? { data: image } : null;
  }
}
