import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

test('the release moves Unreleased under the version', () => {
  const text = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '',
    '- Something.',
    '',
    '[Unreleased]: https://github.com/prohand/gladys-onkyo/commits/main',
    '',
  ].join('\n');
  const rolled = rollChangelog(text, '1.0.0', '2026-10-11');
  assert.match(
    rolled,
    /## \[Unreleased\]\n\n## \[1\.0\.0\] - 2026-10-11\n\n### Added\n\n- Something\./,
  );
  assert.match(
    rolled,
    /\[Unreleased\]: https:\/\/github\.com\/prohand\/gladys-onkyo\/compare\/v1\.0\.0\.\.\.HEAD/,
  );
  assert.match(
    rolled,
    /\[1\.0\.0\]: https:\/\/github\.com\/prohand\/gladys-onkyo\/releases\/tag\/v1\.0\.0/,
  );
});

test('the real CHANGELOG.md has an Unreleased section and no hand-written link mistakes', async () => {
  const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(text, /^## \[Unreleased\]$/m);
  assert.match(text, /^\[Unreleased\]: https:\/\/github\.com\/prohand\/gladys-onkyo\//m);
});
