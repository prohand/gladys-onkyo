import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNri } from '../src/onkyo/nri.js';
import { NRI_SAMPLE } from './helpers/samples.js';

test('the NRI description gives model, MAC, zones and named inputs', () => {
  const description = parseNri(NRI_SAMPLE);
  assert.equal(description.model, 'TX-NR686');
  assert.equal(description.brand, 'ONKYO');
  assert.equal(description.id, '0009b0e1f2a3');
  assert.deepEqual(
    description.zones.map((zone) => zone.key),
    ['main', 'zone2'],
  );
  assert.equal(description.zones[0].volmax, 80);
  assert.deepEqual(description.inputs, [
    { code: '10', label: 'Blu-ray', zones: ['main', 'zone2'] },
    { code: '23', label: 'CD & Co', zones: ['main'] },
    { code: '2B', label: 'NET', zones: ['main', 'zone2', 'zone3'] },
  ]);
});

test('no description, no crash', () => {
  assert.equal(parseNri(''), null);
  assert.equal(parseNri(undefined), null);
  assert.deepEqual(parseNri('<response/>').inputs, []);
});
