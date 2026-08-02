// Pure helpers behind Settings → Local AI. The region/language lookups run through
// Intl.DisplayNames, which THROWS on a non-region code — and custom GGUFs are
// registered with originCountry 'unknown', so the guard is load-bearing, not polish.
import { describe, it, expect } from 'vitest';
import type { CatalogModel, HardwareTier } from '../../../../../shared/types/localModels';
import { bestMatchRationale, formatRate, formatSize, languagesLabel, regionLabel } from '../format';
import { ANY, applyFilters, filterOptions } from '../LocalAIFilterBar';

function model(id: string, originCountry: string, license: string): CatalogModel {
  return {
    id,
    displayName: id,
    vendor: 'v',
    originCountry,
    license,
    role: 'chat',
    parameters: '7B',
    files: [],
    minRamGB: 8,
    languages: ['*'],
    toolCalling: false,
    contextLength: 4096,
  };
}

describe('formatSize / formatRate', () => {
  it('scales bytes to the largest sensible unit', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1024 * 1024 * 3.5)).toBe('3.5 MB');
    expect(formatSize(9_001_752_960)).toBe('8.4 GB');
  });

  it('treats a missing or negative size as zero rather than rendering NaN', () => {
    expect(formatSize(Number.NaN)).toBe('0 B');
    expect(formatSize(-1)).toBe('0 B');
  });

  it('renders nothing for an unknown transfer rate', () => {
    expect(formatRate(0)).toBe('');
    expect(formatRate(12_000_000)).toBe('11.4 MB/s');
  });
});

describe('regionLabel / languagesLabel', () => {
  it('names real ISO regions', () => {
    expect(regionLabel('CN')).toBe('China');
    expect(regionLabel('FR')).toBe('France');
  });

  it('passes a non-region code through instead of throwing (custom models use "unknown")', () => {
    expect(regionLabel('unknown')).toBe('unknown');
    expect(regionLabel('')).toBe('');
  });

  it('summarises language lists without dumping every code', () => {
    expect(languagesLabel(['*'])).toBe('Broadly multilingual');
    expect(languagesLabel([])).toBe('Unknown');
    expect(languagesLabel(['en', 'fr', 'de', 'es', 'it'])).toMatch(/\+2$/);
  });

  it('surfaces codes listed alongside the wildcard — "broadly multilingual" alone answers nothing', () => {
    // The wildcard says "many languages"; the codes beside it are the ones the vendor
    // names explicitly. A user working in Czech needs to see the second part.
    expect(languagesLabel(['*', 'cs', 'sk'])).toBe('Broadly multilingual (incl. Czech, Slovak)');
    // Wildcard alone must keep its old wording — no regression for models whose
    // vendor publishes no per-language list.
    expect(languagesLabel(['*'])).not.toMatch(/incl\./);
  });
});

describe('bestMatchRationale', () => {
  const tier: HardwareTier = {
    totalRamGB: 32,
    platform: 'win32',
    gpuSignal: 'vulkan',
    recommendedModelIds: ['qwen3-14b'],
  };

  it('stays hedged — VRAM detection was deferred, so the copy must not promise a fit', () => {
    const copy = bestMatchRationale(tier);
    expect(copy).toContain('32 GB of system RAM');
    expect(copy).toContain('Vulkan GPU');
    expect(copy).toContain('does not measure video memory');
    expect(copy).toContain('not a guarantee');
    // And it must never read as an action already taken.
    expect(copy).toContain('Nothing is downloaded until you choose');
  });
});

describe('catalog filters', () => {
  const models = [model('qwen', 'CN', 'Apache-2.0'), model('gemma', 'US', 'Gemma'), model('phi', 'US', 'MIT')];

  it('derives sorted, de-duplicated option lists from the catalog itself', () => {
    expect(filterOptions(models)).toEqual({
      origins: ['CN', 'US'],
      licenses: ['Apache-2.0', 'Gemma', 'MIT'],
    });
  });

  it('excludes models by origin — the enterprise-policy case the filter exists for', () => {
    expect(applyFilters(models, { origin: 'US', license: ANY }).map((m) => m.id)).toEqual(['gemma', 'phi']);
  });

  it('combines origin and license as an AND', () => {
    expect(applyFilters(models, { origin: 'US', license: 'MIT' }).map((m) => m.id)).toEqual(['phi']);
  });

  it('returns everything when neither filter is set', () => {
    expect(applyFilters(models, { origin: ANY, license: ANY })).toHaveLength(3);
  });
});
