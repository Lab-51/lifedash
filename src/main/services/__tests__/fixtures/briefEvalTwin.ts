// === FILE PURPOSE ===
// Synthetic digital-twin data and two pure measuring helpers for the twin on/off
// arm of the gated live brief eval (TWIN-LOOP Task 5, briefPipeline.live.test.ts).
// EVERY name, company and fact here is INVENTED — nothing is taken from a real
// meeting (see memory `feedback-no-real-meeting-data`).
//
// The twin arm runs the SAME transcript twice: OFF (no profile, no facts — today's
// path) and ON (this profile + these facts, read through the real
// getProfile / buildProfileContext / known-terms path with only the DB reads
// stubbed). The transcript is LONG_FIXTURE plus a few appended informational
// lines (TWIN_ARM_EXTRA_LINES) that mention two non-roster people and one term
// whose spelling is unusual — the places the twin can actually help. Those lines
// carry no decision, commitment or owner, so the fixture's ground truth is
// unchanged. Both arms see the identical transcript.
//
// === DEPENDENCIES ===
// None — dependency-free like briefEvalFixtures.ts.

import type { FixtureSegment } from './briefEvalFixtures';

/** The two non-roster people and the term the extra lines mention. */
export const TWIN_ARM_EXTRA_LINES: string[] = [
  'Ještě na okraj - s Wendeline Ashcroft-Okonkwo ze Stratoform Cloud jsem mluvil o tom, jak se do toho promítne Quillmark SLA.',
  'A Rhosyn Quillfeather z jejich podpory potvrdila, že Quillmark SLA se vztahuje i na noční běhy Falcon Sync.',
  'To je k tomu všechno, díky všem za čas.',
];

/** `base` segments plus the extra lines, one regular spacing apart. */
export function withTwinArmLines(base: FixtureSegment[]): FixtureSegment[] {
  const last = base[base.length - 1];
  const spacing = base.length > 1 ? last.startTime - base[base.length - 2].startTime : 30_000;
  return [
    ...base,
    ...TWIN_ARM_EXTRA_LINES.map((content, i) => ({ content, startTime: last.startTime + spacing * (i + 1) })),
  ];
}

export const SYNTHETIC_TWIN_PROFILE = {
  identity: { name: 'Ravenna Tolliver', role: 'Head of Platform', seniority: 'Director' },
  domain: {
    industry: 'B2B analytics',
    company: 'Kestrel Analytics',
    focus: 'platform reliability and vendor contracts',
  },
  people: [
    { name: 'Wendeline Ashcroft-Okonkwo', role: 'Account director', org: 'Stratoform Cloud' },
    { name: 'Rhosyn Quillfeather', role: 'Support lead', org: 'Stratoform Cloud' },
    { name: 'Petra Dvořáková', role: 'Platform lead', org: 'Kestrel Analytics' },
  ],
  vocabulary: [
    { term: 'Quillmark SLA', meaning: 'the vendor service-level agreement' },
    { term: 'Falcon Sync', meaning: 'the nightly data sync pipeline' },
    { term: 'Meridian Ledger', meaning: 'the billing ledger' },
  ],
};

export interface SyntheticFact {
  fact: string;
  category: 'person' | 'project' | 'preference' | 'domain' | 'commitment';
  /** Whether the fact is about this meeting's subject matter. */
  relevant: boolean;
}

/** Newest first, as the real loader returns them. The unrelated ones are the
 *  newest on purpose: recency alone would inject them ahead of the relevant ones. */
export const SYNTHETIC_TWIN_FACTS: SyntheticFact[] = [
  { fact: 'The user is learning to bake sourdough on weekends.', category: 'preference', relevant: false },
  {
    fact: 'Project Orchid is the unrelated mobile app rewrite for the retail division.',
    category: 'project',
    relevant: false,
  },
  { fact: 'Imogen Fairweather-Boyd runs the quarterly offsite logistics.', category: 'person', relevant: false },
  { fact: 'The user prefers concise status updates in bullet form.', category: 'preference', relevant: false },
  {
    fact: 'The Stratoform Cloud contract is up for renewal and the user wants a two-year term.',
    category: 'project',
    relevant: true,
  },
  {
    fact: 'Wendeline Ashcroft-Okonkwo is the Stratoform Cloud account director.',
    category: 'person',
    relevant: true,
  },
  {
    fact: 'Falcon Sync nightly runs have a history of failing for large tenants.',
    category: 'domain',
    relevant: true,
  },
  {
    fact: 'Meridian Ledger rounding complaints come from enterprise customers.',
    category: 'domain',
    relevant: true,
  },
  {
    fact: 'The user wants Nightwatch alerts reduced because on-call engineers are fatigued.',
    category: 'preference',
    relevant: true,
  },
  {
    fact: 'Beacon push-notification delays mostly affect European customers.',
    category: 'domain',
    relevant: true,
  },
];

/** The profile's people names then vocabulary terms — the spellings the arm counts. */
export function twinSpellings(): string[] {
  return [...SYNTHETIC_TWIN_PROFILE.people.map((p) => p.name), ...SYNTHETIC_TWIN_PROFILE.vocabulary.map((v) => v.term)];
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export interface SpellingHits {
  /** Terms present in `text` spelled exactly as given (case- and diacritic-sensitive substring). */
  exact: string[];
  /** Present only in a folded form (case or diacritics differ) — a misspelling of the profile's spelling. */
  nearMiss: string[];
  /** Not present at all, even folded. */
  absent: string[];
}

/** Classify each term as spelled exactly, spelled loosely, or absent in `text`. */
export function countSpellingHits(text: string, terms: string[]): SpellingHits {
  const folded = fold(text);
  const hits: SpellingHits = { exact: [], nearMiss: [], absent: [] };
  for (const term of terms) {
    if (text.includes(term)) hits.exact.push(term);
    else if (folded.includes(fold(term))) hits.nearMiss.push(term);
    else hits.absent.push(term);
  }
  return hits;
}

export interface InjectedFactCounts {
  relevantInjected: number;
  unrelatedInjected: number;
  relevantTotal: number;
  unrelatedTotal: number;
}

/** How many of `facts` appear verbatim in the injected context text, split by relevance. */
export function countInjectedFacts(contextText: string, facts: SyntheticFact[]): InjectedFactCounts {
  const counts: InjectedFactCounts = { relevantInjected: 0, unrelatedInjected: 0, relevantTotal: 0, unrelatedTotal: 0 };
  for (const { fact, relevant } of facts) {
    const injected = contextText.includes(fact);
    if (relevant) {
      counts.relevantTotal++;
      if (injected) counts.relevantInjected++;
    } else {
      counts.unrelatedTotal++;
      if (injected) counts.unrelatedInjected++;
    }
  }
  return counts;
}
