// === FILE PURPOSE ===
// The verified download (UPDATER-SAFE.1) against a real local HTTP server and real
// files: only bytes whose size and sha256 match the release record get the final name;
// anything else leaves no file behind. Host rules are tested on their own.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { downloadVerified, isAllowedDownloadHost, removeOtherDownloads, sha256File } from '../updateDownload';

const PAYLOAD = Buffer.alloc(256 * 1024, 7); // big enough to stream in several chunks
const PAYLOAD_SHA = createHash('sha256').update(PAYLOAD).digest('hex');
const allowLocal = () => true;

let server: http.Server;
let base: string;
let destDir: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/good') {
      res.writeHead(200, { 'Content-Length': PAYLOAD.length });
      res.end(PAYLOAD);
    } else if (req.url === '/flipped') {
      const copy = Buffer.from(PAYLOAD);
      copy[1000] ^= 1;
      res.end(copy);
    } else if (req.url === '/short') {
      res.end(PAYLOAD.subarray(0, PAYLOAD.length - 1));
    } else if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/good' });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifedash-update-'));
});

const request = (urlPath: string, overrides: Partial<Parameters<typeof downloadVerified>[0]> = {}) => ({
  url: `${base}${urlPath}`,
  sha256: PAYLOAD_SHA,
  size: PAYLOAD.length,
  destDir,
  fileName: 'LifeDash-9.9.9-Setup.exe',
  ...overrides,
});

describe('downloadVerified', () => {
  it('keeps a download whose size and sha256 match, under its final name', async () => {
    const progress: number[] = [];
    const file = await downloadVerified(request('/good', { onProgress: (p) => progress.push(p) }), fetch, allowLocal);
    expect(path.basename(file)).toBe('LifeDash-9.9.9-Setup.exe');
    expect(await sha256File(file)).toBe(PAYLOAD_SHA);
    expect(progress.at(-1)).toBe(100);
    expect(fs.readdirSync(destDir)).toEqual(['LifeDash-9.9.9-Setup.exe']);
  });

  it('follows a redirect and still verifies the bytes', async () => {
    const file = await downloadVerified(request('/redirect'), fetch, allowLocal);
    expect(await sha256File(file)).toBe(PAYLOAD_SHA);
  });

  it.each([
    ['one flipped byte', '/flipped', /sha256/],
    ['a truncated stream', '/short', /incomplete/],
    ['a 404', '/missing', /status 404/],
  ])('rejects %s and leaves no file behind', async (_label, urlPath, message) => {
    await expect(downloadVerified(request(urlPath), fetch, allowLocal)).rejects.toThrow(message);
    expect(fs.readdirSync(destDir)).toEqual([]);
  });

  it('rejects more bytes than the published size', async () => {
    await expect(downloadVerified(request('/good', { size: 10 }), fetch, allowLocal)).rejects.toThrow(/larger/);
    expect(fs.readdirSync(destDir)).toEqual([]);
  });

  it('refuses any host that is not GitHub with the default host rule', async () => {
    await expect(downloadVerified(request('/good'), fetch)).rejects.toThrow(/Refusing/);
    expect(fs.readdirSync(destDir)).toEqual([]);
  });
});

describe('isAllowedDownloadHost', () => {
  it.each([
    ['https://github.com/Lab-51/lifedash/releases/download/v1.0.0/x.exe', true],
    ['https://release-assets.githubusercontent.com/github-production-release-asset/1/2', true],
    ['https://objects.githubusercontent.com/x', true],
    ['http://github.com/x', false],
    ['https://github.com.evil.example/x', false],
    ['https://evilgithubusercontent.com/x', false],
    ['https://lifedash.space/x', false],
    ['not a url', false],
  ])('%s → %s', (url, allowed) => {
    expect(isAllowedDownloadHost(url)).toBe(allowed);
  });
});

describe('removeOtherDownloads', () => {
  it('keeps only the verified installer', async () => {
    fs.writeFileSync(path.join(destDir, 'LifeDash-1.0.0-Setup.exe'), 'old');
    fs.writeFileSync(path.join(destDir, 'LifeDash-9.9.9-Setup.exe.partial'), 'abandoned');
    const keep = path.join(destDir, 'LifeDash-9.9.9-Setup.exe');
    fs.writeFileSync(keep, 'new');
    await removeOtherDownloads(destDir, keep);
    expect(fs.readdirSync(destDir)).toEqual(['LifeDash-9.9.9-Setup.exe']);
  });
});
