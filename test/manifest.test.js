// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest, but nothing there knows which
// handlers the code registers or which keys it fires: these tests keep both
// sides in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import { SCENE_ACTIONS } from '../src/capabilities/scenes.js';
import { RECEIVER_WIDGET } from '../src/capabilities/widget.js';
import { SCENE_TRIGGERS } from '../src/hub.js';
import {
  INPUTS,
  LISTENING_MODES,
  VOLUME_RESOLUTIONS,
  ZONE_EXTRA_INPUTS,
} from '../src/onkyo/codes.js';
import { EISCP_PORT } from '../src/onkyo/eiscp.js';

const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../gladys-assistant-integration.json'));
const pkg = JSON.parse(await read('../package.json'));
const indexSource = await read('../index.js');

const allFields = [
  ...manifest.config_schema,
  ...(manifest.actions ?? []).flatMap((a) => a.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((w) => w.settings ?? []),
  ...(manifest.scene_triggers ?? []).flatMap((t) => t.fields ?? []),
  ...(manifest.scene_actions ?? []).flatMap((a) => a.fields ?? []),
];

test('version, package.json and docker_image agree', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-onkyo:${pkg.version}`);
});

test('every manifest action is registered in index.js', () => {
  for (const action of manifest.actions ?? []) {
    assert.match(indexSource, new RegExp(`onAction\\('${action.key}'`), action.key);
  }
});

// The store schema is the admission authority: a field type outside this list,
// or a placeholder that is not a multi-language object, gets the integration
// rejected by the indexer.
const FIELD_TYPES = ['string', 'number', 'boolean', 'select', 'multi_select', 'secret', 'section'];

test('every field uses a type the store accepts, texts in both languages', () => {
  for (const field of allFields) {
    assert.ok(FIELD_TYPES.includes(field.type), `field "${field.key}": type "${field.type}"`);
    assert.match(field.key, /^[a-z0-9_]+$/, `field key "${field.key}" must be snake_case`);
    assert.ok(field.label?.en && field.label?.fr, `field "${field.key}" needs en/fr labels`);
    if (field.description !== undefined) {
      assert.ok(field.description.en && field.description.fr, `field "${field.key}"`);
    }
    if (field.placeholder !== undefined) {
      assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder object`);
      assert.ok(['string', 'number', 'secret'].includes(field.type), field.key);
    }
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number', `field "${field.key}": min/max are number-only`);
    }
    for (const option of field.options ?? []) {
      assert.ok(option.label?.en && option.label?.fr, `option ${option.value} of ${field.key}`);
    }
  }
});

test('the catalog texts fit what the store allows', () => {
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${language}: ${text.length}`);
  }
  assert.deepEqual(manifest.categories, ['multimedia']);
});

test('config_schema defaults are the DEFAULT_CONFIG ones, every key known', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.equal(field.default, undefined);
      assert.ok(!(field.key in DEFAULT_CONFIG), `section "${field.key}" stores nothing`);
      for (const link of field.links ?? []) {
        assert.match(link.url, /^https:\/\//);
      }
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `config key "${field.key}" missing in DEFAULT_CONFIG`);
    assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
  }
});

test('the volume scales offered are the ones the code converts', () => {
  const field = manifest.config_schema.find((f) => f.key === 'volume_resolution');
  assert.deepEqual(
    field.options.map((o) => Number(o.value)),
    VOLUME_RESOLUTIONS,
  );
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, field.key);
  }
});

test('local only, discovery on the eISCP port, Gladys 5.1 floor', () => {
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.network_discovery, [
    { type: 'udp-active-broadcast', ports: [EISCP_PORT] },
  ]);
  assert.equal(manifest.gladys_version, '>=5.1.0');
});

test('the widget and every scene action are handled', () => {
  assert.deepEqual(
    manifest.widgets.map((w) => w.key),
    [RECEIVER_WIDGET],
  );
  assert.match(indexSource, /onWidgetGet\(RECEIVER_WIDGET/);
  assert.match(indexSource, /onWidgetAction\(RECEIVER_WIDGET/);
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.keys(SCENE_ACTIONS).sort(),
  );
  assert.match(indexSource, /onSceneAction\(key/);
});

test('the scene triggers the code fires are the ones the manifest declares', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
});

test('the input and listening mode lists are the code ones', () => {
  const codes = [...INPUTS, ...ZONE_EXTRA_INPUTS].map((i) => i.code);
  const sourceTrigger = manifest.scene_triggers.find((t) => t.key === 'source_changed');
  assert.deepEqual(
    sourceTrigger.fields.find((f) => f.key === 'source').options.map((o) => o.value),
    codes,
  );
  const playSource = manifest.scene_actions.find((a) => a.key === 'play_source');
  assert.deepEqual(
    playSource.fields.find((f) => f.key === 'source').options.map((o) => o.value),
    codes,
  );
  const mode = manifest.scene_actions.find((a) => a.key === 'set_listening_mode');
  assert.deepEqual(
    mode.fields.find((f) => f.key === 'mode').options.map((o) => o.value),
    LISTENING_MODES.map((m) => m.code),
  );
});
