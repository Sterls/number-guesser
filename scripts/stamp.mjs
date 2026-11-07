// Computes a fingerprint of the game's files and writes it into sw.js, so
// installed copies of the game notice a new version and offer to update.
//
//   node scripts/stamp.mjs          write the new fingerprint
//   import { computeVersion } ...   used by the tests to check it's current

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const swPath = join(root, 'sw.js');

export function readSw() {
  return readFileSync(swPath, 'utf8');
}

export function currentVersion(sw = readSw()) {
  return sw.match(/const VERSION = '([^']*)';/)[1];
}

export function computeVersion(sw = readSw()) {
  const list = sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1];
  const files = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((f) => f !== './');
  const hash = createHash('sha256');
  // sw.js itself counts too, minus its own VERSION line.
  hash.update(sw.replace(/const VERSION = '[^']*';/, ''));
  for (const file of files) hash.update(file).update(readFileSync(join(root, file)));
  return hash.digest('hex').slice(0, 12);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sw = readSw();
  const version = computeVersion(sw);
  writeFileSync(swPath, sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`));
  console.log(`sw.js version: ${version}`);
}
