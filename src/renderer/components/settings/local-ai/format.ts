// === FILE PURPOSE ===
// Pure presentation helpers for Settings → Local AI: byte/rate formatting, ISO
// region + language labels, and the two pieces of load-bearing copy (the hedged
// best-match rationale and the tool-calling consequence line). Kept separate so
// the wording is asserted by tests in one place instead of per component.
//
// === DEPENDENCIES ===
// Intl.DisplayNames (platform built-in) — no libraries.

import type { HardwareTier } from '../../../../shared/types/localModels';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Human byte size, e.g. 9001752960 → "8.4 GB". */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exp;
  return `${value.toFixed(exp === 0 ? 0 : 1)} ${UNITS[exp]}`;
}

/** Transfer rate, e.g. "12.4 MB/s". Blank while the rate is still unknown. */
export function formatRate(bytesPerSecond: number): string {
  return bytesPerSecond > 0 ? `${formatSize(bytesPerSecond)}/s` : '';
}

const REGION_CODE = /^[A-Z]{2}$/;
let regionNames: Intl.DisplayNames | null | undefined;
let languageNames: Intl.DisplayNames | null | undefined;

function displayNames(type: 'region' | 'language'): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames(undefined, { type });
  } catch {
    return null; // Environment without full ICU — fall back to raw codes.
  }
}

/** 'CN' → "China". Unknown/custom origins pass through unchanged. */
export function regionLabel(code: string): string {
  const upper = code.toUpperCase();
  if (!REGION_CODE.test(upper)) return code;
  if (regionNames === undefined) regionNames = displayNames('region');
  try {
    return regionNames?.of(upper) ?? upper;
  } catch {
    return upper;
  }
}

/** Human-readable language names, truncated with a "+N" tail past three. */
function namedLanguages(codes: string[]): string {
  if (languageNames === undefined) languageNames = displayNames('language');
  const named = codes.slice(0, 3).map((c) => {
    try {
      return languageNames?.of(c) ?? c;
    } catch {
      return c;
    }
  });
  return codes.length > 3 ? `${named.join(', ')} +${codes.length - 3}` : named.join(', ');
}

/**
 * ['*'] → "Broadly multilingual"; an explicit list → the first few named languages.
 *
 * Codes listed ALONGSIDE '*' are the ones the vendor names explicitly, and they get
 * surfaced: "Broadly multilingual" on its own tells someone working in Czech or
 * Slovak nothing about their own language, which is the question that actually
 * decides whether a model is usable for them.
 */
export function languagesLabel(codes: string[]): string {
  if (codes.length === 0) return 'Unknown';
  const explicit = codes.filter((c) => c !== '*');
  if (!codes.includes('*')) return namedLanguages(explicit);
  return explicit.length > 0 ? `Broadly multilingual (incl. ${namedLanguages(explicit)})` : 'Broadly multilingual';
}

const GPU_LABEL: Record<HardwareTier['gpuSignal'], string> = {
  vulkan: 'a Vulkan GPU',
  cuda: 'an NVIDIA (CUDA) GPU',
  metal: 'an Apple Metal GPU',
  cpu: 'no detected GPU',
  unknown: 'an unknown GPU',
};

/**
 * One-line rationale under the best-match highlight. Deliberately HEDGED: tiering
 * v1 reads total system RAM, the platform and the transcription GPU signal — it
 * does NOT measure VRAM, so the copy must never promise a model will run well.
 */
export function bestMatchRationale(tier: HardwareTier): string {
  return `Likely the best fit for your machine — based on ${tier.totalRamGB} GB of system RAM and ${GPU_LABEL[tier.gpuSignal]}. LifeDash does not measure video memory, so treat this as a starting point, not a guarantee. Nothing is downloaded until you choose.`;
}

/**
 * The consequence of picking a chat model whose GGUF chat template has no tool
 * section. Verified per-file in Task 3 from the shipped template — not from the
 * upstream model card, which can advertise function calling the file cannot do.
 */
export const NO_TOOL_CALLING_CONSEQUENCE =
  'Chats fine, but cannot run Digital Twin actions — it can’t create, move or update cards for you.';
