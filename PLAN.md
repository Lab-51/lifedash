# Phase 3 — Plan 3 of 3: Theme, Usage & App Settings

## Coverage
- **R9: Settings & Configuration** (remaining — theme toggle, usage display, about/info)
- **R7: AI Provider System** (token usage tracking UI)

## Plan Overview
Phase 3 delivers the AI Provider System (R7) and Settings & Configuration (R9). It requires 3 plans:

- **Plan 3.1** (COMPLETE): Backend foundation — deps, DB schema, services, IPC handlers.
- **Plan 3.2** (COMPLETE): Settings UI — store, settings page, provider cards, model config.
- **Plan 3.3** (this plan): Theme system, token usage display, and app info section.

## Design Decisions for This Plan

1. **Theme system** — CSS custom property override approach.
   Tailwind CSS 4's `@theme` sets `--color-surface-*` as CSS custom properties on `:root`.
   Light mode overrides these via `html.light { --color-surface-*: ... }` selector,
   inverting the surface scale so all existing classes work without any component changes.
   Primary colors stay the same (blue works on both backgrounds).

2. **Theme persistence** — Stored in settings table as `app.theme` key.
   Values: `'dark'` | `'light'` | `'system'`. System follows `prefers-color-scheme`.
   Applied early in App.tsx via a `useTheme` hook that reads from settingsStore
   and sets the class on `document.documentElement`.

3. **Theme toggle location** — Sidebar bottom area (always accessible).
   Small icon button below the nav items (Sun/Moon icon). Cycles: dark → light → system.
   Full theme selector also available in the Appearance section on Settings page.

4. **Usage display** — New section on Settings page below Model Assignments.
   Shows total tokens, estimated cost, breakdowns by provider and task type.
   Uses existing `getAIUsageSummary` IPC. Data loaded on mount.
   Minimal UI — table layout, no charts for v1.

5. **About section** — Brief section at bottom of Settings page showing app version,
   database status, and encryption status. Informational only.

---

<phase n="3.3" name="Theme, Usage & App Settings">
  <context>
    Plans 3.1 and 3.2 are complete. The app now has:
    - Settings page with AI Providers section and Model Assignments section
    - settingsStore with loadSettings, setSetting, and generic key-value persistence
    - IPC handlers: getAIUsage (100 recent), getAIUsageSummary (aggregated)
    - ElectronAPI: getAIUsage, getAIUsageSummary, getDatabaseStatus, isEncryptionAvailable
    - Preload bridge: All methods wired
    - Tailwind CSS 4 with @theme defining --color-surface-* and --color-primary-*
    - Surface palette: 50 (#f8fafc) through 950 (#020617), used everywhere
    - App layout: TitleBar + AppLayout (Sidebar + main) + StatusBar
    - Sidebar: 5 nav items (Projects, Meetings, Ideas, Brainstorm, Settings)

    Theme approach: Tailwind CSS 4's @theme sets CSS custom properties on :root.
    We add `html.light` overrides that invert the surface scale. This makes ALL
    existing Tailwind classes (bg-surface-900, text-surface-100, etc.) automatically
    adapt to the theme without touching any component files.

    UI patterns (from Phase 2):
    - Page layout: p-6 padding, h1 text-2xl font-bold
    - Section: mb-10, h2 text-lg font-semibold, p text-sm text-surface-500
    - Cards: p-4 bg-surface-800 border border-surface-700 rounded-lg
    - Buttons: bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg
    - Empty state: flex flex-col items-center justify-center text-surface-500
    - Icons: Lucide React, size={16} inline, size={20} nav

    @src/renderer/styles/globals.css (theme CSS — to be modified)
    @src/renderer/stores/settingsStore.ts (settings store — reference)
    @src/renderer/pages/SettingsPage.tsx (settings page — to be modified)
    @src/renderer/components/Sidebar.tsx (sidebar — to be modified)
    @src/renderer/App.tsx (root component — to add useTheme)
    @src/shared/types.ts (AIUsageSummary type — reference)
  </context>

  <task type="auto" n="1">
    <n>Create theme system with CSS overrides and useTheme hook</n>
    <files>
      src/renderer/styles/globals.css (modify — add light theme overrides + scrollbar theme)
      src/renderer/hooks/useTheme.ts (create — hook that applies theme to document)
      src/renderer/App.tsx (modify — add useTheme call in AppShell)
    </files>
    <action>
      Create the theme system that enables light/dark/system modes using CSS
      custom property overrides and a React hook for persistence.

      WHY: The app is currently dark-mode only. Users need a light theme option
      for daytime use and accessibility. The CSS override approach means ZERO
      changes to existing components — all surface-* classes adapt automatically.

      ## Step 1: Modify globals.css

      Add light theme CSS overrides AFTER the existing `@theme` block (before scrollbar styles).
      The light theme inverts the surface scale so semantic usage stays correct:
      - `bg-surface-900` (main background) → becomes light
      - `text-surface-100` (primary text) → becomes dark
      - `border-surface-700` (borders) → becomes proportionally appropriate

      Add this block after the `@theme { ... }` closing brace:

      ```css
      /* Light theme — inverts surface scale so all existing classes adapt */
      html.light {
        --color-surface-50: #020617;
        --color-surface-100: #0f172a;
        --color-surface-200: #1e293b;
        --color-surface-300: #334155;
        --color-surface-400: #64748b;
        --color-surface-500: #94a3b8;
        --color-surface-600: #cbd5e1;
        --color-surface-700: #e2e8f0;
        --color-surface-800: #f1f5f9;
        --color-surface-900: #f8fafc;
        --color-surface-950: #ffffff;
      }
      ```

      Also update the scrollbar comment to say "Custom scrollbar" instead of
      "Custom scrollbar for dark theme" since it now works for both.

      Also update the light theme scrollbar to use a lighter track for better visibility.
      Add after the existing scrollbar styles:
      ```css
      html.light ::-webkit-scrollbar-thumb {
        background: var(--color-surface-400);
      }
      html.light ::-webkit-scrollbar-thumb:hover {
        background: var(--color-surface-500);
      }
      ```

      ## Step 2: Create useTheme hook

      Create src/renderer/hooks/useTheme.ts:

      ```typescript
      // === FILE PURPOSE ===
      // Hook that manages the app theme (dark/light/system).
      // Reads theme preference from settingsStore, applies the correct CSS class
      // to document.documentElement, and listens for system theme changes.

      import { useEffect } from 'react';
      import { useSettingsStore } from '../stores/settingsStore';

      export type ThemeMode = 'dark' | 'light' | 'system';

      /** Resolves 'system' to the actual theme based on OS preference */
      function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
        if (mode === 'system') {
          return window.matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark';
        }
        return mode;
      }

      /** Apply the resolved theme class to the document root */
      function applyTheme(mode: ThemeMode) {
        const resolved = resolveTheme(mode);
        document.documentElement.classList.toggle('light', resolved === 'light');
      }

      /**
       * Manages app theme. Call once at the app root level.
       * Reads from settings store key 'app.theme' (default: 'dark').
       * Applies CSS class to <html> and listens for system theme changes.
       */
      export function useTheme() {
        const settings = useSettingsStore(s => s.settings);
        const setSetting = useSettingsStore(s => s.setSetting);

        const themeMode = (settings['app.theme'] as ThemeMode) || 'dark';

        // Apply theme whenever the setting changes
        useEffect(() => {
          applyTheme(themeMode);
        }, [themeMode]);

        // Listen for OS theme changes when mode is 'system'
        useEffect(() => {
          if (themeMode !== 'system') return;

          const mq = window.matchMedia('(prefers-color-scheme: light)');
          const handler = () => applyTheme('system');
          mq.addEventListener('change', handler);
          return () => mq.removeEventListener('change', handler);
        }, [themeMode]);

        const setTheme = (mode: ThemeMode) => {
          setSetting('app.theme', mode);
        };

        return { themeMode, setTheme };
      }
      ```

      ## Step 3: Modify App.tsx

      Add `useTheme` call inside the `AppShell` component so theme is applied
      on every render (including initial load). AppShell already lives inside
      HashRouter and runs hooks.

      Add import at top:
      ```typescript
      import { useTheme } from './hooks/useTheme';
      ```

      Add the hook call as the first line inside AppShell function body:
      ```typescript
      useTheme();
      ```

      The AppShell function should look like:
      ```typescript
      function AppShell({ children }: { children: ReactNode }) {
        const navigate = useNavigate();
        useKeyboardShortcuts(navigate);
        useTheme();
        return <>{children}</>;
      }
      ```

      Key design notes:
      - Default theme is 'dark' (matches current app appearance)
      - 'system' mode follows OS prefers-color-scheme and reacts to changes
      - applyTheme uses classList.toggle for clean add/remove
      - No class on html = dark mode (backward compatible with current state)
      - html.light class = light mode (CSS overrides kick in)
      - Theme is applied in AppShell so it runs before any page renders
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify globals.css has both the @theme block AND the html.light override block
      3. Verify html.light overrides have all 11 surface values (50 through 950)
      4. Verify useTheme.ts exports useTheme function and ThemeMode type
      5. Verify App.tsx imports and calls useTheme() in AppShell
      6. Verify default theme is 'dark' when no setting exists
    </verify>
    <done>
      Theme CSS system created: light theme via html.light class overrides all
      surface colors. useTheme hook reads from settings, applies CSS class,
      and responds to OS theme changes. Integrated into App.tsx AppShell.
      Default is dark mode. No existing component changes needed.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Tailwind CSS 4's @theme generates CSS custom properties on :root that
        can be overridden by more specific selectors (html.light)
      - Electron's Chromium supports matchMedia('prefers-color-scheme')
      - classList.toggle with boolean argument works in Electron's Chromium
      - Settings are loaded before useTheme runs (loadSettings called in SettingsPage
        useEffect — need to ensure it runs early enough; AppShell runs useTheme
        but settings may not be loaded yet on first render, which defaults to 'dark')
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Add theme toggle to Sidebar and Appearance section to Settings page</n>
    <files>
      src/renderer/components/Sidebar.tsx (modify — add theme toggle button at bottom)
      src/renderer/components/ThemeSelector.tsx (create — Appearance section component)
      src/renderer/pages/SettingsPage.tsx (modify — add Appearance section + import)
    </files>
    <preconditions>
      - Task 1 completed (useTheme hook exists, CSS overrides in place)
    </preconditions>
    <action>
      Add theme toggle UI in two places: a quick-cycle button at the bottom
      of the Sidebar, and a full Appearance section on the Settings page.

      WHY: Users need quick access to switch themes (Sidebar button) and a
      proper settings interface to choose between dark/light/system modes
      (Settings page). Two touchpoints: quick and detailed.

      ## Component 1: Modify Sidebar.tsx

      Add a theme toggle button at the bottom of the sidebar (below nav items).
      The button cycles through: dark → light → system on each click.
      Shows Moon icon for dark, Sun icon for light, Monitor icon for system.

      Changes to Sidebar.tsx:
      1. Add imports: `import { Sun, Moon, Monitor } from 'lucide-react';`
         and `import { useTheme } from '../hooks/useTheme';`
         and `import type { ThemeMode } from '../hooks/useTheme';`
      2. Add theme icon map and cycle logic inside the component
      3. Add a spacer div with `flex-1` to push the toggle to the bottom
      4. Add the toggle button after the spacer

      The updated Sidebar component should be:

      ```typescript
      // === FILE PURPOSE ===
      // Fixed-width icon sidebar for primary app navigation.
      // Includes a theme toggle button at the bottom.

      // === DEPENDENCIES ===
      // react-router-dom (NavLink), lucide-react icons, useTheme hook

      import { NavLink, useLocation } from 'react-router-dom';
      import {
        FolderKanban,
        Mic,
        Lightbulb,
        Brain,
        Settings,
        Sun,
        Moon,
        Monitor,
      } from 'lucide-react';
      import { useTheme } from '../hooks/useTheme';
      import type { ThemeMode } from '../hooks/useTheme';

      /** Navigation item configuration */
      interface NavItem {
        path: string;
        label: string;
        icon: React.ComponentType<{ size?: number }>;
      }

      const navItems: NavItem[] = [
        { path: '/', label: 'Projects', icon: FolderKanban },
        { path: '/meetings', label: 'Meetings', icon: Mic },
        { path: '/ideas', label: 'Ideas', icon: Lightbulb },
        { path: '/brainstorm', label: 'Brainstorm', icon: Brain },
        { path: '/settings', label: 'Settings', icon: Settings },
      ];

      const THEME_CYCLE: ThemeMode[] = ['dark', 'light', 'system'];
      const THEME_ICONS: Record<ThemeMode, React.ComponentType<{ size?: number }>> = {
        dark: Moon,
        light: Sun,
        system: Monitor,
      };
      const THEME_LABELS: Record<ThemeMode, string> = {
        dark: 'Dark mode',
        light: 'Light mode',
        system: 'System theme',
      };

      function Sidebar() {
        const location = useLocation();
        const { themeMode, setTheme } = useTheme();

        const cycleTheme = () => {
          const idx = THEME_CYCLE.indexOf(themeMode);
          const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
          setTheme(next);
        };

        const ThemeIcon = THEME_ICONS[themeMode] || Moon;

        return (
          <nav className="w-16 bg-surface-900 border-r border-surface-800 flex flex-col shrink-0">
            {navItems.map(({ path, label, icon: Icon }) => {
              // Projects item should also be active on /projects/:id routes
              const isProjectsItem = path === '/';
              const isProjectsActive = isProjectsItem
                ? location.pathname === '/' || location.pathname.startsWith('/projects/')
                : false;

              return (
                <NavLink
                  key={path}
                  to={path}
                  end={isProjectsItem}
                  title={label}
                  className={({ isActive: navActive }) => {
                    const active = isProjectsItem ? isProjectsActive : navActive;
                    return [
                      'w-full h-12 flex items-center justify-center transition-colors',
                      active
                        ? 'bg-primary-600/15 text-primary-400 border-l-2 border-primary-500'
                        : 'text-surface-400 hover:bg-surface-800 hover:text-surface-200 border-l-2 border-transparent',
                    ].join(' ');
                  }}
                >
                  <Icon size={20} />
                </NavLink>
              );
            })}

            {/* Spacer pushes theme toggle to bottom */}
            <div className="flex-1" />

            {/* Theme toggle button */}
            <button
              onClick={cycleTheme}
              title={THEME_LABELS[themeMode]}
              className="w-full h-12 flex items-center justify-center text-surface-400 hover:bg-surface-800 hover:text-surface-200 transition-colors"
            >
              <ThemeIcon size={20} />
            </button>
          </nav>
        );
      }

      export default Sidebar;
      ```

      ## Component 2: Create ThemeSelector.tsx

      Create src/renderer/components/ThemeSelector.tsx:

      A settings section component that shows three theme options (Dark, Light, System)
      as selectable cards. Used in the Appearance section of the Settings page.

      ```typescript
      // === FILE PURPOSE ===
      // Theme selector component for the Appearance section of the Settings page.
      // Shows three options: Dark, Light, System with visual indicators.

      import { Sun, Moon, Monitor } from 'lucide-react';
      import { useTheme } from '../hooks/useTheme';
      import type { ThemeMode } from '../hooks/useTheme';

      const THEME_OPTIONS: { mode: ThemeMode; label: string; description: string; icon: React.ComponentType<{ size?: number }> }[] = [
        { mode: 'dark', label: 'Dark', description: 'Dark background with light text', icon: Moon },
        { mode: 'light', label: 'Light', description: 'Light background with dark text', icon: Sun },
        { mode: 'system', label: 'System', description: 'Follow your OS setting', icon: Monitor },
      ];

      export default function ThemeSelector() {
        const { themeMode, setTheme } = useTheme();

        return (
          <div className="flex gap-3">
            {THEME_OPTIONS.map(({ mode, label, description, icon: Icon }) => (
              <button key={mode} onClick={() => setTheme(mode)}
                className={`flex-1 p-3 rounded-lg border text-left transition-colors ${
                  themeMode === mode
                    ? 'border-primary-500 bg-primary-500/10 text-primary-400'
                    : 'border-surface-700 bg-surface-800 text-surface-300 hover:border-surface-600'
                }`}>
                <Icon size={20} className="mb-1.5" />
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-surface-500 mt-0.5">{description}</div>
              </button>
            ))}
          </div>
        );
      }
      ```

      ## Update SettingsPage.tsx

      Add the Appearance section as the FIRST section on the Settings page
      (before AI Providers). This way the most visual setting is at the top.

      1. Add import at top (after existing imports):
         ```typescript
         import ThemeSelector from '../components/ThemeSelector';
         ```

      2. Add the Appearance section BEFORE the AI Providers section
         (right after the error banner div):

         ```tsx
         {/* === Section: Appearance === */}
         <section className="mb-10">
           <div className="mb-4">
             <h2 className="text-lg font-semibold text-surface-100">Appearance</h2>
             <p className="text-sm text-surface-500">
               Choose your preferred theme.
             </p>
           </div>
           <ThemeSelector />
         </section>
         ```

      Key design notes:
      - Theme selector uses same button-group pattern as AddProviderForm provider type
      - Selected state uses primary-500 border + bg-primary-500/10 (same as provider buttons)
      - Sidebar toggle is for quick switching, Settings page for deliberate configuration
      - Both use the same useTheme hook so they stay in sync
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify Sidebar.tsx has theme toggle button at bottom (after flex-1 spacer)
      3. Verify Sidebar uses useTheme hook and cycles through dark → light → system
      4. Verify ThemeSelector.tsx renders 3 options with correct icons (Moon, Sun, Monitor)
      5. Verify SettingsPage.tsx has Appearance section BEFORE AI Providers section
      6. Verify SettingsPage imports ThemeSelector component
    </verify>
    <done>
      Theme toggle added to Sidebar bottom (icon cycles dark/light/system).
      ThemeSelector component created with 3 selectable cards.
      Appearance section added as first section on Settings page.
      Both UI elements use the same useTheme hook for consistent state.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Lucide React exports Sun, Moon, Monitor icons
      - flex-1 spacer pushes the theme toggle button to the bottom of the sidebar
      - useTheme hook can be called from multiple components (Sidebar + ThemeSelector)
        without conflict since they share the same Zustand store
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Add AI usage tracking display and About section to Settings page</n>
    <files>
      src/renderer/components/UsageSummary.tsx (create — token usage display component)
      src/renderer/pages/SettingsPage.tsx (modify — add Usage and About sections)
    </files>
    <preconditions>
      - Task 2 completed (SettingsPage has Appearance section — need to add after it)
      - settingsStore exists with loadSettings
      - ElectronAPI has getAIUsageSummary and getDatabaseStatus methods
    </preconditions>
    <action>
      Create the AI usage tracking display and a small About/Info section.

      WHY: Users need visibility into their AI token usage and estimated costs
      to manage API expenses. The About section provides at-a-glance system info
      (version, DB status, encryption) — useful for troubleshooting.

      ## Component 1: Create UsageSummary.tsx

      Create src/renderer/components/UsageSummary.tsx:

      Displays AI token usage summary with totals and breakdowns.
      Fetches data directly via window.electronAPI.getAIUsageSummary().

      ```typescript
      // === FILE PURPOSE ===
      // AI token usage summary display for the Settings page.
      // Shows total tokens, estimated cost, and breakdowns by provider and task type.
      // Fetches data directly from IPC (not via store — usage is read-only display).

      import { useState, useEffect } from 'react';
      import { BarChart3, RefreshCw } from 'lucide-react';
      import type { AIUsageSummary as UsageSummaryType } from '../../shared/types';

      /** Format large numbers with commas: 12345 → "12,345" */
      function formatNumber(n: number): string {
        return n.toLocaleString();
      }

      /** Format cost to 4 decimal places: 0.0012 → "$0.0012" */
      function formatCost(cost: number): string {
        if (cost === 0) return '$0.00';
        return `$${cost.toFixed(4)}`;
      }

      /** Format task type ID to human label: task_generation → Task Generation */
      function formatTaskType(type: string): string {
        return type
          .split('_')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
      }

      export default function UsageSummary() {
        const [summary, setSummary] = useState<UsageSummaryType | null>(null);
        const [loading, setLoading] = useState(true);

        const fetchUsage = async () => {
          setLoading(true);
          try {
            const data = await window.electronAPI.getAIUsageSummary();
            setSummary(data);
          } catch (err) {
            console.error('Failed to fetch usage summary:', err);
          } finally {
            setLoading(false);
          }
        };

        useEffect(() => {
          fetchUsage();
        }, []);

        if (loading) {
          return (
            <div className="text-sm text-surface-500 py-4">Loading usage data...</div>
          );
        }

        if (!summary || summary.totalTokens === 0) {
          return (
            <div className="flex flex-col items-center justify-center text-surface-500 py-6">
              <BarChart3 size={32} className="mb-2 text-surface-600" />
              <p className="text-sm">No AI usage recorded yet</p>
              <p className="text-xs text-surface-600 mt-1">
                Usage data will appear here after using AI features
              </p>
            </div>
          );
        }

        const providerEntries = Object.entries(summary.byProvider);
        const taskEntries = Object.entries(summary.byTaskType);

        return (
          <div className="space-y-4">
            {/* Totals row */}
            <div className="flex items-center gap-6">
              <div>
                <div className="text-xs text-surface-500">Total Tokens</div>
                <div className="text-lg font-semibold text-surface-100">
                  {formatNumber(summary.totalTokens)}
                </div>
              </div>
              <div>
                <div className="text-xs text-surface-500">Estimated Cost</div>
                <div className="text-lg font-semibold text-surface-100">
                  {formatCost(summary.totalCost)}
                </div>
              </div>
              <div className="ml-auto">
                <button onClick={fetchUsage}
                  className="flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-200 transition-colors">
                  <RefreshCw size={14} />
                  Refresh
                </button>
              </div>
            </div>

            {/* Breakdowns side by side */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* By Provider */}
              {providerEntries.length > 0 && (
                <div className="p-3 bg-surface-800 border border-surface-700 rounded-lg">
                  <div className="text-xs font-medium text-surface-400 mb-2">By Provider</div>
                  <div className="space-y-1.5">
                    {providerEntries.map(([id, data]) => (
                      <div key={id} className="flex items-center justify-between text-xs">
                        <span className="text-surface-300">{id}</span>
                        <span className="text-surface-400">
                          {formatNumber(data.tokens)} tokens &middot; {formatCost(data.cost)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* By Task Type */}
              {taskEntries.length > 0 && (
                <div className="p-3 bg-surface-800 border border-surface-700 rounded-lg">
                  <div className="text-xs font-medium text-surface-400 mb-2">By Task Type</div>
                  <div className="space-y-1.5">
                    {taskEntries.map(([type, data]) => (
                      <div key={type} className="flex items-center justify-between text-xs">
                        <span className="text-surface-300">{formatTaskType(type)}</span>
                        <span className="text-surface-400">
                          {formatNumber(data.tokens)} tokens &middot; {formatCost(data.cost)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      }
      ```

      ## Update SettingsPage.tsx

      Add two new sections after the existing ones:

      1. Add imports at top:
         ```typescript
         import UsageSummary from '../components/UsageSummary';
         import { Info } from 'lucide-react';
         ```
         Also add to the existing destructure from useSettingsStore:
         ```typescript
         const { providers, loading, error, encryptionAvailable, loadProviders, loadSettings, checkEncryption } =
           useSettingsStore();
         ```

      2. Add "AI Usage" section AFTER the Model Assignments section:
         ```tsx
         {/* === Section: AI Usage === */}
         <section className="mb-10">
           <div className="mb-4">
             <h2 className="text-lg font-semibold text-surface-100">AI Usage</h2>
             <p className="text-sm text-surface-500">
               Token usage and estimated costs across all providers.
             </p>
           </div>
           <UsageSummary />
         </section>
         ```

      3. Add "About" section as the LAST section:
         ```tsx
         {/* === Section: About === */}
         <section className="mb-10">
           <div className="mb-4">
             <h2 className="text-lg font-semibold text-surface-100">About</h2>
           </div>
           <div className="p-4 bg-surface-800 border border-surface-700 rounded-lg">
             <div className="flex items-center gap-2 mb-3">
               <Info size={16} className="text-primary-400" />
               <span className="text-sm font-medium text-surface-200">Living Dashboard</span>
             </div>
             <div className="space-y-1.5 text-xs text-surface-400">
               <div className="flex justify-between">
                 <span>Version</span>
                 <span className="text-surface-300">0.1.0</span>
               </div>
               <div className="flex justify-between">
                 <span>Encryption</span>
                 <span className={encryptionAvailable ? 'text-emerald-400' : 'text-surface-500'}>
                   {encryptionAvailable === null ? 'Checking...' : encryptionAvailable ? 'Available' : 'Unavailable'}
                 </span>
               </div>
               <div className="flex justify-between">
                 <span>Platform</span>
                 <span className="text-surface-300">{window.electronAPI.platform}</span>
               </div>
             </div>
           </div>
         </section>
         ```

      Key design notes:
      - UsageSummary fetches directly from IPC (not store) — read-only, no caching needed
      - Refresh button lets user manually re-fetch without page reload
      - Empty state when no usage data exists (clean messaging)
      - About section shows version (hardcoded 0.1.0 for now), encryption status, platform
      - formatCost uses 4 decimal places since AI costs can be very small
      - Provider IDs are shown as-is in usage breakdown (UUIDs — could map to names later)
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify UsageSummary.tsx exports component that fetches from getAIUsageSummary
      3. Verify UsageSummary shows totals, by-provider, and by-task-type breakdowns
      4. Verify UsageSummary has empty state for zero usage
      5. Verify SettingsPage.tsx now has 5 sections in order:
         Appearance, AI Providers, Model Assignments, AI Usage, About
      6. Verify SettingsPage imports UsageSummary and Info icon
      7. Verify About section shows encryption status from store
    </verify>
    <done>
      UsageSummary component created with token totals, cost tracking,
      and breakdowns by provider and task type. About section shows
      app version, encryption status, and platform. Settings page now
      has 5 complete sections: Appearance, AI Providers, Model Assignments,
      AI Usage, and About.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - window.electronAPI.getAIUsageSummary returns AIUsageSummary type correctly
      - window.electronAPI.platform returns a valid string (available via preload bridge)
      - toLocaleString works in Electron's Chromium for number formatting
      - HTML entity &amp;middot; renders correctly in JSX (may need to use Unicode \u00B7 instead)
    </assumptions>
  </task>
</phase>
