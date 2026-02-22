# LifeDash — Website Creation Prompt

> Use this prompt to build a marketing/landing website for LifeDash, an AI-powered desktop dashboard for professionals.

---

## 1. Project Brief

Build a modern, high-converting landing page website for **LifeDash** — an Electron desktop application that unifies meeting intelligence, project management, AI brainstorming, focus time tracking, and idea management into a single tool.

The website's goal is to:
- Clearly communicate what LifeDash does and who it's for
- Showcase the app's key features with visuals
- Drive downloads (Windows installer, macOS coming soon)
- Establish credibility as a polished, privacy-first professional tool

---

## 2. Brand Identity

### Name & Tagline
- **Name:** LifeDash
- **Tagline options** (pick or refine):
  - "Your AI-powered command center for work"
  - "One dashboard. Every workflow. AI-enhanced."
  - "Stop switching tools. Start shipping work."
  - "The living dashboard for professionals"

### Logo
- A squircle icon with an ECG/heartbeat pulse line in a cyan-to-blue gradient, representing a "living" dashboard that adapts and responds
- Wordmark: "**Life**Dash" — "Life" in bold white, "Dash" in muted slate gray, Inter font, tight letter-spacing
- SVG assets available at `/src/renderer/assets/logo.svg` and `/src/renderer/assets/icon.svg`

### Color Palette

| Role | Light Mode | Dark Mode | Hex |
|------|-----------|-----------|-----|
| Background | White / Slate-50 | Slate-950 | `#ffffff` / `#f8fafc` / `#020617` |
| Surface (cards) | White | Slate-900 | `#ffffff` / `#0f172a` |
| Primary accent | Indigo-600 | Indigo-400 | `#4f46e5` / `#818cf8` |
| Secondary accent | Blue-500 | Blue-400 | `#3b82f6` / `#60a5fa` |
| Text primary | Slate-900 | Slate-50 | `#0f172a` / `#f8fafc` |
| Text secondary | Slate-500 | Slate-400 | `#64748b` / `#94a3b8` |
| Success / Focus | Emerald-500 | Emerald-400 | `#10b981` / `#34d399` |
| Warning / Ideas | Amber-500 | Amber-400 | `#f59e0b` / `#fbbf24` |
| Recording / Live | Rose-500 | Rose-400 | `#f43f5e` / `#fb7185` |
| AI / Brainstorm | Indigo→Purple gradient | Same | `#6366f1` → `#a855f7` |

### Typography
- **Font:** Inter (Variable) — same as the app
- **Headings:** `font-light tracking-tight` for hero, `font-semibold` for section titles
- **Body:** `font-normal` 16-18px, generous line-height (1.6-1.75)

### Visual Style
- Dark-first design (hero and primary sections on dark background), with light sections for contrast
- `rounded-2xl` cards with subtle shadows (`shadow-sm`, `shadow-lg` on hover)
- Generous whitespace — `p-8` to `p-16` section padding
- Subtle glassmorphism effects where appropriate (backdrop-blur, semi-transparent borders)
- Smooth scroll animations on section entry (fade-in + slide-up)

---

## 3. Website Structure

### 3.1 Hero Section

**Layout:** Full-viewport dark section (`bg-slate-950`) with centered content.

**Content:**
- LifeDash logo (icon + wordmark) top-center or top-left
- **Headline (large, `text-5xl` to `text-7xl`, `font-light tracking-tight`):**
  "Your AI-powered command center for work"
- **Subheadline (`text-xl text-slate-400`):**
  "LifeDash unifies meeting transcription, project management, AI brainstorming, and focus tracking into one desktop app — so you can stop context-switching and start shipping."
- **CTA buttons:**
  - Primary: "Download for Windows" (indigo-600 bg, white text, download icon)
  - Secondary: "Watch Demo" or "See Features" (outline/ghost button)
- **Hero visual:** Large screenshot or animated mockup of the LifeDash dashboard (dark mode), slightly angled with a subtle reflection/glow. The dashboard should show the Home page with the ECG heartbeat animation, quick action buttons, stats cards, and productivity heatmap.

**Background effects:**
- Subtle gradient mesh or radial glow behind the screenshot (indigo/cyan tones)
- Optional: animated particles or a faint ECG pulse line running across the background

---

### 3.2 Social Proof / Stats Bar

A slim horizontal strip with key metrics:
- "6 Core Systems" | "84 Achievements" | "150+ Tests" | "100% Offline Capable"
- Or: feature count badges showing the breadth of the tool

---

### 3.3 Feature Sections

Each feature gets a dedicated section with alternating layout (text-left/image-right, then text-right/image-left). Use app screenshots or component mockups.

#### Feature 1: Meeting Intelligence
- **Icon:** Mic (rose-500)
- **Title:** "Record. Transcribe. Act."
- **Description:** "Capture system audio from any meeting app, get real-time transcription powered by local Whisper AI or cloud providers, and let AI generate briefs with actionable items — all without leaving your dashboard."
- **Key points:**
  - Real-time transcription (local Whisper or Deepgram/AssemblyAI)
  - AI-generated meeting briefs and summaries
  - Automatic action item extraction
  - One-click conversion to project cards
  - Speaker diarization support
  - Meeting prep assistant with project context
  - Configurable transcription language (English, Czech, auto-detect)
- **Visual:** Screenshot of the Meetings page showing a recording in progress with live transcript, or the meeting detail view with brief + action items

#### Feature 2: Project Dashboard
- **Icon:** FolderKanban (indigo-500)
- **Title:** "Kanban boards that think with you"
- **Description:** "Manage multiple projects with beautiful drag-and-drop boards. AI generates card descriptions, breaks down tasks, and an agent lives inside every card to help you plan and execute."
- **Key points:**
  - Multi-project Kanban boards with customizable columns
  - Drag-and-drop with smooth physics-based animations
  - Rich text editor (TipTap) for card descriptions
  - AI card agent — chat with AI about any card (7 built-in tools)
  - Card checklists/subtasks with progress tracking
  - Recurring cards (daily/weekly/monthly auto-spawn)
  - Card templates (built-in + custom)
  - Labels, priorities, due dates, relationships
  - CSV export
- **Visual:** Screenshot of a Kanban board with cards in different columns, showing the card detail modal with the AI agent chat panel

#### Feature 3: AI Brainstorming
- **Icon:** Brain (purple-500)
- **Title:** "Your AI thinking partner"
- **Description:** "Open a brainstorm session, pick a starter prompt or type your own, and have a focused conversation with AI that knows about your projects, cards, and meetings. Export outcomes directly into your workflow."
- **Key points:**
  - Conversational AI interface with streaming responses
  - Context-aware — inject project data, cards, meeting transcripts
  - Session management with history
  - Starter prompts for common brainstorming patterns
  - Export brainstorm outcomes as cards or ideas
  - Markdown rendering with code blocks
  - Works with OpenAI, Anthropic, Ollama, or Kimi
- **Visual:** Screenshot of the brainstorm split-panel interface with a conversation in progress

#### Feature 4: Focus Time Tracking
- **Icon:** Clock (emerald-500)
- **Title:** "Deep work, gamified"
- **Description:** "Start a Pomodoro-style focus session, link it to a card, and enter an immersive full-screen overlay. Earn XP, unlock 84 achievements, and track your productivity with detailed time reports."
- **Key points:**
  - Immersive full-screen focus overlay with breathing gradient
  - Circular SVG progress ring with monospace countdown
  - Customizable work/break durations
  - Link focus sessions to specific cards
  - XP system with 300 levels across 30 named tiers
  - 84 achievements across 7 categories
  - Achievement banners with particle effects
  - Focus time tracking page with period stats, project breakdowns, daily charts
  - CSV export of session history
- **Visual:** Screenshot of the focus overlay (dark, with the emerald circular progress ring and countdown), or the focus time tracking page with charts

#### Feature 5: Idea Repository
- **Icon:** Lightbulb (amber-500)
- **Title:** "Capture every idea. Lose nothing."
- **Description:** "Quick-capture ideas from anywhere — the command palette, the sidebar, or the dedicated Ideas page. Tag, categorize, analyze feasibility with AI, and convert the best ideas into projects or feature cards."
- **Key points:**
  - Quick-add from command palette (`Ctrl+K`) or dedicated page
  - Masonry card layout with status tracking (New → Exploring → Active → Archived)
  - AI-assisted idea analysis (feasibility, effort, impact scoring)
  - Convert idea → new project or feature card
  - Tags and categorization
- **Visual:** Screenshot of the Ideas page in masonry layout

#### Feature 6: Command Center
- **Icon:** Search (blue-500)
- **Title:** "Everything, one keystroke away"
- **Description:** "Press `Ctrl+K` to search across every project, card, meeting, idea, and transcript. Create cards, capture ideas, or start a brainstorm without leaving the keyboard."
- **Key points:**
  - Universal search across all entities
  - Full-text transcript search
  - Quick capture (create idea, create card, start brainstorm)
  - Keyboard-first navigation (`Ctrl+1-7` for pages)
  - Keyboard shortcuts overlay
- **Visual:** Screenshot of the command palette open with search results

---

### 3.4 "How It Works" Section

A 3-step visual flow:

1. **Record** — "Start a meeting recording or focus session"
2. **AI Processes** — "AI transcribes, summarizes, and suggests actions"
3. **Act** — "Review suggestions, push to your board, and ship"

Use icons or simple illustrations connected by animated arrows/lines.

---

### 3.5 Privacy & Architecture Section

**Title:** "Your data stays yours"
**Description:** "LifeDash runs entirely on your desktop. Your database is embedded (PGlite — PostgreSQL in WebAssembly), transcription can run locally via Whisper, and no data ever leaves your machine unless you choose a cloud AI provider."

**Key points (icon + text cards):**
- **Embedded Database** — PGlite (WASM PostgreSQL). No Docker. No server. No cloud dependency.
- **Local Transcription** — Whisper runs natively on your machine. Zero network calls.
- **Encrypted API Keys** — Stored with Electron safeStorage (OS-level encryption).
- **Your Choice of AI** — Use OpenAI, Anthropic, Ollama (fully local), Kimi, Deepgram, or AssemblyAI.
- **Offline Capable** — With local Whisper + Ollama, everything works without internet.
- **Fully Standalone** — Single installer. No Docker, no databases to manage, no accounts to create.

---

### 3.6 Tech Stack / "Built With" Section (Optional — for developer audience)

A horizontal strip or grid showing tech logos:
- Electron | React 19 | TypeScript | Tailwind CSS 4
- PGlite (PostgreSQL) | Drizzle ORM | Vercel AI SDK
- Whisper | TipTap | Zustand

---

### 3.7 Gamification Showcase Section (Optional — adds delight)

**Title:** "Level up your productivity"

Show the achievement system: tier badges (Metal → Gem → Cosmic → Mythic → Divine → Ultimate), the 84 achievements grid, and the XP/level progress bar. This differentiates LifeDash from boring productivity tools.

---

### 3.8 Download / CTA Section

**Title:** "Ready to unify your workflow?"
**CTA:**
- Primary: "Download for Windows" (with Windows icon + file size)
- Secondary: "View on GitHub" (if open source) or "Join Waitlist for macOS"
- Tertiary: "Read the Docs"

Include system requirements:
- Windows 10+ (64-bit)
- macOS support coming soon
- ~200MB installed size
- No Docker or external services required

---

### 3.9 Footer

- LifeDash logo (small)
- Links: Features | Download | GitHub | Privacy | License
- Copyright notice
- "Built with care for professionals who ship"

---

## 4. Technical Requirements

### Stack Recommendation
- **Framework:** Next.js 15 (App Router) or Astro 5 — static-first, fast
- **Styling:** Tailwind CSS 4 (matching the app's design system)
- **Animations:** Framer Motion or CSS animations for scroll-triggered reveals
- **Font:** Inter Variable (self-hosted via `@fontsource-variable/inter`)
- **Hosting:** Vercel, Netlify, or GitHub Pages (static export)
- **Analytics:** Plausible or PostHog (privacy-friendly)

### Performance Goals
- Lighthouse score: 95+ across all categories
- First Contentful Paint < 1.5s
- Total page weight < 2MB (excluding screenshots)
- No layout shift (CLS = 0)

### Responsive Design
- Mobile-first, but desktop is the primary audience
- Breakpoints: `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px)
- Hero screenshot scales down gracefully; feature sections stack on mobile
- Sticky mobile header with hamburger menu

### SEO
- Title: "LifeDash — AI-Powered Desktop Dashboard for Professionals"
- Meta description: "Unify meeting transcription, project management, AI brainstorming, and focus tracking in one desktop app. Privacy-first, offline-capable, powered by AI."
- OpenGraph image: Dark hero screenshot with logo overlay
- Structured data (SoftwareApplication schema)
- Sitemap.xml

### Accessibility
- WCAG 2.1 AA compliance
- All images have alt text
- Keyboard navigable
- Sufficient color contrast (especially on dark backgrounds)
- Reduced motion support (`prefers-reduced-motion`)

---

## 5. Content Assets Needed

| Asset | Source | Notes |
|-------|--------|-------|
| App icon (SVG) | `/src/renderer/assets/icon.svg` | 100x100 squircle with ECG pulse |
| Logo (SVG) | `/src/renderer/assets/logo.svg` | Horizontal wordmark |
| App screenshots | Take from running app | Dark mode preferred. Home, Board, Meeting, Brainstorm, Focus, Ideas pages |
| Focus overlay screenshot | Take from running app | Full-screen with circular progress ring |
| Achievement banner screenshot | Take from running app | Particle burst animation frame |
| OG image | Create from hero section | 1200x630 dark background with logo + tagline |
| Favicon | `/src/assets/icon.ico` | Multi-size ICO |
| Windows installer | Build output | `.exe` Squirrel installer from `npm run make` |

---

## 6. Full Feature List (for a features page or comparison table)

### Meeting Intelligence
- System audio capture (WASAPI/CoreAudio)
- Real-time local transcription (Whisper — tiny/base/small/medium models)
- Cloud transcription (Deepgram real-time streaming, AssemblyAI)
- Speaker diarization
- AI meeting briefs and summaries
- Automatic action item extraction
- One-click action → card conversion
- Bulk push approved actions to project board
- Meeting prep assistant (pre-meeting project briefing)
- Meeting templates (standup, retro, planning, etc.)
- Full-text transcript search
- Meeting export as Markdown
- Configurable transcription language
- Per-recording language storage
- Audio source selection
- Silence detection
- Recording save folder customization

### Project Management
- Multi-project support (create, archive, pin/star, duplicate, rename, delete)
- Kanban boards with drag-and-drop (pragmatic-drag-and-drop)
- Customizable columns (add, rename, reorder, delete)
- Card CRUD with rich text descriptions (TipTap)
- Card priorities (Low, Medium, High, Urgent) with colored indicators
- Card labels/tags with color picker
- Card checklists/subtasks with progress bars
- Card due dates
- Card relationships (blocks, depends on, related to)
- Card comments and activity log
- Card templates (built-in + custom saved from cards)
- Recurring cards (daily/weekly/bi-weekly/monthly)
- AI card description generation
- AI task breakdown (subtask suggestions)
- Card agent — per-card AI chat with 7 tools
- Card search and filtering (text, priority, labels)
- Board CSV export
- Undo card deletion (5-second toast)

### AI System
- Multi-provider: OpenAI, Anthropic (Claude), Ollama (local), Kimi
- Per-task model assignment (transcription, summarization, brainstorming, card agent, etc.)
- Secure API key storage (Electron safeStorage — OS-level encryption)
- Provider connectivity testing
- Token usage tracking with 30-day visual dashboard
- Cost estimation by model and task type
- AI standup generation (project-scoped or global)

### Focus & Productivity
- Pomodoro-style focus timer with customizable durations
- Immersive full-screen overlay with circular progress ring
- Breathing radial gradient background animation
- Link focus sessions to specific cards
- Session notes and accomplishments logging
- Focus time tracking page with period stats
- Project-level time breakdowns
- Daily activity bar charts
- Session edit and delete with undo
- CSV export of focus history
- XP system with 300 levels and 30 named tiers
- 84 achievements across 7 categories
- Achievement banners with particle effects
- Activity streak tracking

### Ideas
- Quick-capture from command palette or dedicated page
- Masonry card layout
- Status workflow (New → Exploring → Active → Archived)
- Tags and categorization
- AI feasibility/effort/impact analysis
- Convert idea → project or feature card

### Brainstorming
- Conversational AI interface with streaming
- Context injection (projects, cards, meetings)
- Session management with history
- Starter prompts
- Export outcomes as cards or ideas
- Stop generation mid-stream
- Markdown rendering

### General
- Custom frameless window with title bar
- System tray integration (minimize to tray)
- Always-on-top toggle
- Light/dark/system theme modes
- Command palette (`Ctrl+K`) with universal search
- Full-text transcript search from command palette
- Keyboard shortcuts for all major actions
- Desktop notifications
- Database backup and restore
- Data export (CSV, Markdown)
- Splash screen with smooth fade transition
- Window state persistence (size, position)

---

## 7. Tone & Voice Guidelines

- **Professional but approachable** — not corporate, not casual
- **Confident without being arrogant** — "LifeDash does X" not "LifeDash is the best X"
- **Developer-friendly** — don't shy away from technical details (PGlite, Whisper, WASM)
- **Privacy-forward** — emphasize local-first, user-controlled data
- **Action-oriented** — verbs over nouns ("Record meetings" not "Meeting recording capabilities")
- **Concise** — every sentence earns its place. No filler, no marketing fluff.

---

## 8. Competitor Positioning

LifeDash is NOT:
- A web app (it's desktop-native for audio access and privacy)
- A team collaboration tool (it's a personal productivity tool)
- A SaaS with subscriptions (it's a one-time download, bring your own API keys)
- A replacement for Zoom/Teams (it captures audio from ANY app)

LifeDash IS:
- The single tool that replaces your meeting recorder + Trello + brainstorming app + pomodoro timer + idea notebook
- Privacy-first with embedded database and optional local AI
- Keyboard-driven and fast
- Gamified to make productivity genuinely engaging
- AI-enhanced at every layer — not AI-gimmicky

---

## 9. Inspiration & References

Websites to study for design and structure:
- **Linear.app** — clean dark hero, feature sections with screenshots, minimal
- **Arc.net** — bold hero, personality-driven, unique visual style
- **Raycast.com** — keyboard-first tool, developer audience, dark aesthetic
- **Obsidian.md** — privacy-first positioning, desktop app, dark design
- **Craft.do** — polished feature showcases with app screenshots
- **Superhuman.com** — speed/keyboard emphasis, premium feel

Take the best of these: Linear's clean layout, Raycast's keyboard-centric messaging, Obsidian's privacy positioning, and Superhuman's premium feel.

---

## 10. Stretch Goals

If time permits, consider adding:
- **Interactive demo** — embedded iframe or video walkthrough showing the app in action
- **Changelog page** — auto-generated from git history or manual entries
- **Blog/updates section** — for development progress posts
- **Feature comparison table** — LifeDash vs Notion + Otter.ai + Trello + Forest (show it replaces all four)
- **Dark/light mode toggle** on the website itself (matching the app's dual theme)
- **Animated feature transitions** — as the user scrolls, app screenshots morph between features
- **Download counter** — show total downloads for social proof
