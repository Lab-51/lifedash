// === FILE PURPOSE ===
// Unit tests for evidence anchoring (BRIEF-EVID.1 Task 2) — the code gate that
// decides whether the model's `quote` is really backed by the transcript.
//
// What matters here, in order:
//   1. A quote that IS in the transcript anchors, across the spelling disagreement
//      whisper and the model actually have — diacritics, in both directions.
//   2. A quote that is NOT in the transcript anchors to NOTHING. A confident
//      paraphrase with a third of the words in common is the failure this whole
//      module exists to stop, and it must return null, not a nearby line.
//   3. The anchor points at the RIGHT line. An off-by-one window is a wrong
//      citation, which is worse than no citation.
//   4. Nothing is dropped, reordered, or rewritten — least of all the quote.
//
// Every name, system and sentence below is INVENTED (Czech/English mixed, with
// diacritics, mirroring the real failure mode). See memory
// `feedback-no-real-meeting-data`.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logMock } = vi.hoisted(() => ({
  logMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../logger', () => ({ createLogger: () => logMock }));

import { anchorEvidence } from '../evidenceAnchorService';
import { MeetingStructureDraftSchema, type MeetingStructureDraft } from '../../../shared/types/briefStructure';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** One invented meeting. Segment 0 spells "Ondřej" accented and segment 5 spells
 *  the same person "Ondrej" bare — exactly the way one whisper pass disagrees
 *  with the next — so the fold can be exercised in BOTH directions.
 *  Segments 3 and 4 are one sentence cut across a window boundary. */
const TRANSCRIPT = [
  { startTime: 0, content: 'Ondřej otevřel schůzku a prošel agendu.' },
  {
    startTime: 10_000,
    content: 'The nightly Kestrel Sync export failed for tenants above five thousand rows last night.',
  },
  { startTime: 20_000, content: 'Zvedneme batch limit na pět tisíc řádků, je to levnější než přepisovat celý worker.' },
  { startTime: 30_000, content: 'Petra nasadí opravu zaokrouhlování Meridian Ledgeru' },
  { startTime: 40_000, content: 'na staging do pondělí, ať to stihneme před fakturací.' },
  { startTime: 50_000, content: 'Ondrej jeste dopise postmortem k tomu incidentu.' },
];

/** Build a draft through the REAL schema, so these items carry exactly the shape
 *  a parsed model reply carries (`evidence: null`, trimmed text, lenient
 *  defaults) — never a hand-written approximation of it. */
function draftWithDecisionQuote(quote: string | null): MeetingStructureDraft {
  return MeetingStructureDraftSchema.parse({
    topics: [],
    decisions: [{ statement: 'Zvedneme batch limit', rationale: null, status: 'agreed', quote }],
    commitments: [],
    openQuestions: [],
    terms: [],
  });
}

/** The evidence stamped on the single decision of such a draft. */
function decisionEvidence(quote: string | null, segments = TRANSCRIPT) {
  return anchorEvidence(draftWithDecisionQuote(quote), segments).decisions[0].evidence;
}

beforeEach(() => {
  logMock.info.mockClear();
});

// ---------------------------------------------------------------------------
// (1) Exact containment — case and diacritics, both directions
// ---------------------------------------------------------------------------

describe('anchorEvidence — exact containment', () => {
  it('anchors an unaccented, lower-cased quote to the accented segment it came from', () => {
    expect(decisionEvidence('ondrej otevrel schuzku')).toEqual({
      startTime: 0,
      excerpt: 'Ondřej otevřel schůzku a prošel agendu.',
    });
  });

  it('anchors the reverse too — an accented quote against the segment that spelled it bare', () => {
    expect(decisionEvidence('Ondřej ještě dopíše postmortem')).toEqual({
      startTime: 50_000,
      excerpt: 'Ondrej jeste dopise postmortem k tomu incidentu.',
    });
  });

  it('matches whole words only — a fragment inside a longer word is not evidence', () => {
    // "gend" occurs inside "agendu" but is not a word of its own, so it must not
    // anchor. This is the space-wrapping in the shared fold doing its job.
    expect(decisionEvidence('gend')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (7) The excerpt is the SEGMENT's text, never the model's quote
// ---------------------------------------------------------------------------

describe('anchorEvidence — the excerpt is stored text', () => {
  it("stores the segment's own content, not the quote the model supplied", () => {
    const quote = 'ondrej otevrel schuzku';
    const evidence = decisionEvidence(quote);

    expect(evidence?.excerpt).toBe(TRANSCRIPT[0].content);
    expect(evidence?.excerpt).not.toBe(quote);
  });

  it('trims the stored excerpt — leading/trailing whitespace is not part of the citation', () => {
    const padded = [{ startTime: 5_000, content: '   Ondřej otevřel schůzku a prošel agendu.  ' }];

    expect(decisionEvidence('ondrej otevrel schuzku', padded)?.excerpt).toBe('Ondřej otevřel schůzku a prošel agendu.');
  });

  it('leaves the quote itself untouched — never corrected to the transcript spelling', () => {
    const quote = 'ondrej otevrel schuzku';
    const result = anchorEvidence(draftWithDecisionQuote(quote), TRANSCRIPT);

    expect(result.decisions[0].quote).toBe(quote);
  });
});

// ---------------------------------------------------------------------------
// (2) Overlap — a real paraphrase anchors, a thin one does not
// ---------------------------------------------------------------------------

describe('anchorEvidence — overlap pass', () => {
  it('anchors a paraphrase sharing ~64% of its tokens to the segment it paraphrases', () => {
    // 7 of 11 distinct tokens occur in the 10s segment; every other segment scores 0.
    expect(decisionEvidence('the nightly Kestrel Sync export broke again for our biggest tenants')).toEqual({
      startTime: 10_000,
      excerpt: TRANSCRIPT[1].content,
    });
  });

  it('refuses a quote sharing only ~33% of its tokens — a confident invention, not evidence', () => {
    // 3 of 9 distinct tokens ("the", "kestrel", "sync") occur in the 10s segment.
    expect(decisionEvidence('the Kestrel Sync dashboard rewrite slipped into the next quarter')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (3) The short-quote guard
// ---------------------------------------------------------------------------

describe('anchorEvidence — the four-token minimum', () => {
  it('never anchors a three-token quote by overlap, even at 100% of its tokens', () => {
    // All three words are in the 20s segment, but not contiguously — so the exact
    // pass misses and the overlap pass is the only route, which the guard closes.
    expect(decisionEvidence('batch limit zvedneme')).toBeNull();
  });

  it('still anchors a short quote when it is contained VERBATIM — being exact is its own evidence', () => {
    expect(decisionEvidence('zvedneme batch limit')).toEqual({ startTime: 20_000, excerpt: TRANSCRIPT[2].content });
  });
});

// ---------------------------------------------------------------------------
// (4) Straddling a window boundary
// ---------------------------------------------------------------------------

describe('anchorEvidence — a quote cut across two windows', () => {
  it('anchors to the FIRST of the two adjacent segments when neither alone would qualify', () => {
    // 5 of 11 tokens (0.45) in the 30s segment, 6 of 11 (0.55) in the 40s segment
    // — both under the bar. The pair holds all 11.
    const evidence = decisionEvidence(
      'nasadí opravu zaokrouhlování Meridian Ledgeru na staging do pondělí před fakturací',
    );

    expect(evidence).toEqual({ startTime: 30_000, excerpt: TRANSCRIPT[3].content });
  });

  it('does NOT hand a quote that sits wholly in one segment to its predecessor', () => {
    // The off-by-one this guards: the pair (20s, 30s) scores exactly what the 30s
    // segment scores alone, so a bare "ties go to the earliest" rule would cite
    // the 20s line — which contributed not one word of the quote.
    const evidence = decisionEvidence('Petra nasadí opravu zaokrouhlování Meridian Ledgeru z minulého týdne');

    expect(evidence?.startTime).toBe(30_000);
  });

  it('does not let ONE shared function word in the predecessor steal the anchor', () => {
    // The exact-tie case above is the easy half. The shipping hole is this one: the
    // quote drifts by a word or two (the ordinary case 0.6 exists to tolerate), so
    // the 30s segment holds 6 of its 8 tokens — and the 20s line holds exactly one,
    // "je". A pair that only has to BEAT its two members re-opens the off-by-one,
    // because (20s, 30s) at 7/8 beats 6/8 and is visited first. A citation pointing
    // at a line whose only contribution is a particle is a wrong citation.
    const evidence = decisionEvidence('Petra nasadí opravu zaokrouhlování Meridian Ledgeru je hotová');

    expect(evidence?.startTime).toBe(30_000);
  });

  it('does not let a function word shared with BOTH neighbours steal the anchor', () => {
    // "na" occurs in the 20s line and in the 40s line, so the quote's own segment
    // has a same-token neighbour on either side. In Czech "na/je/to/se/a/v" sit in
    // nearly every window, which is what makes this the common shape rather than
    // the exotic one.
    const evidence = decisionEvidence('Petra nasadí opravu zaokrouhlování Meridian Ledgeru na produkci');

    expect(evidence?.startTime).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// (5) An invented quote
// ---------------------------------------------------------------------------

describe('anchorEvidence — an invented quote', () => {
  const INVENTED = 'Překlopíme celý fakturační systém k novému dodavateli.';

  it('returns null rather than the nearest line', () => {
    // Deliberately NOT disjoint from the transcript: it shares the stopword-ish
    // "celý" and "k". What rejects it is the THRESHOLD, not the absence of any
    // overlap at all — which is what makes the threshold's control experiment bite.
    expect(decisionEvidence(INVENTED)).toBeNull();
  });

  it('keeps the item, its quote and its position — an unsupported item is still an item', () => {
    const draft = MeetingStructureDraftSchema.parse({
      topics: [],
      decisions: [
        { statement: 'Anchored one', rationale: null, status: 'agreed', quote: 'ondrej otevrel schuzku' },
        { statement: 'Invented one', rationale: null, status: 'proposed', quote: INVENTED },
        { statement: 'Quiet one', rationale: null, status: 'proposed', quote: null },
      ],
      commitments: [],
      openQuestions: [],
      terms: [],
    });

    const result = anchorEvidence(draft, TRANSCRIPT);

    expect(result.decisions.map((d) => d.statement)).toEqual(['Anchored one', 'Invented one', 'Quiet one']);
    expect(result.decisions[0].evidence).not.toBeNull();
    expect(result.decisions[1].evidence).toBeNull();
    expect(result.decisions[1].quote).toBe(INVENTED);
    expect(result.decisions[2].evidence).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// `evidence` is code-owned on EVERY item
// ---------------------------------------------------------------------------

describe('anchorEvidence — evidence is never accepted from the model', () => {
  it('clears an evidence object the model wrote onto an item carrying no quote', () => {
    // The draft schema PARSES `evidence` (it has to — a persisted v2 structure is
    // re-parsed through it), so a model that helpfully emits its own
    // {startTime, excerpt} reaches this service with no code judgement behind it.
    // An item with `quote: null` has nothing for code to verify, so the only
    // honest evidence is none.
    const draft = MeetingStructureDraftSchema.parse({
      topics: [],
      decisions: [
        {
          statement: 'Zvedneme batch limit',
          rationale: null,
          status: 'agreed',
          quote: null,
          evidence: { startTime: 999_999, excerpt: 'fabricated by the model' },
        },
      ],
      commitments: [],
      openQuestions: [],
      terms: [],
    });
    // Non-vacuity: the schema really does carry the model's object in.
    expect(draft.decisions[0].evidence).toEqual({ startTime: 999_999, excerpt: 'fabricated by the model' });

    const result = anchorEvidence(draft, TRANSCRIPT);

    expect(result.decisions[0].evidence).toBeNull();
    expect(result.decisions[0].statement).toBe('Zvedneme batch limit');
    expect(result.decisions[0].quote).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (6) Ties
// ---------------------------------------------------------------------------

describe('anchorEvidence — ties', () => {
  /** The same line said twice: once when decided, once in the closing recap. */
  const REPEATED = [
    { startTime: 0, content: 'Zvedneme batch limit na pět tisíc řádků.' },
    { startTime: 60_000, content: 'Mezitím Petra dokončila migraci indexu.' },
    { startTime: 120_000, content: 'Zvedneme batch limit na pět tisíc řádků.' },
  ];

  it('takes the earliest segment when two score identically on the exact pass', () => {
    expect(decisionEvidence('zvedneme batch limit na pět tisíc řádků', REPEATED)?.startTime).toBe(0);
  });

  it('takes the earliest segment when two score identically on the overlap pass', () => {
    // Reordered, so the exact pass cannot fire; 7 of 8 tokens in both copies.
    expect(decisionEvidence('batch limit zvedneme na pět tisíc řádků prosím', REPEATED)?.startTime).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Commitments, pass-through and the log line
// ---------------------------------------------------------------------------

describe('anchorEvidence — the whole structure', () => {
  it('anchors commitments by exactly the same rule as decisions', () => {
    const draft = MeetingStructureDraftSchema.parse({
      topics: [{ title: 'Fakturace', detail: 'Meridian Ledger' }],
      decisions: [],
      commitments: [
        {
          owner: 'Petra Dvořáková',
          task: 'Nasadit opravu na staging',
          due: 'pondělí',
          explicit: true,
          quote: 'petra nasadi opravu zaokrouhlovani meridian ledgeru',
        },
      ],
      openQuestions: [],
      terms: [],
    });

    expect(anchorEvidence(draft, TRANSCRIPT).commitments[0].evidence).toEqual({
      startTime: 30_000,
      excerpt: TRANSCRIPT[3].content,
    });
  });

  it('returns the INPUT draft itself when nothing carries a quote — byte-identical, not merely equal', () => {
    const draft = MeetingStructureDraftSchema.parse({
      topics: [{ title: 'Fakturace', detail: 'Meridian Ledger' }],
      decisions: [{ statement: 'Zvedneme batch limit', rationale: 'Levnější', status: 'agreed', quote: null }],
      commitments: [{ owner: null, task: 'Dopsat postmortem', due: null, explicit: false, quote: null }],
      openQuestions: ['Kdo to odsouhlasí?'],
      terms: ['Kestrel Sync'],
    });

    expect(anchorEvidence(draft, TRANSCRIPT)).toBe(draft);
  });

  it('logs one line per structure carrying anchored/quoted and the unsupported count', () => {
    const draft = MeetingStructureDraftSchema.parse({
      topics: [],
      decisions: [
        { statement: 'A', rationale: null, status: 'agreed', quote: 'ondrej otevrel schuzku' },
        { statement: 'B', rationale: null, status: 'proposed', quote: 'Překlopíme celý fakturační systém' },
        { statement: 'C', rationale: null, status: 'proposed', quote: null },
      ],
      commitments: [
        {
          owner: null,
          task: 'T',
          due: null,
          explicit: false,
          quote: 'petra nasadi opravu zaokrouhlovani meridian ledgeru',
        },
      ],
      openQuestions: [],
      terms: [],
    });

    anchorEvidence(draft, TRANSCRIPT);

    expect(logMock.info).toHaveBeenCalledTimes(1);
    expect(logMock.info.mock.calls[0][0]).toContain('2/3');
    expect(logMock.info.mock.calls[0][0]).toContain('1 unsupported');
  });

  it('anchors nothing at all when the part has no segments, and still keeps every item', () => {
    const result = anchorEvidence(draftWithDecisionQuote('Ondřej ještě dopíše postmortem'), []);

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].evidence).toBeNull();
  });
});
