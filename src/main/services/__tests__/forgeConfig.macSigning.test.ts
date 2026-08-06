// Regression guard for macOS code signing in forge.config.ts.
//
// WHY THIS FILE EXISTS: v2.7.0's macOS DMG was effectively unusable and nothing in
// CI noticed. Forge rewrites Info.plist AFTER packaging, so an unsigned bundle keeps
// Electron's stock linker signature (com.github.Electron) with a now-broken seal.
// Two user-visible failures followed, neither of which looks like a signing problem:
//   1. Gatekeeper hard-blocks the quarantined download as "damaged" — it does not
//      even offer Open Anyway, so the app simply cannot be launched.
//   2. TCC attributes capture to the mismatched identity, silently killing
//      system-audio capture even after the user grants Screen Recording.
// Both were diagnosed only by a bench agent on real Mac hardware (PR #6).
//
// WHY SOURCE-LEVEL AND NOT AN IMPORT: forge.config.ts imports the whole Electron
// Forge toolchain (makers, vite plugin, fuses) and calls execFileSync at module
// scope. Importing it into vitest would execute build-time side effects on every
// run. The build config is also never exercised by any other test — the Windows CI
// runner cannot validate macOS signing at all — so a source assertion is the only
// automated check available. It is coarse, but it fails loudly if the block is
// deleted or weakened, which is the failure mode that actually happened.
//
// See DECISIONS.md 2026-08-06 "macOS recording unblocked by always-signing".

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = path.resolve(__dirname, '../../../../forge.config.ts');
const source = fs.readFileSync(CONFIG_PATH, 'utf8');

describe('forge.config.ts — macOS signing must never regress to unsigned', () => {
  it('reads the config file it is guarding (fails loudly if the path moves)', () => {
    // Guards the guard: if forge.config.ts is renamed or relocated, every
    // assertion below would silently pass against an empty string.
    expect(fs.existsSync(CONFIG_PATH)).toBe(true);
    expect(source.length).toBeGreaterThan(500);
    expect(source).toMatch(/packagerConfig/);
  });

  it('configures osxSign — signing is NOT optional', () => {
    expect(source).toMatch(/osxSign:/);
  });

  it('falls back to AD-HOC signing when APPLE_IDENTITY is absent', () => {
    // The fallback is the whole point: unsigned is never an acceptable outcome.
    // Without a paid Apple Developer ID, ad-hoc ('-') still seals the bundle with
    // the real bundle id, which is what fixes both the "damaged" block and the
    // TCC misattribution.
    expect(source).toMatch(/identity:\s*'-'/);
  });

  it("disables identityValidation so '-' reaches codesign verbatim", () => {
    // With validation on, osx-sign searches the keychain for a cert literally
    // named '-', fails, and silently produces an unsigned bundle.
    expect(source).toMatch(/identityValidation:\s*false/);
  });

  it('signs ad-hoc builds WITHOUT the hardened runtime', () => {
    // osx-sign defaults hardenedRuntime to true. Hardened runtime enforces
    // library validation, which requires a shared Team ID — an ad-hoc signature
    // has none, so dyld kills the app at launch ("mapping process and mapped
    // file (non-platform) have different Team IDs").
    expect(source).toMatch(/hardenedRuntime:\s*false/);
  });

  it('still honours APPLE_IDENTITY when a real certificate is available', () => {
    // The ad-hoc path is the fallback, not a hardcoded ceiling — a real Developer
    // ID must keep taking precedence, since that is the eventual fix for the
    // per-update TCC re-prompts that keep macOS in beta.
    expect(source).toMatch(/process\.env\.APPLE_IDENTITY/);
  });
});
