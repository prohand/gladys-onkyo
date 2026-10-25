import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inputLabel,
  isValidRawCommand,
  parseHex,
  parseNetStatus,
  parseNetTime,
  parseOnOff,
  PLAYBACK_KEYS,
  percentToVolume,
  volumeToPercent,
} from '../src/onkyo/codes.js';

test('volume: receiver steps <-> percent, on every scale', () => {
  assert.equal(volumeToPercent(40, 80), 50);
  assert.equal(volumeToPercent(100, 200), 50);
  assert.deepEqual(percentToVolume(50, 80), { percent: 50, hex: '28' });
  assert.deepEqual(percentToVolume(50, 200), { percent: 50, hex: '64' });
  assert.deepEqual(percentToVolume(0, 80), { percent: 0, hex: '00' });
});

test('volume: never above the safety cap, never out of range', () => {
  assert.deepEqual(percentToVolume(95, 80, 60), { percent: 60, hex: '30' });
  assert.deepEqual(percentToVolume(-5, 80), { percent: 0, hex: '00' });
  assert.deepEqual(percentToVolume('abc', 80), { percent: 0, hex: '00' });
});

test('ISCP values', () => {
  assert.equal(parseHex('1A'), 26);
  assert.equal(parseHex('N/A'), null);
  assert.equal(parseOnOff('01'), 1);
  assert.equal(parseOnOff('00'), 0);
  assert.equal(parseOnOff('N/A'), null);
  assert.equal(inputLabel('23'), 'CD');
  assert.equal(inputLabel('23', [{ code: '23', label: 'Platine' }]), 'Platine');
  assert.equal(inputLabel('9C'), 'Input 9C');
});

test('a raw command is 3 letters and a printable parameter', () => {
  assert.ok(isValidRawCommand('PWR01'));
  assert.ok(isValidRawCommand('NTCPLAY'));
  assert.ok(!isValidRawCommand('PWR'));
  assert.ok(!isValidRawCommand('pwr01'));
  assert.ok(!isValidRawCommand('PWR01\r!1PWR00'));
});

test('network player: NST play status → MUSIC_PLAYBACK_STATE', () => {
  assert.equal(parseNetStatus('P--'), 1);
  assert.equal(parseNetStatus('p--'), 0);
  assert.equal(parseNetStatus('S--'), 2);
  assert.equal(parseNetStatus('E--'), 2);
  assert.equal(parseNetStatus('F-S'), 1);
  // Newer models send more characters: only the first one is the status.
  assert.equal(parseNetStatus('PR-xxxxx'), 1);
  assert.equal(parseNetStatus('N/A'), null);
  assert.equal(parseNetStatus(''), null);
  assert.deepEqual(PLAYBACK_KEYS, { 0: 'pause', 1: 'play', 2: 'stop' });
});

test('network player: NTM elapsed / total time in seconds', () => {
  assert.deepEqual(parseNetTime('01:23/04:56'), { position: 83, duration: 296 });
  assert.deepEqual(parseNetTime('01:02:03/02:00:00'), { position: 3723, duration: 7200 });
  // A radio stream: the position runs, the duration is unknown (0 = live).
  assert.deepEqual(parseNetTime('12:34/--:--'), { position: 754, duration: 0 });
  assert.deepEqual(parseNetTime('--:--/--:--'), { position: null, duration: 0 });
  assert.equal(parseNetTime('N/A'), null);
});
