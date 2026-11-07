import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

// A syntax error in any script stops the game (or its offline copy) from
// starting at all, so check every file parses.
test('every script parses', () => {
  const files = ['sw.js', ...readdirSync('js').filter((f) => f.endsWith('.js')).map((f) => `js/${f}`)];
  for (const file of files) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      assert.fail(`${file} has a syntax error:\n${err.stderr}`);
    }
  }
});
