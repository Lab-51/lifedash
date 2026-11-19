// === FILE PURPOSE ===
// Prepare a throwaway COPY of the live LifeDash user data for smoking a
// packaged build, with cloud sync unable to run:
//   1. copies %APPDATA%\LifeDash (minus models, recordings, backups, caches),
//   2. signs the copy out: deletes sync.refreshToken / sync.userEmail /
//      sync.userId from its settings table, and sets sync.enabled = 'false'.
//
// Why signing out matters, not just sync.enabled: the copy otherwise restores
// the live install's Supabase session at startup (tryRestoreSession refreshes
// the stored refresh token). Supabase rotates refresh tokens, so the copy would
// spend the token the LIVE app holds, and the realtime channel would connect as
// the real account. With no token the copy is "not authenticated", so the
// periodic, debounced, realtime and manual sync paths all return early.
//
// Usage:  node scripts/smoke-copy.mjs [targetDir]
// Prints the launch command for the packaged exe. Delete the copy afterwards.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AUTH_KEYS = ['sync.refreshToken', 'sync.userEmail', 'sync.userId'];
const SKIP = new Set([
  'llm-models',
  'whisper-models',
  'recordings',
  'backups',
  'logs',
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
]);

function fail(message) {
  console.error(`smoke-copy: ${message}`);
  process.exit(1);
}

const appData = process.env.APPDATA;
if (!appData) fail('APPDATA is not set (this script targets the Windows release machine).');
const source = path.join(appData, 'LifeDash');
if (!fs.existsSync(path.join(source, 'pg-data'))) fail(`no pg-data under ${source}`);

const target = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), `lifedash-smoke-${Date.now()}`));
if (target === source || target.startsWith(source + path.sep)) fail('target must be outside the live user data');
if (fs.existsSync(target) && fs.readdirSync(target).length > 0) fail(`target is not empty: ${target}`);

// A PGlite directory copied while the app has it open can be inconsistent.
const tasks = spawnSync('tasklist', ['/FI', 'IMAGENAME eq lifedash.exe', '/NH'], { encoding: 'utf8' });
if (tasks.stdout?.toLowerCase().includes('lifedash.exe')) fail('LifeDash is running; close it before copying.');

fs.mkdirSync(target, { recursive: true });
for (const entry of fs.readdirSync(source)) {
  if (SKIP.has(entry) || entry.startsWith('pg-data-backup')) continue;
  fs.cpSync(path.join(source, entry), path.join(target, entry), { recursive: true });
}
fs.mkdirSync(path.join(target, 'logs'), { recursive: true });

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pgDist = path.join(repo, 'node_modules', '@electric-sql', 'pglite', 'dist');
const { PGlite } = await import(pathToFileURL(path.join(pgDist, 'index.js')).href);
const { vector } = await import(pathToFileURL(path.join(pgDist, 'vector', 'index.js')).href);

const db = new PGlite(path.join(target, 'pg-data'), { extensions: { vector } });
try {
  await db.transaction(async (tx) => {
    await tx.query(`DELETE FROM settings WHERE key = ANY($1::text[])`, [AUTH_KEYS]);
    await tx.query(
      `INSERT INTO settings (key, value) VALUES ('sync.enabled', 'false')
       ON CONFLICT (key) DO UPDATE SET value = 'false'`,
    );
  });
  const { rows } = await db.query(`SELECT key, value FROM settings WHERE key = ANY($1::text[])`, [
    [...AUTH_KEYS, 'sync.enabled'],
  ]);
  const left = rows.filter((r) => AUTH_KEYS.includes(r.key));
  const enabled = rows.find((r) => r.key === 'sync.enabled')?.value;
  if (left.length > 0 || enabled !== 'false') fail(`copy not signed out: ${JSON.stringify(rows)}`);
} finally {
  await db.close();
}

const exe = path.join(repo, 'out', 'lifedash-win32-x64', 'lifedash.exe');
console.log(`Smoke copy ready (signed out, sync.enabled=false): ${target}`);
console.log(`Launch:  & "${exe}" --user-data-dir="${target}"`);
console.log(`Log:     ${path.join(target, 'logs')}`);
console.log('Expect "[SyncService] Sync service started" (timers only) and NO session restore or sync cycle lines.');
