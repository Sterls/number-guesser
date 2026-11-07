// A stand-in for the parts of Supabase the game uses, for end-to-end tests:
// guest sign-in and the vault_* functions, which run for real in a local
// Postgres (set up by scripts/test-sql.mjs's schema, or the same way).
//
//   PGHOST=/tmp/vaultpg PGPORT=5499 PGUSER=postgres node scripts/fake-supabase.mjs 54321
//
// Not used by the real game. Realtime (the live room line) isn't faked; the
// game falls back to asking the server every few seconds.

import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const port = Number(process.argv[2] || 54321);
const psql = (sql, sub = '') => execFileSync('psql', ['-qtAX', '-v', 'ON_ERROR_STOP=1', '-c',
  `set request.jwt.claim.sub = '${sub}'; set role ${sub ? 'authenticated' : 'anon'}; ${sql}`],
{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const returns = Object.fromEntries(psql("select proname || '=' || prorettype::regtype from pg_proc where proname like 'vault\\_%'")
  .split('\n').filter(Boolean).map((l) => l.split('=')));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function session(id) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id, aud: 'authenticated', role: 'authenticated', is_anonymous: true, email: '', identities: [], app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  return {
    access_token: `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: id, role: 'authenticated', exp, is_anonymous: true, aud: 'authenticated' })}.x`,
    token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: `r-${id}`, user,
  };
}
const subOf = (req) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub || ''; } catch { return ''; }
};
const lit = (v) => (v == null ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
  const send = (status, body) => {
    res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
    res.end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') return send(204);
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname === '/auth/v1/signup') {
        const id = randomUUID();
        psql(`reset role; insert into auth.users (id) values ('${id}')`);
        return send(200, session(id));
      }
      if (url.pathname === '/auth/v1/token') {
        const body = JSON.parse(raw || '{}');
        return send(200, session(String(body.refresh_token || '').replace(/^r-/, '')));
      }
      if (url.pathname === '/auth/v1/user') return send(200, session(subOf(req)).user);
      if (url.pathname === '/auth/v1/logout') return send(204);
      const m = url.pathname.match(/^\/rest\/v1\/rpc\/(vault_\w+)$/);
      if (m) {
        const fn = m[1];
        const args = JSON.parse(raw || '{}');
        const call = `public.${fn}(${Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ')})`;
        const out = psql(`select ${call}::text`, subOf(req));
        if (returns[fn] === 'void') return send(204);
        if (out === '') return send(200, 'null');
        return send(200, returns[fn] === 'json' ? out : JSON.stringify(returns[fn] === 'integer' ? Number(out) : out));
      }
      console.log('404', req.method, url.pathname);
      return send(404, { message: 'not faked' });
    } catch (e) {
      const message = (String(e.stderr || e).match(/ERROR:\s+(.*)/) || [])[1] || String(e);
      return send(400, { code: '22023', message, details: null, hint: null });
    }
  });
}).listen(port, () => console.log(`fake supabase on ${port}`));
