// === FILE PURPOSE ===
// Hand-crafted fixture set for the project auto-detect classifier (MEET-INTEL.1-3).
// Used for the stop-condition accuracy test in STORY-MEET-INTEL.1-3 verification step 3.
//
// The fixture set covers:
//  - 6 "clear-match" scenarios — transcript distinctly references one project.
//  - 2 "ambiguous" scenarios — transcript could match either of two projects;
//    either project ID OR null (with low-mid confidence) are acceptable answers.
//  - 2 "no clear project" scenarios — transcript doesn't relate to any project.
//
// Usage:
//   import { fixtures } from './fixtures/projectDetectionFixtures';
//   for (const f of fixtures) {
//     const result = await detectProjectFromTranscript({ transcript: f.transcript, projects: f.projects });
//     // Score per f.expectation
//   }

import type { DetectionProject, DetectionResult } from '../../projectDetectionService';

export type ExpectedOutcome =
  | { kind: 'match'; expectedId: string }
  | { kind: 'ambiguous'; acceptableIds: string[] }
  | { kind: 'none' };

export interface DetectionFixture {
  name: string;
  description: string;
  projects: DetectionProject[];
  transcript: string;
  expectation: ExpectedOutcome;
}

// Reusable project lists — each fixture references one of these.
const TYPICAL_PROJECTS: DetectionProject[] = [
  {
    id: 'p-website',
    name: 'Website Redesign',
    description: 'Customer-facing marketing site overhaul — new design system, hero section, pricing pages.',
  },
  {
    id: 'p-api',
    name: 'API Refactor',
    description: 'Migrate the backend REST API to GraphQL. Includes auth, billing, and data ingestion endpoints.',
  },
  {
    id: 'p-mobile',
    name: 'Mobile App',
    description: 'iOS and Android mobile app for end users. Push notifications, offline mode, biometric auth.',
  },
  {
    id: 'p-onboarding',
    name: 'User Onboarding Flow',
    description: 'Sign-up, email verification, first-run experience, tooltips, sample data seeding.',
  },
];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const fixtures: DetectionFixture[] = [
  // ---- CLEAR MATCHES (6) -------------------------------------------------------
  {
    name: 'clear-website-1',
    description: 'Transcript explicitly discusses the website redesign hero and pricing pages.',
    projects: TYPICAL_PROJECTS,
    transcript:
      'Today we reviewed the new hero section design for the website redesign. The headline copy and call-to-action button colors were debated. The pricing page now uses three tiers instead of four. Marketing wants the testimonials carousel above the fold. We also discussed the new font family across the marketing site.',
    expectation: { kind: 'match', expectedId: 'p-website' },
  },
  {
    name: 'clear-api-1',
    description: 'Transcript discusses GraphQL migration of billing endpoints.',
    projects: TYPICAL_PROJECTS,
    transcript:
      'We mapped the GraphQL schema for the billing endpoints today. The resolver layer needs to handle both Stripe and PayPal integrations. We discussed deprecating the v1 REST routes but keeping them alive for six months. Auth middleware should be reused. Data ingestion endpoints are next sprint.',
    expectation: { kind: 'match', expectedId: 'p-api' },
  },
  {
    name: 'clear-mobile-1',
    description: 'Transcript explicitly about iOS push notifications and offline mode.',
    projects: TYPICAL_PROJECTS,
    transcript:
      'iOS push notifications are now firing correctly when the app is in the background. We need to add silent notifications for the offline sync. Android biometric auth via fingerprint works on Pixel 8 but fails on Samsung S22. Offline mode caching policy: the last 7 days of data, evicted FIFO.',
    expectation: { kind: 'match', expectedId: 'p-mobile' },
  },
  {
    name: 'clear-onboarding-1',
    description: 'Transcript discusses sign-up flow and email verification.',
    projects: TYPICAL_PROJECTS,
    transcript:
      'New sign-up flow drops the password requirement on first screen — we collect that on step 2 instead. Email verification link expires after 24 hours. The first-run tooltips fire when the user clicks the empty board area. Sample data seeding now creates 3 example cards per column.',
    expectation: { kind: 'match', expectedId: 'p-onboarding' },
  },
  {
    name: 'clear-website-2',
    description: 'Transcript discussing testimonials and CSS animations on the marketing site.',
    projects: TYPICAL_PROJECTS,
    transcript:
      'The marketing team wants three customer testimonials on the home page above the pricing CTA. We added a CSS animation that fades in each testimonial on scroll. The mobile breakpoint stacks them vertically. The customer logos row uses a horizontal infinite scroll.',
    expectation: { kind: 'match', expectedId: 'p-website' },
  },
  {
    name: 'clear-api-2',
    description: 'Transcript discussing GraphQL resolver performance and database joins.',
    projects: TYPICAL_PROJECTS,
    transcript:
      'The new GraphQL resolver for the user profile query is making N+1 queries. We need to add DataLoader. The auth resolver is fine, but billing is hitting the database 30 times per request. We may need to denormalize the subscription tier into the user table for fast resolution.',
    expectation: { kind: 'match', expectedId: 'p-api' },
  },

  // ---- AMBIGUOUS (2) ----------------------------------------------------------
  {
    name: 'ambiguous-website-or-onboarding',
    description: 'Transcript discusses landing page conversion AND first-time user signup tooltips.',
    projects: TYPICAL_PROJECTS,
    transcript:
      'We need to improve the landing page to better convert visitors into sign-ups. The first-time user experience is also clunky — too many tooltips on the empty state. Marketing wants both projects to share a unified visual language. Should the new sign-up button live on the landing page or only after email verification?',
    expectation: { kind: 'ambiguous', acceptableIds: ['p-website', 'p-onboarding'] },
  },
  {
    name: 'ambiguous-api-or-mobile',
    description: 'Transcript discusses backend auth changes affecting mobile clients.',
    projects: TYPICAL_PROJECTS,
    transcript:
      'The backend auth endpoint now requires a device fingerprint header. The mobile app needs to start sending it. We also discussed switching the API to GraphQL but the mobile team is still on REST. Push notifications will continue using a separate service. Should we ship the auth header change first?',
    expectation: { kind: 'ambiguous', acceptableIds: ['p-api', 'p-mobile'] },
  },

  // ---- NO MATCH (2) -----------------------------------------------------------
  {
    name: 'none-team-lunch',
    description: 'Transcript is small talk about lunch plans — no project signal.',
    projects: TYPICAL_PROJECTS,
    transcript:
      'Are we going to that new ramen place for lunch? I had it last week and it was really good. The spicy miso is excellent. I think Mark mentioned wanting to try the sushi place down the street too. We should pick one and book a table for the team.',
    expectation: { kind: 'none' },
  },
  {
    name: 'none-hr-policy',
    description: 'Transcript is about company HR policy — unrelated to any listed project.',
    projects: TYPICAL_PROJECTS,
    transcript:
      'HR sent the updated parental leave policy last week. Sixteen weeks fully paid, regardless of role. The new sabbatical program kicks in after five years of tenure. Compensation reviews will move to a quarterly cadence starting next quarter. Anyone with questions can reach out to people-ops.',
    expectation: { kind: 'none' },
  },
];

// ---------------------------------------------------------------------------
// Scoring helper — used by both the live and mocked accuracy tests
// ---------------------------------------------------------------------------

/**
 * Score a detection result against a fixture's expectation.
 * Returns true if the result is acceptable for that fixture.
 *
 * Rules:
 *  - 'match': result.projectId must equal expectedId AND confidence > 0.8
 *  - 'ambiguous': result.projectId is null OR is in acceptableIds (any confidence)
 *  - 'none': result.projectId is null OR confidence <= 0.5
 */
export function scoreResult(result: DetectionResult, expectation: ExpectedOutcome): boolean {
  switch (expectation.kind) {
    case 'match':
      return result.projectId === expectation.expectedId && result.confidence > 0.8;
    case 'ambiguous':
      if (result.projectId === null) return true;
      return expectation.acceptableIds.includes(result.projectId);
    case 'none':
      return result.projectId === null || result.confidence <= 0.5;
  }
}
