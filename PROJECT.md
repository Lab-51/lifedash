# Living Dashboard

## Vision
An AI-powered adaptive desktop dashboard for professional environments that unifies meeting intelligence, project management, AI-assisted brainstorming, structured task planning, and idea management into a single Electron-based application.

## Problem Statement
Professional developers and teams juggle multiple disconnected tools: meeting recorders, project boards (Trello/Jira), brainstorming tools, task managers, and idea trackers. Context is lost between tools, action items from meetings don't flow into projects, and ideas sit in notes that are never acted upon.

## Solution
A "living" dashboard that:
- **Listens** to meetings via system audio capture, transcribes in real-time, generates briefs, and suggests actionable items
- **Manages** multiple projects with a card-based system (Trello-like but smarter)
- **Brainstorms** with an AI agent in conversational mode
- **Structures** tasks with AI assistance, focusing on production-ready pillars (scalability, security)
- **Captures** ideas in a repository that feeds into projects or new features

## Core Systems
1. **Meeting Intelligence** — System audio capture → transcription → brief → actionable suggestions → project cards
2. **Project Dashboard** — Card-based multi-project management with AI-enhanced workflows
3. **AI Brainstorming Agent** — Conversational interface for ideation and exploration
4. **Task Structuring Engine** — AI-assisted project planning with production-focused pillars
5. **Idea Repository** — Ideas pipeline that converts to projects or features

## Tech Stack
- **Shell:** Electron (system audio access, desktop integration)
- **Frontend:** React + TypeScript + Tailwind CSS
- **Database:** PGlite (embedded WASM PostgreSQL — no Docker required)
- **AI Layer:** Provider-agnostic adapter system (user-configurable per task)
  - Transcription: Whisper (local) or API-based
  - Reasoning: OpenAI, Anthropic, Ollama, Kimi, and others via pluggable adapters
- **Audio:** System audio capture via Electron native modules

## Constraints
- Desktop-only (Electron) — not a web app
- Personal tool first — single user, no auth initially
- Privacy-conscious — embedded PGlite database, local Whisper option
- AI costs configurable — user controls which models are used and when
- Fully standalone — no Docker or external services required

## Target User
Developer/professional who attends meetings, manages projects, and wants AI assistance without scattered tools.

## Success Metrics
- Meeting → actionable project cards in under 2 minutes
- Single interface for all project management needs
- AI assistance feels helpful, not intrusive
- Works offline (with local AI models configured)
