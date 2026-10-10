// === FILE PURPOSE ===
// What the updater accepts as an update (UPDATER-SAFE.1): only a published release with
// a strict vX.Y.Z tag, naming exactly one installer at this repo's GitHub download path
// with a sha256 digest and a size. Every rule is checked by violating it alone.

import { describe, it, expect, vi } from 'vitest';
import {
  fetchLatestRelease,
  isNewerVersion,
  LATEST_RELEASE_API,
  parseInstaller,
  parseReleaseVersion,
} from '../updateSource';

const DIGEST = 'a'.repeat(64);

function release(overrides: Record<string, unknown> = {}, assetOverrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v2.16.0',
    name: 'v2.16.0 — Something',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'LifeDash-2.16.0.7z',
        digest: `sha256:${'b'.repeat(64)}`,
        size: 10,
        browser_download_url: 'https://github.com/Lab-51/lifedash/releases/download/v2.16.0/LifeDash-2.16.0.7z',
      },
      {
        name: 'LifeDash-2.16.0-Setup.exe',
        digest: `sha256:${DIGEST}`,
        size: 1234,
        browser_download_url: 'https://github.com/Lab-51/lifedash/releases/download/v2.16.0/LifeDash-2.16.0-Setup.exe',
        ...assetOverrides,
      },
    ],
    ...overrides,
  };
}

describe('parseReleaseVersion', () => {
  it('accepts a published vX.Y.Z release', () => {
    expect(parseReleaseVersion(release())).toEqual({
      ok: true,
      value: { version: '2.16.0', releaseName: 'v2.16.0 — Something' },
    });
  });

  it.each([
    ['a draft', { draft: true }],
    ['a prerelease', { prerelease: true }],
    ['a missing draft flag', { draft: undefined }],
    ['a non-semver tag', { tag_name: 'v2.16' }],
    ['a tag with a suffix', { tag_name: 'v2.16.0-beta' }],
    ['a tag with path characters', { tag_name: 'v2.16.0/../x' }],
  ])('rejects %s', (_label, overrides) => {
    expect(parseReleaseVersion(release(overrides)).ok).toBe(false);
  });

  it('rejects a non-object response', () => {
    expect(parseReleaseVersion(null).ok).toBe(false);
    expect(parseReleaseVersion('nope').ok).toBe(false);
  });
});

describe('parseInstaller', () => {
  it('accepts the one installer at the repo download path, with its digest and size', () => {
    expect(parseInstaller(release(), '2.16.0')).toEqual({
      ok: true,
      value: {
        assetName: 'LifeDash-2.16.0-Setup.exe',
        downloadUrl: 'https://github.com/Lab-51/lifedash/releases/download/v2.16.0/LifeDash-2.16.0-Setup.exe',
        sha256: DIGEST,
        size: 1234,
      },
    });
  });

  it.each([
    [
      'another host',
      {
        browser_download_url:
          'https://evil.example/Lab-51/lifedash/releases/download/v2.16.0/LifeDash-2.16.0-Setup.exe',
      },
    ],
    [
      'plain http',
      { browser_download_url: 'http://github.com/Lab-51/lifedash/releases/download/v2.16.0/LifeDash-2.16.0-Setup.exe' },
    ],
    [
      'another repo',
      {
        browser_download_url: 'https://github.com/someone/lifedash/releases/download/v2.16.0/LifeDash-2.16.0-Setup.exe',
      },
    ],
    [
      'another release tag',
      {
        browser_download_url: 'https://github.com/Lab-51/lifedash/releases/download/v2.15.0/LifeDash-2.16.0-Setup.exe',
      },
    ],
    [
      'a query string',
      {
        browser_download_url:
          'https://github.com/Lab-51/lifedash/releases/download/v2.16.0/LifeDash-2.16.0-Setup.exe?x=1',
      },
    ],
    [
      'a look-alike host',
      {
        browser_download_url:
          'https://github.com.evil.example/Lab-51/lifedash/releases/download/v2.16.0/LifeDash-2.16.0-Setup.exe',
      },
    ],
    ['no digest', { digest: undefined }],
    ['a non-sha256 digest', { digest: `md5:${'a'.repeat(32)}` }],
    ['an upper-case or short digest', { digest: `sha256:${'A'.repeat(64)}` }],
    ['no size', { size: undefined }],
    ['a zero size', { size: 0 }],
    ['a garbage URL', { browser_download_url: 'not a url' }],
  ])('rejects an installer with %s', (_label, assetOverrides) => {
    expect(parseInstaller(release({}, assetOverrides), '2.16.0').ok).toBe(false);
  });

  it('rejects a release with two installers of the same name', () => {
    const twice = release();
    twice.assets.push({ ...twice.assets[1] });
    expect(parseInstaller(twice, '2.16.0').ok).toBe(false);
  });

  it('rejects a release with no installer for that version', () => {
    expect(parseInstaller(release(), '2.17.0').ok).toBe(false);
  });
});

describe('isNewerVersion', () => {
  it('only moves forward', () => {
    expect(isNewerVersion('2.15.5', '2.16.0')).toBe(true);
    expect(isNewerVersion('2.15.5', '2.15.10')).toBe(true);
    expect(isNewerVersion('2.15.5', '2.15.5')).toBe(false);
    expect(isNewerVersion('2.15.5', '2.15.4')).toBe(false);
    expect(isNewerVersion('2.15.5', '1.99.99')).toBe(false);
  });
});

describe('fetchLatestRelease', () => {
  const respond = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers }));

  it('asks the GitHub releases API, never another host', async () => {
    const fetchFn = respond(200, release());
    const result = await fetchLatestRelease(fetchFn, '2.15.5');
    expect(fetchFn).toHaveBeenCalledWith(LATEST_RELEASE_API, expect.anything());
    expect(LATEST_RELEASE_API).toBe('https://api.github.com/repos/Lab-51/lifedash/releases/latest');
    expect(result.kind).toBe('release');
  });

  it('treats an exhausted rate limit as "check later", not an error', async () => {
    expect((await fetchLatestRelease(respond(403, {}, { 'x-ratelimit-remaining': '0' }), '2.15.5')).kind).toBe(
      'rate-limited',
    );
    expect((await fetchLatestRelease(respond(429), '2.15.5')).kind).toBe('rate-limited');
    expect((await fetchLatestRelease(respond(403, {}, { 'retry-after': '60' }), '2.15.5')).kind).toBe('rate-limited');
  });

  it('reports other failures as errors', async () => {
    expect((await fetchLatestRelease(respond(500), '2.15.5')).kind).toBe('error');
    expect((await fetchLatestRelease(respond(403), '2.15.5')).kind).toBe('error');
  });
});
