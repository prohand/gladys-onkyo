import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';
import { applyLogLevel } from '../src/logging.js';

test('defaults, and the types fixed', () => {
  assert.deepEqual(normalizeConfig(), {
    ...DEFAULT_CONFIG,
    volume_resolution: 80,
  });
  const config = normalizeConfig({ volume_resolution: '200', max_volume: '65', zones: '2' });
  assert.equal(config.volume_resolution, 200);
  assert.equal(config.max_volume, 65);
  assert.equal(config.zones, '2');
});

test('nonsense falls back to the defaults', () => {
  const config = normalizeConfig({ volume_resolution: '77', max_volume: 0, zones: '9', hosts: 4 });
  assert.equal(config.volume_resolution, 80);
  assert.equal(config.max_volume, 80);
  assert.equal(config.zones, 'auto');
  assert.equal(config.hosts, '');
  assert.equal(normalizeConfig({ max_volume: 250 }).max_volume, 100);
});

test('the debug switch raises the log level, and puts it back', () => {
  const before = process.env.LOG_LEVEL;
  assert.equal(applyLogLevel({ debug_logs: true }), 'debug');
  assert.equal(process.env.LOG_LEVEL, 'debug');
  applyLogLevel({ debug_logs: false });
  assert.equal(process.env.LOG_LEVEL, before);
});
