import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVersion, currentVersion } from '../scripts/stamp.mjs';

test('sw.js version matches the game files (run `npm run stamp` if this fails)', () => {
  assert.equal(currentVersion(), computeVersion());
});
