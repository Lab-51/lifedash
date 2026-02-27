# LifeDash Website Content Update — Agent Briefing

> **For:** The agent that owns the LifeDash website (Next.js project at `D:\PROJECTS\AI-ESSENTIALS\LIFEDASH-WEBSITE\V2\`, live at lifedash.space)
>
> **Context:** The desktop app has shipped several major features since the original WEBSITE-OVERHAUL.md was written. This document captures everything the website agent needs to know to bring the site up to date. **Read WEBSITE-OVERHAUL.md first** for the full messaging strategy and section-by-section copy — this document provides deltas and new information on top of it.
>
> **Date:** 2026-02-26

---

## What's Changed Since WEBSITE-OVERHAUL.md

The original WEBSITE-OVERHAUL.md defined the messaging strategy, 2-tier pricing, and section rewrites. Since then, all planned features are now **built and shipping**. Here's what's new:

| Change | Impact on Website |
|--------|-------------------|
| Setup wizard is built (5-step, 3 providers) | "Includes a step-by-step wizard" is now factual, not aspirational |
| Ollama auto-detection implemented | Zero-config AI is real — can make stronger claims |
| macOS support partially ready (binaries + DMG + signing) | Update platform availability |
| Licensing system fully built (LemonSqueezy) | Checkout URLs are live, trial is functional |
| 14-day Pro trial with no credit card | Trial messaging is ready to go live |
| Empty AI states show helpful guidance | UX is polished — no more cryptic error messages |
| 150 tests, Windows packaging verified | Quality/stability messaging is credible |
| Open source (GitHub: Lab-51/lifedash) | Open source badge/messaging is ready |

---

## Critical Updates to Apply

### 1. Pricing — Final Numbers (No Changes from WEBSITE-OVERHAUL.md)

| Tier | Price | Notes |
|------|-------|-------|
| **Free** | $0 forever | Full product including AI (BYOK). Not a demo. |
| **Pro Annual** | $29/year | LemonSqueezy product ID: 855065 |
| **Pro Lifetime** | $69 one-time | LemonSqueezy product ID: 855068 (was $99, now $69) |

**Checkout URLs (live):**
- Annual: `https://lifedash.lemonsqueezy.com/checkout/buy/a7c9d2dc-c9f1-4fd5-ba0c-4045e98d726c`
- Lifetime: `https://lifedash.lemonsqueezy.com/checkout/buy/9ada7049-fa58-4dae-a3cf-79c1fd3c4f7a`

**Pro features (exactly 5, all built):**
1. Card AI Agent — per-card AI assistant with tool-calling (can read card, edit checklist, update description)
2. AI Meeting to Cards — auto-convert action items to project cards
3. Billable Time Export — export focus sessions as CSV for invoicing
4. Backup & Restore — full database backup and restore
5. Data Export — export all data as JSON/CSV

**14-day Pro trial:**
- Starts automatically on first launch — no sign-up, no credit card
- Full access to all 5 Pro features during trial
- After trial: features lock gracefully (shows upgrade prompt, doesn't break anything)
- 7-day offline grace period (app works without internet for a week)

### 2. Platform Availability

**WEBSITE-OVERHAUL.md said:**
```
Windows 10+ (64-bit) · ~200MB · macOS coming 2026
```

**UPDATE TO:**
```
Windows 10+ (64-bit) · ~200MB · macOS coming soon
```

macOS support status:
- Whisper binaries: ready (darwin-x64 + darwin-arm64)
- DMG installer: configured (ULFO compression)
- Code signing: configured (conditional on Apple Developer credentials)
- What's missing: .icns icon, Apple Developer account, testing on macOS hardware
- Don't promise a specific date — "coming soon" is accurate

### 3. Setup Wizard — Now Built

The setup wizard referenced throughout WEBSITE-OVERHAUL.md is now fully implemented. Update all messaging from future tense to present tense:

**Before (aspirational):**
> "The app will include a step-by-step setup wizard..."

**After (factual):**
> "The app includes a step-by-step setup wizard that walks you through connecting AI in under 2 minutes."

**Wizard details for copy:**
- 5-step flow: Welcome → Choose Provider → Configure → Test → Done
- Three paths: Ollama (recommended, free), OpenAI, Anthropic
- Ollama path: auto-detects if Ollama is running, shows installed models, zero-config
- OpenAI/Anthropic path: step-by-step instructions with links, API key input with visibility toggle
- Connection test runs automatically after setup
- Only shows once (can be re-run from Settings)
- Skip option: "I'll do it later" — doesn't nag

### 4. Ollama Auto-Detection — Stronger Zero-Config Claims

Ollama is now truly zero-config:
- App auto-detects Ollama on launch
- Shows installed models (e.g., "llama3.2, mistral")
- If Ollama is running: one click to configure, no API key needed
- If not running: download link + setup instructions

**Messaging angle:**
```
Already have Ollama? LifeDash detects it automatically.
No account, no API key, no cost — AI just works.
```

This strengthens the "How do I connect AI?" section from WEBSITE-OVERHAUL.md. The Ollama option should be presented even more prominently now that auto-detection is real.

### 5. Feature Comparison Table — Final Version

| Feature | Free | Pro |
|---------|------|-----|
| Unlimited projects & boards | Yes | Yes |
| Drag-and-drop Kanban cards | Yes | Yes |
| Rich text editor, checklists, labels | Yes | Yes |
| Meeting recording (works with any app) | Yes | Yes |
| Real-time transcription (local Whisper) | Yes | Yes |
| Multi-language transcription (30+ languages) | Yes | Yes |
| AI meeting summaries & action items | Yes | Yes |
| AI brainstorming agent | Yes | Yes |
| AI task structuring & planning | Yes | Yes |
| AI idea analysis & feasibility scoring | Yes | Yes |
| Focus timer with Pomodoro mode | Yes | Yes |
| 30 XP tiers & 84 achievements | Yes | Yes |
| Time tracking with daily/weekly charts | Yes | Yes |
| Idea capture & organization | Yes | Yes |
| Command palette (Ctrl+K) | Yes | Yes |
| Keyboard shortcuts | Yes | Yes |
| Desktop notifications | Yes | Yes |
| Dark & light themes | Yes | Yes |
| 100% offline capable | Yes | Yes |
| BYOK AI (OpenAI, Anthropic, Ollama, Kimi) | Yes | Yes |
| Step-by-step AI setup wizard | Yes | Yes |
| **Card AI Agent** (tool-calling per card) | — | Yes |
| **Meeting → card automation** | — | Yes |
| **Billable time export** (CSV) | — | Yes |
| **Backup & restore** | — | Yes |
| **Data export** (JSON/CSV) | — | Yes |
| Price | $0 forever | $29/yr or $69 lifetime |

### 6. "How do I connect AI?" Section — Expanded

The original WEBSITE-OVERHAUL.md defined this section. Now strengthen it with concrete wizard details:

**Option A: Ollama (update)**
```
Install Ollama (free, open-source) and run AI models on your computer.
LifeDash detects Ollama automatically — no account, no API key, no cost.
The setup wizard handles everything in one click.
```

**Option B: OpenAI or Anthropic (update)**
```
Create an account, generate an API key, and paste it into LifeDash.
The built-in setup wizard shows you exactly where to go and what to click
— step-by-step, with direct links to the right pages.
Typical cost: $1-5/month for normal use.
```

**New FAQ to add:**

**Q: What happens when I first open LifeDash?**
```
A setup wizard greets you and offers to connect an AI provider.
You can set up AI in under 2 minutes, or skip and do it later.
Everything else works immediately — projects, meetings, focus timer, ideas.
```

### 7. Hero Section — Promotional Badge

**WEBSITE-OVERHAUL.md said:**
```
14-day Pro trial included — no credit card, no account
```

This is now real and should be displayed prominently. The trial auto-starts on first launch.

### 8. Quick Start Section — Updated Steps

```
1. Download the installer (Windows 10+, ~200MB)
2. Run it — a setup wizard walks you through connecting AI (or skip it)
3. Start your first project, record a meeting, or begin a focus session
```

**Platform info:**
```
Windows 10+ (64-bit) · ~200MB · macOS coming soon
14-day Pro trial included — no credit card needed
```

### 9. Open Source Messaging

The app is open source on GitHub (Lab-51/lifedash). Add:
- GitHub link in footer
- "Open source" badge near pricing
- Optional: GitHub star count widget

```
LifeDash is open source. View the code, report issues, or contribute on GitHub.
→ github.com/Lab-51/lifedash
```

### 10. Competitor Positioning — Cost Comparison (Updated)

**What LifeDash replaces:**
```
Otter.ai (meeting transcription)          $100–$200/year
Trello / Asana (project management)       $60–$120/year
Toggl / Clockify (time tracking)          $60–$120/year
Notion AI / ChatGPT (AI brainstorming)    $100–$240/year
────────────────────────────────────────────────────────
Total                                     $320–$680/year

LifeDash Free: $0 (includes AI with your own key)
LifeDash Pro:  $69 once — yours forever
```

---

## New Copy Snippets for Key Sections

### For the setup wizard promotional callout:
```
No more "how do I get an API key?" confusion.
LifeDash includes a step-by-step setup wizard that detects your AI setup
and walks you through connecting in under 2 minutes.
Ollama users? It's automatic — zero configuration needed.
```

### For the empty state messaging (what users see without AI):
```
LifeDash is fully functional without AI. When you're ready to add it,
every AI feature shows a friendly guide with a one-click path to setup.
No error messages. No dead ends. Just helpful guidance.
```

### For the Pro trial:
```
Every new install gets 14 days of Pro — free, no credit card, no account.
Try the Card AI Agent, automatic meeting-to-card conversion, billable exports,
and full backup. After 14 days, decide if you want to keep Pro or stay on Free.
Either way, you keep everything you've created.
```

### For the Pro value proposition:
```
Pro is for power users who want AI that takes action.
The Card AI Agent lives inside every card — it reads your checklists,
updates your descriptions, and helps you plan. Meeting action items
flow straight into your board. Focus sessions export as billable CSV.
And your data is always backed up and exportable.
```

---

## Technical Notes for the Website Agent

### Checkout Integration
- The checkout URLs above are live LemonSqueezy links
- They can be used directly in `<a>` tags or buttons
- LemonSqueezy handles payment, license key generation, and email delivery
- The app validates keys via LemonSqueezy's public API (no webhook needed for basic flow)

### Download Links
- Windows installer: hosted on GitHub Releases (Lab-51/lifedash)
- macOS DMG: not yet available — show "Coming soon" or waitlist
- Use the GitHub releases API or direct link format: `https://github.com/Lab-51/lifedash/releases/latest`

### SEO (from WEBSITE-OVERHAUL.md, unchanged)
```
Title: LifeDash — Meetings, Projects & Deep Work in One Desktop App
Description: Record meetings, manage projects on Kanban boards, brainstorm with AI,
and track focus time — all in one private, offline-capable desktop app.
Free forever — including AI. Open source.
```

### What NOT to Change (from WEBSITE-OVERHAUL.md)
- The visual design and HUD aesthetic (dark theme, scanlines, glows)
- Framer Motion animations and interactive elements
- The general page flow (hero → features → workflow → pricing → download)

---

## Priority Order for Website Updates

1. **Pricing section** — Final 2-tier with $69 lifetime, checkout URLs, trial badge
2. **Hero section** — New headline, sub, competitor strip, trial badge
3. **"How do I connect AI?" section** — Expanded with wizard details and Ollama auto-detect
4. **Quick Start** — Updated steps mentioning wizard, platform line
5. **Feature comparison table** — Final version with all features listed
6. **Feature modules** — Updated descriptions + Free/Pro badges
7. **Open source** — GitHub link, badge
8. **SEO meta** — Title, description, OG
9. **Footer** — Open source link, updated tagline

---

## Summary of All Deltas from WEBSITE-OVERHAUL.md

| Section | What Changed | Action |
|---------|-------------|--------|
| Pricing | No price changes; checkout URLs now live | Add live checkout links |
| Hero badge | "14-day Pro trial" is now real | Display prominently |
| AI setup section | Wizard is built, Ollama auto-detects | Strengthen copy, add FAQ |
| Quick Start | Wizard exists, mention it | Update step 2 |
| Platform | macOS closer but not ready | "Coming soon" (no date) |
| Features | All 5 Pro features built + working | Can make factual claims |
| Open source | Repo is public | Add GitHub link + badge |
| Empty states | Polished UX for no-provider case | Can claim "no dead ends" |
| Trial | 14-day auto-start, no credit card | Promote in hero + pricing |
