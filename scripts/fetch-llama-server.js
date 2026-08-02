/**
 * fetch-llama-server.js
 * Downloads the PINNED llama.cpp release binaries for the host platform, verifies
 * their recorded sha256, and stages them into resources/llama/<backend>/ — the exact
 * layout src/main/services/llamaRuntimeConfig.ts resolves at runtime (dev: appPath;
 * packaged: process.resourcesPath, via forge `extraResource`).
 *
 * Usage: node scripts/fetch-llama-server.js
 * Runs automatically from forge's `prePackage` hook, so `electron-forge package`
 * and `electron-forge make` need no manual step (local or CI).
 *
 * Archives are cached under .cache/llama-bin/ (gitignored) and re-verified on every
 * run, so repeat builds are offline-friendly without trusting the cache blindly.
 * Set LIFEDASH_SKIP_LLAMA_FETCH=1 to skip entirely (builds then ship no sidecar
 * binary — the app degrades to "built-in AI unavailable", it does not break).
 *
 * SUPPLY CHAIN: every sha256 below was computed locally from the downloaded asset
 * AND cross-checked against the GitHub release API's `digest` field. Nothing is
 * staged that does not match. Never soften these checks to make a build pass.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

// ---------------------------------------------------------------------------
// Pinned release — see DECISIONS.md (2026-08-01, llama.cpp binary sourcing)
// ---------------------------------------------------------------------------

const TAG = 'b10219';
const RELEASE_URL = `https://github.com/ggml-org/llama.cpp/releases/download/${TAG}`;

/**
 * Windows: Vulkan (covers NVIDIA/AMD/Intel) with a CPU fallback — no CUDA build
 * (238MB+ for no coverage Vulkan lacks). macOS: Metal, arm64 only, matching the
 * only macOS arch .github/workflows/release.yml actually builds (macos-latest →
 * "Build macOS (arm64)", artifacts named mac-arm64, Homebrew cask arm64).
 */
const ASSETS = [
  {
    platform: 'win32',
    arch: 'x64',
    backend: 'vulkan',
    file: `llama-${TAG}-bin-win-vulkan-x64.zip`,
    bytes: 34089136,
    sha256: 'a63bd0ceab781483a7fde174f1676d86c9724d7376d721fab026fa2df1393997',
  },
  {
    platform: 'win32',
    arch: 'x64',
    backend: 'cpu',
    file: `llama-${TAG}-bin-win-cpu-x64.zip`,
    bytes: 18352875,
    sha256: '5f3fc78e61d7402f7051c3580159c8a12ff6cb98912e42f4272932e1afb7f882',
  },
  {
    platform: 'darwin',
    arch: 'arm64',
    backend: 'metal',
    file: `llama-${TAG}-bin-macos-arm64.tar.gz`,
    bytes: 10941079,
    sha256: 'b54af3c25a3ded15fc0f7a5a0898a65f1a9beb63981a93e0ae93f648811fb960',
  },
];

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(PROJECT_ROOT, '.cache', 'llama-bin');
const STAGING_ROOT = path.join(PROJECT_ROOT, 'resources', 'llama');
const PROVENANCE = 'provenance.json';

const IS_WINDOWS = process.platform === 'win32';
const SERVER_NAME = IS_WINDOWS ? 'llama-server.exe' : 'llama-server';
/** Shared libraries the server loads: every ggml/llama backend + its versioned aliases. */
const LIB_PATTERN = IS_WINDOWS ? /\.dll$/i : /\.dylib$/i;

const log = (msg) => console.log(`[llama] ${msg}`);
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// ---------------------------------------------------------------------------
// Filesystem helpers — deliberately surgical (see "destructive-cleanup" learning)
// ---------------------------------------------------------------------------

/** Guard against an env/config mistake pointing a delete outside the repo. */
function assertInsideProject(target) {
  const rel = path.relative(PROJECT_ROOT, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Refusing to touch ${target}: outside the project root`);
  }
}

/**
 * Remove a directory this script created. Never follows a link: symlinks are
 * unlinked, not traversed, and anything that is not a plain directory is refused.
 * Depth is bounded because both layouts we create are flat by construction.
 */
function removeManagedDir(dir, depth = 0) {
  assertInsideProject(dir);
  let stat;
  try {
    stat = fs.lstatSync(dir);
  } catch {
    return; // absent — nothing to clean
  }
  if (stat.isSymbolicLink()) throw new Error(`Refusing to delete ${dir}: it is a link`);
  if (!stat.isDirectory()) throw new Error(`Refusing to delete ${dir}: not a directory`);
  if (depth > 2) throw new Error(`Refusing to recurse below depth 2 under ${dir}`);

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    // Dirent types come from lstat, so a symlinked directory reports isDirectory() === false
    // and falls through to unlink — which removes the link itself, never its target.
    if (entry.isDirectory()) removeManagedDir(child, depth + 1);
    else fs.unlinkSync(child);
  }
  fs.rmdirSync(dir);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ---------------------------------------------------------------------------
// Download + verify
// ---------------------------------------------------------------------------

async function download(url, destPath) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`GET ${url} failed — HTTP ${res.status} ${res.statusText}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destPath));
}

/** @returns {string|null} human-readable reason the file is not the pinned asset, or null if it is. */
function mismatchReason(file, asset) {
  const size = fs.statSync(file).size;
  if (size !== asset.bytes) return `size ${size} != pinned ${asset.bytes}`;
  const digest = sha256File(file);
  if (digest !== asset.sha256) return `sha256 ${digest} != pinned ${asset.sha256}`;
  return null;
}

/**
 * Return the path to a locally cached, sha256-verified copy of the asset,
 * downloading it first if needed. A cached file that fails verification is
 * replaced, never used.
 */
async function ensureArchive(asset) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cached = path.join(CACHE_DIR, asset.file);

  if (fs.existsSync(cached)) {
    const started = Date.now();
    const bad = mismatchReason(cached, asset);
    if (!bad) {
      log(
        `cache HIT  ${asset.file} (${mb(asset.bytes)}, sha256 re-verified in ${Date.now() - started}ms — no download)`,
      );
      return cached;
    }
    log(`cache entry rejected: ${asset.file} — ${bad}`);
    fs.unlinkSync(cached); // one file we wrote ourselves; never a recursive delete
  }

  const part = `${cached}.part`;
  if (fs.existsSync(part)) fs.unlinkSync(part);
  log(`cache MISS ${asset.file} — downloading ${mb(asset.bytes)} from ${TAG}...`);
  const started = Date.now();
  await download(`${RELEASE_URL}/${asset.file}`, part);

  const bad = mismatchReason(part, asset);
  if (bad) {
    fs.unlinkSync(part);
    throw new Error(`Checksum verification FAILED for ${asset.file}: ${bad}. Nothing was staged.`);
  }
  fs.renameSync(part, cached);
  log(`downloaded and verified ${asset.file} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return cached;
}

// ---------------------------------------------------------------------------
// Extract + stage
// ---------------------------------------------------------------------------

function extract(archive, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  try {
    // bsdtar reads both .zip and .tar.gz and ships with Windows 10+ and macOS —
    // no extraction dependency needed, and it preserves symlinks and exec bits.
    execFileSync('tar', ['-xf', archive, '-C', destDir], { stdio: ['ignore', 'ignore', 'inherit'] });
  } catch (err) {
    throw new Error(`Failed to extract ${path.basename(archive)} with 'tar': ${err.message}`);
  }
}

/** Locate the directory holding the server binary (Windows zips are flat; the macOS tarball nests one level). */
function findPayloadDir(root) {
  const queue = [root];
  for (let i = 0; i < queue.length && i < 64; i++) {
    const entries = fs.readdirSync(queue[i], { withFileTypes: true });
    if (entries.some((e) => e.name === SERVER_NAME && !e.isDirectory())) return queue[i];
    for (const e of entries) if (e.isDirectory()) queue.push(path.join(queue[i], e.name));
  }
  throw new Error(`${SERVER_NAME} not found in the extracted archive at ${root}`);
}

/**
 * Copy the server binary and its full sibling library set into destDir. The other
 * CLI tools in the archive (llama-cli, llama-bench, ggml-rpc-server, ...) are
 * deliberately NOT shipped — the app only ever spawns llama-server. Every .dll /
 * .dylib is kept: ggml loads its CPU micro-arch and GPU backends dynamically at
 * runtime, so the set is the unit, not the executable.
 */
function stageFiles(payloadDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(payloadDir, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    if (entry.name !== SERVER_NAME && !LIB_PATTERN.test(entry.name)) continue;
    const src = path.join(payloadDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isSymbolicLink()) {
      // macOS ships libfoo.dylib -> libfoo.0.dylib -> libfoo.0.18.0.dylib chains.
      // Recreating the links keeps @rpath resolution intact without tripling bytes.
      fs.symlinkSync(fs.readlinkSync(src), dest);
    } else {
      fs.copyFileSync(src, dest);
      if (!IS_WINDOWS) fs.chmodSync(dest, 0o755);
    }
    count++;
  }
  if (count < 2)
    throw new Error(`Staged only ${count} file(s) from ${payloadDir} — expected the server plus its libraries`);
  return count;
}

/** True when destDir already holds exactly this pinned asset — makes repeat packaging a no-op. */
function alreadyStaged(destDir, asset, prov) {
  if (!prov || prov.tag !== TAG || prov.sha256 !== asset.sha256) return false;
  if (!fs.existsSync(path.join(destDir, SERVER_NAME))) return false;
  return fs.readdirSync(destDir).length === prov.fileCount + 1; // + provenance.json
}

async function stageAsset(asset) {
  const destDir = path.join(STAGING_ROOT, asset.backend);
  assertInsideProject(destDir);
  const prov = readJson(path.join(destDir, PROVENANCE));

  const archive = await ensureArchive(asset);
  if (alreadyStaged(destDir, asset, prov)) {
    log(`${asset.backend}/ already staged from ${TAG} (${prov.fileCount} files) — skipped`);
    return;
  }

  const workDir = path.join(CACHE_DIR, `.extract-${asset.backend}`);
  removeManagedDir(workDir);
  try {
    extract(archive, workDir);
    removeManagedDir(destDir);
    const fileCount = stageFiles(findPayloadDir(workDir), destDir);
    fs.writeFileSync(
      path.join(destDir, PROVENANCE),
      `${JSON.stringify({ tag: TAG, backend: asset.backend, asset: asset.file, sha256: asset.sha256, fileCount, source: `https://github.com/ggml-org/llama.cpp/releases/tag/${TAG}`, license: 'MIT — see THIRD_PARTY_NOTICES.md' }, null, 2)}\n`,
    );
    const bytes = fs.readdirSync(destDir).reduce((sum, f) => sum + fs.lstatSync(path.join(destDir, f)).size, 0);
    log(`staged ${asset.backend}/ — ${fileCount} files, ${mb(bytes)}`);
  } finally {
    removeManagedDir(workDir);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function fetchLlamaServer() {
  // Always present so forge's `extraResource: ['./resources/llama']` never fails,
  // even on a platform we ship no binaries for.
  fs.mkdirSync(STAGING_ROOT, { recursive: true });

  if (process.env.LIFEDASH_SKIP_LLAMA_FETCH === '1') {
    log('LIFEDASH_SKIP_LLAMA_FETCH=1 — skipping (build will ship no built-in AI binary)');
    return;
  }

  const wanted = ASSETS.filter((a) => a.platform === process.platform && a.arch === process.arch);
  if (wanted.length === 0) {
    log(
      `WARNING: no pinned llama.cpp asset for ${process.platform}-${process.arch} — built-in AI will be unavailable in this build`,
    );
    return;
  }

  for (const asset of wanted) await stageAsset(asset);
  log(`ready: ${STAGING_ROOT} (${wanted.map((a) => a.backend).join(', ')}) @ ${TAG}`);
}

module.exports = { fetchLlamaServer, TAG, ASSETS };

if (require.main === module) {
  fetchLlamaServer().catch((err) => {
    console.error(`[llama] ${err.message}`);
    process.exit(1);
  });
}
