import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artworkKey } from '@gladysassistant/integration-sdk';
import { JacketArt, MAX_ARTWORK_BYTES, sniffImage } from '../src/onkyo/jacketArt.js';
import { ArtworkStore, fetchReceiverArtwork } from '../src/artwork.js';
import { JPEG_SAMPLE } from './helpers/samples.js';

const hex = JPEG_SAMPLE.toString('hex').toUpperCase();

test('the image type is read from the first bytes', () => {
  assert.equal(sniffImage(JPEG_SAMPLE), 'image/jpeg');
  assert.equal(sniffImage(Buffer.from('89504E470D0A1A0A0000000D49484452', 'hex')), 'image/png');
  assert.equal(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'ascii')), 'image/webp');
  assert.equal(sniffImage(Buffer.from('BM0000000000000000', 'ascii')), null);
  assert.equal(sniffImage(Buffer.alloc(3)), null);
});

test('jacket art packets are put back together into one JPEG', () => {
  const art = new JacketArt();
  assert.equal(art.push(`10${hex.slice(0, 10)}`), undefined);
  assert.equal(art.push(`11${hex.slice(10, 20)}`), undefined);
  assert.deepEqual(art.push(`12${hex.slice(20)}`), { data: JPEG_SAMPLE });
  // One packet alone.
  assert.deepEqual(art.push(`1-${hex}`), { data: JPEG_SAMPLE });
});

test('jacket art Gladys cannot show is "no artwork", never a broken image', () => {
  const art = new JacketArt();
  // BMP: the core only takes PNG, JPEG and WebP.
  art.push('00424D0000');
  assert.equal(art.push('02000000'), null);
  // No cover for this track.
  assert.equal(art.push('n-'), null);
  // Not hex.
  art.push('10FFD8');
  assert.equal(art.push('12ZZ'), null);
  // Larger than the 300 KB the core accepts.
  art.push(`10${'00'.repeat(MAX_ARTWORK_BYTES)}`);
  assert.equal(art.push('12FF'), null);
  // The middle of an image whose start was missed says nothing.
  assert.equal(art.push(`11${hex}`), undefined);
  assert.equal(art.push(`12${hex}`), undefined);
  // `N/A`: no network source.
  assert.equal(art.push('N/A'), undefined);
});

test('a jacket art link is handed over as it is', () => {
  const art = new JacketArt();
  assert.deepEqual(art.push('2-http://192.168.1.40/album_art.cgi'), {
    url: 'http://192.168.1.40/album_art.cgi',
  });
  assert.equal(art.push('2-not a link'), null);
});

test('covers are kept under the key publishNowPlaying derives', () => {
  const store = new ArtworkStore({ max: 2 });
  const url = store.add(JPEG_SAMPLE);
  assert.match(url, /^onkyo-artwork:[0-9a-f]{40}$/);
  assert.equal(store.add(Buffer.from(JPEG_SAMPLE)), url, 'the same cover is the same key');
  assert.equal(store.get(artworkKey(url)), JPEG_SAMPLE.toString('base64'));
  store.add(Buffer.concat([JPEG_SAMPLE, Buffer.from([1])]));
  store.add(Buffer.concat([JPEG_SAMPLE, Buffer.from([2])]));
  assert.throws(() => store.get(artworkKey(url)), /Unknown artwork/);
});

test('a cover link is only read on the receiver itself, small and a real image', async () => {
  const calls = [];
  const fetchImpl = async (target) => {
    calls.push(String(target));
    const body = target.pathname === '/big' ? Buffer.alloc(MAX_ARTWORK_BYTES + 1) : JPEG_SAMPLE;
    return {
      ok: target.pathname !== '/missing',
      headers: new Headers(),
      arrayBuffer: async () => body,
    };
  };
  const read = (url) => fetchReceiverArtwork(url, '192.168.1.40', { fetchImpl });
  assert.deepEqual(await read('http://192.168.1.40/album_art.cgi'), JPEG_SAMPLE);
  assert.equal(await read('http://203.0.113.9/album_art.cgi'), null);
  assert.equal(await read('file:///etc/passwd'), null);
  assert.equal(await read('not a url'), null);
  assert.equal(await read('http://192.168.1.40/missing'), null);
  assert.equal(await read('http://192.168.1.40/big'), null);
  assert.deepEqual(calls, [
    'http://192.168.1.40/album_art.cgi',
    'http://192.168.1.40/missing',
    'http://192.168.1.40/big',
  ]);
});
