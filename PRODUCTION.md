# Production Profile

Generated: 2026-03-15
Tier: Silver

## Product
Type: Desktop Application (Electron)
Stack: TypeScript, React, Vite, PGlite, Drizzle ORM, Electron
Deployment: Windows Desktop Installer (Inno Setup) + GitHub Releases

## Scope
Handles auth: YES (Supabase auth, secure token storage via DPAPI)
Multi-tenant: NO (single-user desktop app)
Has database: YES (PGlite — embedded WASM PostgreSQL, Drizzle ORM, 27 migrations)
Has frontend: YES (React, 111 .tsx components)

## Active Dimensions
- Security: YES (weight: 23.5%)
- Scalability: NO — SKIPPED (desktop app)
- Code Quality: YES (weight: 11.8%)
- Operational Readiness: YES (weight: 17.6%)
- Testing: YES (weight: 17.6%)
- Infrastructure: YES (weight: 11.8%)
- SaaS/Multi-tenancy: NO — SKIPPED (single-user)
- Frontend Performance: YES (weight: 5.9%)
- Database Health: YES (weight: 5.9%)
- Compliance: YES (weight: 5.9%)

## Dimension Notes
- Security: Auth enabled via Supabase — check token storage, CSP headers, IPC security, API key encryption
- Code Quality: TypeScript codebase, check file sizes, function complexity, error handling
- Operational Readiness: Check logging, crash recovery, auto-updater, graceful shutdown
- Testing: Vitest + Playwright configured, check coverage and test quality
- Infrastructure: GitHub Actions CI, Electron Forge build pipeline, Inno Setup installer
- Frontend Performance: 111 React components — check bundle size, re-renders, lazy loading
- Database Health: PGlite + 27 Drizzle migrations — check indexes, query patterns, integrity checks
- Compliance: Local API key storage, user data handling, privacy considerations
- Scalability: SKIPPED — desktop app
- SaaS/Multi-tenancy: SKIPPED — single-user desktop app
