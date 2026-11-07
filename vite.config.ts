import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Writes sw.js (from src/sw-template.js) with the list of built files and a
// fingerprint of them, so installed copies notice each new version and can
// work offline.
function serviceWorker(): Plugin {
  return {
    name: 'vault-service-worker',
    apply: 'build',
    enforce: 'post', // after index.html is written
    generateBundle(_options, bundle) {
      const files = new Map<string, string | Uint8Array>();
      for (const [name, item] of Object.entries(bundle)) {
        files.set(name, item.type === 'chunk' ? item.code : item.source);
      }
      const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
        const full = join(dir, f);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
      for (const full of walk('public')) {
        const name = relative('public', full).split('\\').join('/');
        if (/\.(png|svg|webmanifest|html|ico)$/.test(name) && !name.startsWith('icons/icon-maskable')) files.set(name, readFileSync(full));
      }
      const hash = createHash('sha256');
      for (const [name, body] of [...files].sort(([a], [b]) => a.localeCompare(b))) hash.update(name).update(body);
      const assets = ['./', ...[...files.keys()].filter((n) => !n.endsWith('.map')).sort()];
      const source = readFileSync('src/sw-template.js', 'utf8')
        .replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('[/* __ASSETS__ */]', JSON.stringify(assets, null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  build: { target: 'es2020', sourcemap: true },
  plugins: [serviceWorker()],
  test: { include: ['tests/**/*.test.ts'] },
} as never);
