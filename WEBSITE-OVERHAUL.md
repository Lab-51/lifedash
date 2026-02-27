# LifeDash — Website Messaging Overhaul

> Hand this document to the website agent. It contains the complete rewritten copy, updated pricing structure, and strategic direction for every section of lifedash.space.
>
> **Context**: The website is a Next.js project at `D:\PROJECTS\AI-ESSENTIALS\LIFEDASH-WEBSITE\V2\`. The current site is live at lifedash.space. This overhaul addresses: unclear messaging for non-technical users, weak Pro value proposition, missing competitor positioning, unexplained API key requirements, and simplified 2-tier pricing.

---

## Strategic Direction

### What's Changing

| Area | Before | After |
|------|--------|-------|
| **Target audience** | Developers / technical users | Professionals broadly (developers, freelancers, managers, consultants) |
| **Free tier** | Everything including AI (BYOK) | Same — everything including AI (BYOK). This is our competitive advantage. |
| **Pro tier** | 5 features at $29/year, $99 lifetime | Same 5 features at $29/year, **$69 lifetime** (more accessible) |
| **Pro Complete tier** | N/A (was planned) | **DROPPED** — too complex for a solo project. BYOK + setup wizard instead. |
| **Tone** | Technical, system-nomenclature heavy | Professional but accessible, plain English first |
| **Jargon** | SYS.MODULES, PGlite, WASM, BYOK | Plain descriptions with tech details as secondary notes |
| **Competitor positioning** | None | Explicit "replaces X + Y + Z" framing |
| **API key explanation** | "BYOK AI" with no explanation | Clear section explaining what API keys are + Ollama as zero-setup option |

### Key Strategic Decision: AI Features Stay Free

The free tier includes ALL AI features (brainstorming, meeting summaries, task structuring, idea analysis) when users connect their own API key. This is intentional:

- **Maximum adoption** — Everyone gets the full experience. More users = more community = more recognition.
- **The free tier IS the product.** It's not a demo. It's not crippled. It's genuinely useful.
- **Pro is for power users + supporters** — Card AI Agent (tool-calling), backup/restore, exports. People who love the tool pay to support it AND get extras.
- **BYOK keeps costs at zero** — Users bring their own API keys, so AI features cost us nothing to offer for free.

### Core Messaging Principles

1. **Lead with the outcome, not the technology.** "Record a meeting and get a summary in 60 seconds" beats "Whisper AI transcription with WASM PostgreSQL storage."
2. **Two audiences, one page.** Non-technical users read headlines and CTAs. Technical users read the details. Structure copy so both work.
3. **The generosity IS the selling point.** "Yes, AI features are free. We mean it." This differentiates LifeDash from everything else.
4. **Eliminate every acronym on first encounter.** If you must use a technical term, define it inline in parentheses.
5. **Explain API keys simply.** Most people have never generated one. Offer Ollama as the zero-cost, zero-account alternative.

---

## Section-by-Section Rewrite

### Navigation

**Current:** `>FEATURES` `>WORKFLOW` `>PRICING` `>PRIVACY`

**New:** `Features` `How It Works` `Pricing` `Privacy` `Download`

Drop the `>` prefix and SYS nomenclature from navigation. Keep it clean and standard.

---

### Hero Section

**Current headline:** "LIFEDASH — YOUR AI-POWERED DESKTOP COMMAND CENTER"
**Current sub:** "Free to start. Pro when you're ready."
**Current tagline:** "NO CLOUD · NO SUBSCRIPTION · NO COMPROMISE"

**New headline:**
```
One app for meetings, projects, and deep work.
AI does the rest.
```

**New subheadline:**
```
LifeDash records your meetings, transcribes them instantly, manages your projects
on a drag-and-drop board, and uses AI to turn conversations into action items.
All on your desktop. All private. No cloud required.
```

**New tagline strip:**
```
REPLACES: Otter.ai + Trello + Toggl + Notion AI — in a single desktop app
```

**CTAs:**
- Primary: `Download Free` (keep)
- Secondary: `See Pricing` (link to #pricing)

**New promotional badge:**
```
14-day Pro trial included — no credit card, no account
```

**Rationale:** The current headline is abstract ("command center"). The new one is concrete — meetings, projects, deep work. A non-technical user immediately understands what it does. The "replaces X + Y + Z" strip is the missing competitor positioning.

---

### Features Section

**Current section title:** "SYS.MODULES" / "REPLACE YOUR WHOLE STACK"

**New section title:**
```
Everything you need. Nothing you don't.
```

**New section subtitle:**
```
Six tools that work together so you don't have to switch between apps.
All included in the free tier. Yes, including AI.
```

#### Module 01: Meeting Recording & Transcription

**Current title:** "Record. Transcribe. Act." (keep — it's good)

**New description:**
```
Hit record during any meeting — Zoom, Teams, Google Meet, or any other app.
LifeDash captures the audio directly from your computer, transcribes it in
real-time using AI that runs on your machine, and saves everything locally.

No cloud uploads. No third-party recording bots joining your calls.
```

**Tags:** Replace `WHISPER AI, AUDIO CAPTURE, REAL-TIME` with `Works with any meeting app · Real-time transcript · 100% local`

**Feature highlight badge:**
```
FREE: Record, transcribe, get AI summaries & action items
PRO: Auto-convert action items to project cards
```

#### Module 02: Project Dashboard

**Current title:** "Project Dashboard"

**New title:** `Kanban boards that actually help you ship`

**New description:**
```
Organize any project with drag-and-drop cards on a visual board.
Create custom columns, set priorities, add checklists, and track progress —
like Trello, but built into the same app as your meetings and focus sessions.
```

**Tags:** `Drag-and-drop · Custom columns · Rich text editor · Labels & priorities`

**Feature highlight badge:**
```
FREE: Unlimited projects, boards, and cards
PRO: AI agent lives inside every card — chat, plan, and execute
```

#### Module 03: AI Brainstorming

**Current title:** "AI Brainstorming Agent"

**New title:** `Think out loud with AI`

**New description:**
```
Open a conversation with AI that already knows about your projects,
cards, and meeting transcripts. Brainstorm ideas, explore solutions,
or plan your next feature — then push the best outcomes straight
to your board.
```

**Tags:** `Context-aware · Knows your projects · Export to cards`

**Feature highlight badge:**
```
FREE: Full AI brainstorming with your own API key
```

#### Module 04: Task Structuring

**Current title:** "Task Structuring Engine"

**New title:** `AI breaks down your goals into steps`

**New description:**
```
Describe what you want to build and AI generates a structured plan:
milestones, subtasks, and considerations for scalability and security.
Perfect for kicking off a new project without staring at a blank board.
```

**Tags:** `AI-powered planning · Production-focused · One-click to board`

**Feature highlight badge:**
```
FREE: AI task structuring with your own API key
```

#### Module 05: Idea Repository

**Current title:** "Idea Repository" (keep — clear enough)

**New description:**
```
Capture ideas the moment they hit — from the keyboard shortcut (Ctrl+K),
the sidebar, or the Ideas page. Tag them, rate their feasibility with AI,
and when one's ready, convert it into a project or a card in one click.
```

**Tags:** `Quick capture · AI feasibility scoring · Convert to project`

**Feature highlight badge:**
```
FREE: Capture, organize, tag, and AI-analyze ideas
```

#### Module 06: Focus Time Tracking

**Current title:** "Privacy & Offline-First"

**CHANGE THIS MODULE.** The current Module 06 is about privacy (covered in its own section). Replace with Focus Time Tracking, which is a major feature that deserves showcase space.

**New title:** `Deep work, gamified`

**New description:**
```
Start a focus session, link it to a card, and enter a full-screen timer
that blocks distractions. Earn XP, level up through 30 tiers, and unlock
84 achievements as you build your focus habit. Track your time with
daily charts and export reports for billing.
```

**Tags:** `Pomodoro timer · 84 achievements · Time reports · Billable export`

**Feature highlight badge:**
```
FREE: Focus sessions, XP, achievements, time tracking
PRO: Export billable time reports as CSV
```

---

### How It Works Section

**Current title:** "SYS.WORKFLOW" / "A SINGLE WORKFLOW"

**New title:**
```
Three steps. That's it.
```

**Steps (simplified, outcome-focused):**

**Step 1: Capture**
```
Record a meeting, start a focus session, or jot down an idea.
LifeDash captures everything in one place.
```

**Step 2: AI Processes**
```
AI transcribes your meeting, writes a summary, extracts action items,
and suggests which project board they belong on.
```

**Step 3: Execute**
```
Review the AI suggestions, drag cards to the right columns,
and get to work — with full context from the meeting attached.
```

---

### Privacy Section

**Current title:** "SYS.SECURITY" / "YOUR DATA STAYS YOURS"

**New title:**
```
Your data never leaves your computer.
```

**New subtitle:**
```
LifeDash runs entirely on your desktop. There's no cloud database,
no account to create, and no data syncing to anyone's servers.
```

**Three pillars (rewritten for clarity):**

**1. Your own database**
```
LifeDash stores everything in an embedded database right on your machine.
No cloud servers, no Docker, no external services to manage or pay for.
(Technical detail: PGlite — PostgreSQL compiled to run inside the app via WebAssembly.)
```

**2. Local transcription**
```
Meeting transcription runs directly on your computer using the Whisper AI model.
Your audio never gets uploaded anywhere. Zero network calls. Complete privacy.
```

**3. Encrypted secrets**
```
If you connect an AI provider, your API key is encrypted at the operating system level
and stored locally. We never see it, and it never leaves your machine.
```

---

### NEW SECTION: "How do I connect AI?"

**This section does not exist on the current site. ADD IT.** Place it between Privacy and Pricing, or as a subsection within Pricing.

**Title:**
```
Connecting AI is easy — and optional.
```

**Intro:**
```
LifeDash's AI features work with your own AI account. You choose the provider,
the model, and how much you spend. Here are three ways to get started:
```

**Option A: Ollama — free, local, no account needed (easiest)**
```
Install Ollama (free, open-source) and run AI models directly on your computer.
No account, no API key, no cost. Works completely offline.
Great for: anyone who wants AI without paying for a subscription.
```

**Option B: OpenAI or Anthropic — cloud AI with an API key**
```
Create an account at OpenAI or Anthropic, generate an API key, and paste it
into LifeDash settings. You'll pay the AI provider directly (typically $1-5/month
for normal use). LifeDash includes a step-by-step setup wizard.
Great for: users who want the best AI models (GPT-4o, Claude).
```

**Option C: Skip AI entirely**
```
LifeDash is fully functional without AI. Projects, boards, meeting recording,
transcription, focus tracking, and ideas all work perfectly on their own.
You can always connect AI later.
```

**Expandable FAQ within this section:**

**Q: What is an API key?**
```
An API key is like a password that lets LifeDash talk to an AI service
(like OpenAI or Anthropic) on your behalf. You create one on the provider's
website, paste it into LifeDash settings, and you're done.
The app includes a step-by-step guide that walks you through it.
```

**Q: How much does AI cost?**
```
That depends on the provider and how much you use it:
- Ollama: Free (runs locally on your computer)
- OpenAI (GPT-4o-mini): ~$1-3/month for typical use
- Anthropic (Claude Haiku): ~$1-3/month for typical use
- OpenAI (GPT-4o) or Anthropic (Claude Sonnet): ~$5-15/month for heavy use
You control which model is used for each feature in Settings.
```

**Q: Can I switch providers later?**
```
Yes. You can add multiple AI providers, switch between them, or change
which model handles each feature (transcription, brainstorming, etc.)
at any time in Settings.
```

---

### Pricing Section

**Current title:** "SYS.PRICING" / "ONE PRODUCT. THREE OPTIONS."

**New title:**
```
Simple pricing. Generous free tier.
```

**New subtitle:**
```
The free tier is the full product — unlimited projects, meetings, AI, everything.
Pro adds advanced automation and data portability for power users.
```

#### Tier 1: Free

**Label:** `FREE FOREVER`
**Price:** `$0`
**Subheading:** `The full product — not a demo, not a trial`

**Description:**
```
Everything you need to manage projects, record meetings, brainstorm with AI,
track focus time, and capture ideas. No limits on usage, projects, or data.
Connect your own AI provider for summaries, brainstorming, and more.
```

**Feature list:**
```
- Unlimited projects & boards
- Drag-and-drop Kanban cards
- Meeting recording & real-time transcription
- AI meeting summaries & action items
- AI brainstorming agent
- AI task structuring & planning
- AI idea analysis
- Focus timer with XP & 84 achievements
- Idea capture & organization
- Command palette (Ctrl+K)
- Keyboard shortcuts
- Desktop notifications
- Dark & light themes
- 100% offline capable
- BYOK AI (OpenAI, Anthropic, Ollama, Kimi)
```

**CTA:** `Download Free`

**Note below CTA:**
```
AI features require connecting your own provider (OpenAI, Anthropic, or Ollama).
A step-by-step setup wizard is included.
```

#### Tier 2: Pro

**Label:** `FOR POWER USERS`
**Price:** `$29/year` or `$69 one-time`
**Badge:** `BEST VALUE` on the lifetime option

**Subheading:** `Advanced automation + data portability`

**Description:**
```
Everything in Free, plus the Card AI Agent, automatic meeting-to-card
conversion, billable time exports, and full backup & restore.
For professionals who want the ultimate productivity toolkit.
```

**Feature list (everything in Free, plus):**
```
+ Card AI Agent — per-card assistant with tool-calling
+ AI Meeting → Cards automation
+ Billable time export (CSV)
+ Full database backup & restore
+ Data export (JSON/CSV)
```

**CTA:** `Get Pro — $29/year`
**Secondary CTA:** `Or $69 once — yours forever`

**Below CTA:**
```
Cancel anytime. Stop paying? You keep every Pro feature you had
on the version you're using. We don't hold your tools hostage.
```

### Pricing — Additional Elements

#### "Replaces $300+/year in tools" comparison (KEEP but update)

**Updated comparison table:**

| Year | Pro Annual | Pro Lifetime | Typical SaaS Stack |
|------|-----------|-------------|-------------------|
| 1 | $29 | $69 | $280–$350 |
| 2 | $58 | $69 | $560–$700 |
| 3 | $87 | $69 | $840–$1,050 |

**Savings callout:**
```
YOU SAVE UP TO $980+ OVER 3 YEARS WITH LIFETIME
```

**What it replaces:**
```
Otter.ai (meeting transcription)          $100–$200/year
Trello / Asana (project management)       $60–$120/year
Toggl / Clockify (time tracking)          $60–$120/year
Notion AI / ChatGPT (AI brainstorming)    $100–$240/year
────────────────────────────────────────────────────────
Total                                     $320–$680/year

LifeDash: $0 (free) or $69 once (forever).
```

#### Feature comparison table (2 tiers)

| Feature | Free | Pro |
|---------|------|-----|
| Unlimited projects & boards | Yes | Yes |
| Meeting recording & transcription | Yes | Yes |
| AI meeting summaries & action items | Yes | Yes |
| AI brainstorming agent | Yes | Yes |
| AI task structuring | Yes | Yes |
| AI idea analysis | Yes | Yes |
| Focus timer & achievements | Yes | Yes |
| Idea capture & organization | Yes | Yes |
| Command palette & shortcuts | Yes | Yes |
| BYOK AI (all providers) | Yes | Yes |
| Card AI Agent (tool-calling) | — | Yes |
| Meeting → card automation | — | Yes |
| Billable time export | — | Yes |
| Backup & restore | — | Yes |
| Data export | — | Yes |
| Price | $0 forever | $29/yr or $69 lifetime |

#### Open source note
```
LifeDash is open source. View the code, report issues, or contribute on GitHub.
```

---

### Quick Start Section

**Current title:** "SYS.INIT" / "QUICK START"

**New title:**
```
Up and running in 60 seconds.
```

**Content:**
```
1. Download the installer (Windows 10+, ~200MB)
2. Run it — no accounts, no sign-ups, no cloud credentials
3. Start your first project or record your first meeting

Want AI features? The app includes a setup wizard that walks you through
connecting OpenAI, Anthropic, or Ollama in under 2 minutes.
```

**Platform info:**
```
Windows 10+ (64-bit) · ~200MB · macOS coming 2026
```

---

### CTA / Download Section

**Current title:** "SYS.DEPLOY" / "READY TO UNIFY YOUR WORKFLOW?"

**New title:**
```
Stop switching between apps.
```

**New subtitle:**
```
Download LifeDash and put meetings, projects, and deep work in one place.
Free forever — including AI. No catch.
```

**CTAs:**
- Primary: `Download for Windows`
- Secondary: `See Pricing`

---

### Footer

**Keep current structure.** Update tagline:

**Current:** "BUILT WITH CARE FOR PROFESSIONALS WHO SHIP."
**New:** `Built for professionals who ship.`

Add: `Open source on GitHub` link

---

## LemonSqueezy Product Updates

Only one change needed in LemonSqueezy:

| Product | Current | New | Action |
|---------|---------|-----|--------|
| LifeDash Pro Annual (ID 855065) | $29/year | $29/year | **NO CHANGE** |
| LifeDash Pro Lifetime (ID 855068) | $99 one-time | $69 one-time | **UPDATE PRICE** |

After updating the lifetime price in LemonSqueezy:
- Update the Electron app's `UpgradePrompt.tsx` line 143: change `$99` to `$69` in display text
- Checkout URLs stay the same (LemonSqueezy handles the price change server-side)

---

## SEO Updates

**New page title:**
```
LifeDash — Meetings, Projects & Deep Work in One Desktop App
```

**New meta description:**
```
Record meetings, manage projects on Kanban boards, brainstorm with AI,
and track focus time — all in one private, offline-capable desktop app.
Free forever — including AI. Open source.
```

**New OG image text:**
```
One app for meetings, projects, and deep work. AI does the rest.
```

---

## Tone Guidelines (Updated)

**Before:** Developer-first, technical pride, system nomenclature
**After:** Professional but human, accessible first, technical depth available

| Do | Don't |
|----|-------|
| "Your database lives on your machine" | "PGlite WASM PostgreSQL embedded" |
| "AI transcribes your meeting in real-time" | "Whisper AI local inference pipeline" |
| "Connect your own AI account" | "BYOK AI multi-provider adapter" |
| "No cloud, no accounts, no fuss" | "AIRGAPPED MODE CAPABLE" |
| "Step-by-step guide in the app" | (assume they know what an API key is) |

**When to use technical terms:** In parenthetical notes, expandable sections, or a dedicated "For Developers" subsection. Never in headlines or primary descriptions.

**The SYS.MODULE / MODULE 01-06 naming:** Remove from the marketing website entirely. It's a great aesthetic inside the app's HUD design system but it alienates non-technical visitors on the marketing site. The website should feel approachable; the app itself can feel like a command center.

---

## Implementation Notes for the Website Agent

### Priority Order
1. **Pricing section** — Simplified 2-tier structure (this drives everything else)
2. **Hero section** — New headline, sub, competitor positioning strip
3. **New "How do I connect AI?" section** — Critical for non-technical users
4. **Feature module rewrites** — Updated descriptions and Free/Pro badges
5. **How It Works + Quick Start** — Minor rewrites
6. **Privacy section** — Tone simplification
7. **SEO meta tags** — Title, description, OG image

### What to Keep
- The overall visual design and HUD aesthetic (dark theme, scanlines, glows)
- The comparison table / savings breakdown (update numbers for 2 tiers)
- The feature comparison table (simplify to 2 columns)
- Framer Motion animations and interactive elements
- The general page flow (hero → features → workflow → pricing → download)

### What to Remove
- `SYS.MODULES`, `SYS.WORKFLOW`, `SYS.PRICING`, `SYS.INIT`, `SYS.DEPLOY`, `SYS.SECURITY` section labels
- `MODULE 01` through `MODULE 06` numbering
- `>` prefix on navigation items
- `BYOK AI` as an unexplained feature bullet (replace with plain English)
- Any reference to `PGlite`, `WASM`, or `CRDT` in primary copy (move to parenthetical notes)
- The current Module 06 (Privacy & Offline) — privacy has its own section; replace module 06 with Focus Time Tracking

### What to Add
- Competitor positioning strip under hero (`Replaces: Otter.ai + Trello + Toggl + Notion AI`)
- "How do I connect AI?" section with FAQ accordion
- Free/Pro badges on each feature module showing what's included
- Social proof placeholder section (GitHub stars, user count — even if empty initially with `<!-- TODO: Add social proof -->`)
- Open source badge/link in footer and pricing section

---

## Summary of All Changes

| Section | Change Type | Effort |
|---------|------------|--------|
| Navigation | Minor rename | Low |
| Hero | Full rewrite | Medium |
| Features (6 modules) | Rewrite descriptions + add badges | Medium |
| How It Works | Light rewrite | Low |
| NEW: AI Connection Guide | New section | Medium |
| Privacy | Tone simplification | Low |
| Pricing | Simplify to 2 tiers, update lifetime price | Medium |
| Feature Comparison Table | Simplify to 2 columns | Low |
| Cost Comparison | Update numbers | Low |
| Quick Start | Light rewrite | Low |
| CTA / Download | Light rewrite | Low |
| Footer | Add open source link | Low |
| SEO Meta | Update | Low |
