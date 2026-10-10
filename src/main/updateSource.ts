// === FILE PURPOSE ===
// Where updates come from, and what counts as one (UPDATER-SAFE.1). The app asks
// GitHub's public release API directly — no website in between — and accepts an
// installer only when the release record itself names it, on GitHub, under this
// repo's download path, with a GitHub-computed sha256 digest. The digest is then
// what updateDownload.ts holds the downloaded bytes to.
//
// Pure parsing is separated from the request so every rule is unit-testable.

const REPO = 'Lab-51/lifedash';
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;

const SEMVER_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const SHA256_DIGEST = /^sha256:([0-9a-f]{64})$/;

export interface ReleaseVersion {
  version: string;
  releaseName: string;
}

export interface VerifiedInstaller {
  assetName: string;
  downloadUrl: string;
  /** Lower-case hex, from GitHub's `digest` field. */
  sha256: string;
  size: number;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

type Json = Record<string, unknown>;

/** Returns true if `remote` is a newer major.minor.patch than `current`. */
export function isNewerVersion(current: string, remote: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const c = parse(current);
  const r = parse(remote);
  for (let i = 0; i < 3; i++) {
    if (r[i] !== c[i]) return r[i] > c[i];
  }
  return false;
}

/** The release's version, if it is a published release with a strict vX.Y.Z tag. */
export function parseReleaseVersion(json: unknown): Parsed<ReleaseVersion> {
  const release = json as Json | null;
  if (!release || typeof release !== 'object') return { ok: false, reason: 'response is not a release object' };
  if (release.draft !== false || release.prerelease !== false) {
    return { ok: false, reason: 'release is a draft or prerelease' };
  }
  const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
  if (!SEMVER_TAG.test(tag)) return { ok: false, reason: `tag "${tag}" is not vMAJOR.MINOR.PATCH` };
  const version = tag.slice(1);
  const releaseName = typeof release.name === 'string' && release.name ? release.name : tag;
  return { ok: true, value: { version, releaseName } };
}

/**
 * The Windows installer for `version`, only if the release record names exactly one,
 * at this repo's GitHub download path, with a sha256 digest and a size.
 */
export function parseInstaller(json: unknown, version: string): Parsed<VerifiedInstaller> {
  const assets = (json as Json | null)?.assets;
  if (!Array.isArray(assets)) return { ok: false, reason: 'release has no asset list' };
  const assetName = `LifeDash-${version}-Setup.exe`;
  const matches = assets.filter((a) => (a as Json)?.name === assetName) as Json[];
  if (matches.length !== 1) return { ok: false, reason: `expected exactly one ${assetName}, found ${matches.length}` };
  const asset = matches[0];

  const digest = typeof asset.digest === 'string' ? SHA256_DIGEST.exec(asset.digest) : null;
  if (!digest) return { ok: false, reason: `${assetName} has no sha256 digest` };
  const size = asset.size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
    return { ok: false, reason: `${assetName} has no valid size` };
  }

  let url: URL;
  try {
    url = new URL(String(asset.browser_download_url));
  } catch {
    return { ok: false, reason: `${assetName} has no valid download URL` };
  }
  const expectedPath = `/${REPO}/releases/download/v${version}/${assetName}`;
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.pathname !== expectedPath || url.search) {
    return { ok: false, reason: `${assetName} download URL is not ${expectedPath} on https://github.com` };
  }
  return { ok: true, value: { assetName, downloadUrl: url.href, sha256: digest[1], size } };
}

export type LatestReleaseResult =
  | { kind: 'release'; json: unknown }
  | { kind: 'rate-limited' }
  | { kind: 'error'; message: string };

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

/** One unauthenticated request for the latest published release. */
export async function fetchLatestRelease(fetchFn: FetchLike, currentVersion: string): Promise<LatestReleaseResult> {
  const response = await fetchFn(LATEST_RELEASE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `LifeDash/${currentVersion}`,
    },
  });
  // Unauthenticated GitHub API allows 60 requests/hour per IP: a shared IP can run out.
  // Secondary limits answer 403 with retry-after instead of a zero remaining count.
  const limited = response.headers.get('x-ratelimit-remaining') === '0' || response.headers.get('retry-after') !== null;
  if (response.status === 429 || (response.status === 403 && limited)) {
    return { kind: 'rate-limited' };
  }
  if (!response.ok) return { kind: 'error', message: `GitHub releases API returned ${response.status}` };
  return { kind: 'release', json: await response.json() };
}
