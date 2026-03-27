// === FILE PURPOSE ===
// Update the Homebrew cask (Lab-51/homebrew-lifedash) with a new version and SHA256.
// Computes SHA256 of the DMG file, fetches the current cask from GitHub,
// replaces version + sha256 lines, and commits the update via the GitHub API.
// Uses Node.js built-in modules only — no external dependencies.
// Usage: node scripts/update-homebrew-cask.js <version> <dmg-path>

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const REPO_OWNER = 'Lab-51';
const REPO_NAME = 'homebrew-lifedash';
const CASK_PATH = 'Casks/lifedash.rb';

// --- CLI argument parsing ---

function printUsage() {
  console.log('Usage: node scripts/update-homebrew-cask.js <version> <dmg-path>');
  console.log('');
  console.log('Arguments:');
  console.log('  version    The new version number (e.g. 2.2.28)');
  console.log('  dmg-path   Path to the DMG file to compute SHA256 from');
  console.log('');
  console.log('Environment:');
  console.log('  GITHUB_TOKEN   Required. A GitHub token with repo access to Lab-51/homebrew-lifedash');
  console.log('');
  console.log('Example:');
  console.log('  node scripts/update-homebrew-cask.js 2.2.28 out/make/LifeDash-2.2.28-mac-arm64.dmg');
}

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  printUsage();
  process.exit(0);
}

if (args.length < 2) {
  console.error('ERROR: Missing required arguments.');
  printUsage();
  process.exit(1);
}

const version = args[0];
const dmgPath = path.resolve(args[1]);

if (!process.env.GITHUB_TOKEN) {
  console.error('ERROR: GITHUB_TOKEN environment variable is not set.');
  console.error('Set it as a permanent env var or pass it inline:');
  console.error('  GITHUB_TOKEN=... node scripts/update-homebrew-cask.js <version> <dmg-path>');
  process.exit(1);
}

if (!fs.existsSync(dmgPath)) {
  console.error(`ERROR: DMG file not found: ${dmgPath}`);
  process.exit(1);
}

// --- SHA256 computation ---

function computeSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

// --- GitHub API helpers ---

function githubRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        'Authorization': `token ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'LifeDash-Homebrew-Updater',
      },
    };

    if (body) {
      options.headers['Content-Type'] = 'application/json';
    }

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (_) {
          parsed = raw;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          reject(new Error(`GitHub API ${method} ${apiPath} returned ${res.statusCode}: ${JSON.stringify(parsed)}`));
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// --- Main ---

async function main() {
  console.log(`Computing SHA256 of ${dmgPath}...`);
  const sha256 = computeSha256(dmgPath);
  console.log(`  SHA256: ${sha256}`);

  console.log(`\nFetching current cask from ${REPO_OWNER}/${REPO_NAME}/${CASK_PATH}...`);
  const file = await githubRequest('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${CASK_PATH}`);
  const currentContent = Buffer.from(file.content, 'base64').toString('utf-8');
  const fileSha = file.sha;

  console.log('  Current content fetched. Updating version and sha256...');

  // Replace version line: version "X.Y.Z" -> version "NEW"
  let updatedContent = currentContent.replace(
    /^(\s*version\s+")([^"]+)(")/m,
    `$1${version}$3`
  );

  // Replace sha256 line: sha256 "abc123..." -> sha256 "NEW"
  updatedContent = updatedContent.replace(
    /^(\s*sha256\s+")([^"]+)(")/m,
    `$1${sha256}$3`
  );

  if (updatedContent === currentContent) {
    console.log('  No changes needed — cask already up to date.');
    return;
  }

  const encodedContent = Buffer.from(updatedContent, 'utf-8').toString('base64');
  const commitMessage = `Bump to v${version}`;

  console.log(`\nPushing updated cask with commit: "${commitMessage}"...`);
  await githubRequest('PUT', `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${CASK_PATH}`, {
    message: commitMessage,
    content: encodedContent,
    sha: fileSha,
  });

  console.log('  Homebrew cask updated successfully.');
  console.log(`\n  version "${version}"`);
  console.log(`  sha256  "${sha256}"`);
}

main().catch((err) => {
  console.error(`\nERROR: ${err.message}`);
  process.exit(1);
});
