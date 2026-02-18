<phase n="D.7" name="Light Mode Overhaul">
  <context>
    The app uses a hybrid theming approach: CSS variable inversion (surface-50↔950 flipped in
    html.light) combined with Tailwind `dark:` prefix classes. This creates two problems:

    1. **Broken mechanism:** Tailwind v4's `dark:` uses `@media (prefers-color-scheme: dark)` by
       default, not class-based. Modern components using `bg-surface-50 dark:bg-surface-950` break
       when OS prefers light (base class applies, but inverted surface-50 = #09090b = dark).

    2. **Poor aesthetics:** Light mode is a mechanical inversion of Zinc grays — cold, flat, no depth.

    **Solution:** Switch to class-based dark mode (`@variant dark`), replace the inversion approach
    with a proper light-mode palette using natural Slate values, and add `dark:` variants to all
    components that currently use hardcoded dark-only surface classes.

    **Dark mode guarantee:** Dark mode is visually unchanged. The only difference is that `dark:`
    classes now match via CSS class (`.dark` on html) instead of media query — producing identical
    visual results. No CSS variable values for dark mode are changed. No `dark:` class values are
    changed in any component.

    @PROJECT.md @STATE.md
    @src/renderer/styles/globals.css
    @src/renderer/hooks/useTheme.ts
    @src/renderer/hooks/useDesign.ts
    @src/renderer/components/SidebarModern.tsx (reference for Modern pattern)
    @src/renderer/components/StatusBar.tsx (reference for non-Modern pattern)
  </context>

  <task type="auto" n="1">
    <n>Theme system fix + light mode CSS foundation</n>
    <files>
      src/renderer/styles/globals.css
      src/renderer/hooks/useTheme.ts
    </files>
    <action>
      **1. Fix the dark mode variant mechanism (globals.css)**

      Add class-based dark mode variant at the top of globals.css, after the Tailwind import:

      ```css
      @variant dark (&:where(.dark, .dark *));
      ```

      This makes `dark:` classes match when `.dark` is on an ancestor element (standard Tailwind v4
      class-based dark mode). Dark mode is visually identical — same selectors, same variables.

      **2. Toggle dark/light classes (useTheme.ts)**

      Update the `applyTheme` function to toggle BOTH classes:

      ```ts
      function applyTheme(mode: ThemeMode) {
        const resolved = resolveTheme(mode);
        const el = document.documentElement.classList;
        el.toggle('light', resolved === 'light');
        el.toggle('dark', resolved === 'dark');
      }
      ```

      This ensures `dark:` classes apply in dark mode (via class) and DON'T apply in light mode.

      **3. Replace inverted light palettes with natural values (globals.css)**

      Replace `html.light` block (the "classic" theme light override) with natural Slate values:

      ```css
      html.light {
        --color-surface-50: #f8fafc;
        --color-surface-100: #f1f5f9;
        --color-surface-200: #e2e8f0;
        --color-surface-300: #cbd5e1;
        --color-surface-400: #94a3b8;
        --color-surface-500: #64748b;
        --color-surface-600: #475569;
        --color-surface-700: #334155;
        --color-surface-800: #1e293b;
        --color-surface-900: #0f172a;
        --color-surface-950: #020617;
      }
      ```

      Replace `html.design-modern.light` block with a polished Slate palette + adjusted primary:

      ```css
      html.design-modern.light {
        /* Slate Surface — warm blue-gray, polished and readable */
        --color-surface-50: #f8fafc;
        --color-surface-100: #f1f5f9;
        --color-surface-200: #e2e8f0;
        --color-surface-300: #cbd5e1;
        --color-surface-400: #94a3b8;
        --color-surface-500: #64748b;
        --color-surface-600: #475569;
        --color-surface-700: #334155;
        --color-surface-800: #1e293b;
        --color-surface-900: #0f172a;
        --color-surface-950: #020617;

        /* Darken primary for light-background contrast */
        --color-primary-300: #6366f1;
        --color-primary-400: #4f46e5;
        --color-primary-500: #4338ca;
        --color-primary-600: #3730a3;
      }
      ```

      NOTE: These are the NATURAL Slate values (not inverted). With class-based dark mode, light-mode
      components use base classes with these natural values. `dark:` classes don't apply in light mode.

      **4. Add light-mode-specific global CSS (globals.css)**

      Add these rules after the palette definitions:

      a) Light mode scrollbar (update existing rules):
      ```css
      html.light ::-webkit-scrollbar-thumb {
        background: #cbd5e1;
      }
      html.light ::-webkit-scrollbar-thumb:hover {
        background: #94a3b8;
      }
      ```

      b) Light mode text selection:
      ```css
      html.light ::selection {
        background: #c7d2fe;
        color: #1e1b4b;
      }
      ```

      c) Light mode select dropdowns — override the hardcoded dark select styles:
      ```css
      html.light select {
        background-color: #ffffff;
        border-color: #e2e8f0;
        color: #1e293b;
        background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2364748b' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
      }
      html.light select:hover {
        border-color: #cbd5e1;
      }
      html.light select option {
        background-color: #ffffff;
        color: #1e293b;
      }
      ```

      d) Light mode body base:
      ```css
      html.light,
      html.light body {
        background: #f8fafc;
        color: #0f172a;
      }
      ```

      e) Light mode TipTap:
      ```css
      html.light .tiptap-editor .ProseMirror {
        color: #1e293b;
      }
      html.light .tiptap-editor .ProseMirror p.is-editor-empty:first-child::before {
        color: #94a3b8;
      }
      html.light .tiptap-editor .ProseMirror code {
        background: #f1f5f9;
      }
      html.light .tiptap-editor .ProseMirror pre {
        background: #f1f5f9;
      }
      html.light .tiptap-editor .ProseMirror blockquote {
        border-left-color: #cbd5e1;
        color: #64748b;
      }
      ```

      f) Light mode logo pulse:
      ```css
      @keyframes logo-pulse-light {
        0%, 100% {
          box-shadow: 0 0 6px rgba(79, 70, 229, 0.1), 0 0 12px rgba(99, 102, 241, 0.05);
        }
        40% {
          box-shadow: 0 0 12px rgba(79, 70, 229, 0.3), 0 0 28px rgba(99, 102, 241, 0.12);
        }
        50% {
          box-shadow: 0 0 8px rgba(79, 70, 229, 0.2), 0 0 18px rgba(99, 102, 241, 0.08);
        }
        65% {
          box-shadow: 0 0 10px rgba(79, 70, 229, 0.25), 0 0 22px rgba(99, 102, 241, 0.1);
        }
      }
      html.light .animate-logo-pulse {
        animation: logo-pulse-light 3s ease-in-out infinite;
      }
      ```

      **WHY this approach:**
      - Class-based dark mode eliminates the OS-preference dependency
      - Natural values (not inverted) are intuitive and easy to maintain
      - Slate palette is warmer than Zinc, with blue undertones that complement the Indigo primary
      - CSS-level light overrides (select, TipTap, etc.) avoid touching dark mode code at all
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no type errors
      2. Start the app with `npm start`
      3. Toggle to dark mode — verify visuals are IDENTICAL to before (same colors, same look)
      4. Toggle to light mode — verify page background is light (#f8fafc), not dark
      5. Verify scrollbar, text selection, select dropdowns all look correct in light mode
      6. Verify TipTap editor renders properly in light mode (open a card with description)
      7. Toggle between dark/light/system 3 times rapidly — no flicker or stuck state
    </verify>
    <done>
      Class-based dark mode works. Light mode shows warm Slate palette with proper text contrast.
      All global CSS elements (scrollbar, select, TipTap, animations) are polished for light mode.
      Dark mode is visually identical to before.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      Tailwind v4's @variant dark directive accepts the (&:where(.dark, .dark *)) selector syntax.
      If it doesn't, we'll use the alternative: @custom-variant dark (.dark &);
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Component light mode support — modals, status bar, and sub-components</n>
    <files>
      src/renderer/components/StatusBar.tsx
      src/renderer/components/CommandPalette.tsx
      src/renderer/components/CardDetailModal.tsx
      src/renderer/components/AchievementsModal.tsx
      src/renderer/components/FocusCompleteModal.tsx
      src/renderer/components/FocusStartModal.tsx
      src/renderer/components/KeyboardShortcutsModal.tsx
      src/renderer/components/ProjectPlanningModal.tsx
      src/renderer/components/IdeaDetailModal.tsx
      src/renderer/components/ConvertActionModal.tsx
      src/renderer/components/MeetingDetailModal.tsx
      src/renderer/components/ErrorBoundary.tsx
      src/renderer/components/FocusOverlay.tsx
      src/renderer/components/ToastContainer.tsx
      src/renderer/components/AddProviderForm.tsx
      src/renderer/components/ActivityLog.tsx
      src/renderer/components/ChecklistSection.tsx
      src/renderer/components/CommentsSection.tsx
      src/renderer/components/RelationshipsSection.tsx
      src/renderer/components/AttachmentsSection.tsx
      src/renderer/components/TaskBreakdownSection.tsx
      src/renderer/components/MeetingPrepSection.tsx
      src/renderer/components/RecordingControls.tsx
      src/renderer/components/BriefSection.tsx
      src/renderer/components/ActionItemList.tsx
      src/renderer/components/MeetingAnalyticsSection.tsx
      src/renderer/components/IdeaAnalysisSection.tsx
      src/renderer/components/UsageSummary.tsx
      src/renderer/components/ProviderCard.tsx
      src/renderer/components/TaskModelConfig.tsx
      src/renderer/components/PageSkeleton.tsx
      src/renderer/components/FocusStatsWidget.tsx
      src/renderer/components/LevelBadge.tsx
      src/renderer/components/ProductivityPulse.tsx
      src/renderer/components/settings/BackupSection.tsx
      src/renderer/components/settings/AudioDeviceSection.tsx
      src/renderer/components/settings/NotificationSection.tsx
      src/renderer/components/settings/ProxySettingsSection.tsx
      src/renderer/components/settings/RecordingsSavePathSection.tsx
      src/renderer/components/settings/TranscriptionProviderSection.tsx
    </files>
    <action>
      Add light/dark class patterns to all components that currently use hardcoded dark-only surface
      classes. This task does NOT change any dark: values — it only adds base (light mode) classes
      alongside existing dark values.

      **Mechanical patterns to apply:**

      | Current class | Replace with |
      |---------------|-------------|
      | `bg-surface-900` (panel/card bg) | `bg-white dark:bg-surface-900` |
      | `bg-surface-800` (input/recessed bg) | `bg-surface-50 dark:bg-surface-800` |
      | `bg-surface-800/30` or `bg-surface-800/50` | `bg-surface-100/50 dark:bg-surface-800/30` (or /50) |
      | `border-surface-700` | `border-surface-200 dark:border-surface-700` |
      | `border-surface-700/50` | `border-surface-200 dark:border-surface-700/50` |
      | `border-surface-800` | `border-surface-200 dark:border-surface-800` |
      | `text-surface-100` | `text-surface-900 dark:text-surface-100` |
      | `text-surface-200` | `text-surface-800 dark:text-surface-200` |
      | `text-surface-300` | `text-surface-700 dark:text-surface-300` |
      | `text-surface-400` | Keep as-is (readable in both modes) |
      | `text-surface-500` | Keep as-is (works for both modes) |
      | `placeholder-surface-500` or `placeholder:text-surface-500` | Keep as-is |
      | `hover:bg-surface-700` | `hover:bg-surface-100 dark:hover:bg-surface-700` |
      | `hover:bg-surface-800` | `hover:bg-surface-100 dark:hover:bg-surface-800` |
      | `hover:text-surface-200` | `hover:text-surface-800 dark:hover:text-surface-200` |
      | `hover:text-surface-300` | `hover:text-surface-700 dark:hover:text-surface-300` |
      | `focus:border-primary-500` | Keep as-is (works in both modes) |
      | `focus:ring-primary-500` | Keep as-is |
      | `shadow-2xl` (on modals) | `shadow-xl dark:shadow-2xl` |
      | `bg-black/50` (modal backdrop) | `bg-black/30 dark:bg-black/50` |

      **Special cases:**

      1. **StatusBar** — Change outer div from `bg-surface-900 border-t border-surface-800` to
         `bg-white dark:bg-surface-900 border-t border-surface-200 dark:border-surface-800`.
         The text-surface-500 and text-surface-600 classes stay as-is (readable in both modes).

      2. **FocusOverlay** — Full-screen immersive overlay. Add light mode variant:
         - Background: `bg-surface-50 dark:bg-surface-950` instead of `bg-surface-950`
         - Timer text: `text-emerald-600 dark:text-emerald-400` for focus, `text-amber-600 dark:text-amber-400` for break
         - Label text: `text-surface-600 dark:text-surface-400`
         - Control buttons: `bg-surface-200 dark:bg-surface-800` with matching hover
         - Stats text: `text-surface-500 dark:text-surface-400`
         - Breathing gradient: use lighter emerald/indigo tones for light mode
         - Keep the zen feel — clean white space with subtle color accents

      3. **ErrorBoundary** — Update bg/border/text to use the light/dark pattern.

      4. **ToastContainer** — Toasts should have visible shadow and solid bg in light mode:
         `bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 shadow-lg`

      5. **ActivityLog timeline dots** — The `bg-surface-900` circles need
         `bg-white dark:bg-surface-900` to match the card background they sit on.

      6. **Modal overlays** (the `fixed inset-0 bg-black/50` or `bg-surface-950/50` backdrop) —
         Use `bg-black/30 dark:bg-black/50` for lighter backdrop in light mode.

      **Execution approach:**
      For each file: read the file, identify all surface-800/900/950 classes that lack a `dark:`
      companion, and apply the transformation table above. Do NOT change any existing `dark:` class
      values. Do NOT change classes on components that already have the `dark:` pattern (Modern
      components like DashboardModern, BoardPageModern, etc. — skip those entirely).

      **WHY:** Without these changes, non-Modern components would display their dark theme colors
      (surface-800=#1e293b, surface-900=#0f172a) in light mode because the CSS variable inversion
      has been removed (Task 1). Adding explicit `dark:` variants ensures dark mode is preserved while
      light mode gets proper bright values.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no type errors
      2. Start the app, toggle to light mode, and visually verify:
         - StatusBar: white bg with visible text
         - Command Palette (Ctrl+K): white modal with proper borders and text
         - Card Detail Modal: white bg, readable text, proper input styling
         - Achievements Modal: white bg, visible badges
         - Focus Start Modal: white bg, readable card list
         - Focus Complete Modal: white bg, readable stats
         - Keyboard Shortcuts Modal: white bg, readable shortcuts
         - Error Boundary: if triggered, shows white bg
         - Toast notifications: visible on light background
      3. Toggle to dark mode and verify ALL the above look IDENTICAL to before the changes
      4. Confirm: no existing dark: class VALUES were changed (only new dark: classes added)
    </verify>
    <done>
      All ~40 components render correctly in light mode with white/light backgrounds, readable text,
      and visible borders. Dark mode appearance is identical to before — no visual regression.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - All listed components are actively used (rendered in the current UI)
      - The pattern replacements cover all cases (some edge cases may need manual adjustment)
      - Settings sub-components follow the same pattern as the main components
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Visual polish — shadows, depth, hover states, and page-level consistency</n>
    <files>
      src/renderer/styles/globals.css (minor additions if needed)
      src/renderer/components/SidebarModern.tsx
      src/renderer/components/DashboardModern.tsx
      src/renderer/components/BoardPageModern.tsx
      src/renderer/components/BoardColumnModern.tsx
      src/renderer/components/KanbanCardModern.tsx
      src/renderer/components/BrainstormModern.tsx
      src/renderer/components/MeetingsModern.tsx
      src/renderer/components/MeetingCardModern.tsx
      src/renderer/components/ProjectsModern.tsx
      src/renderer/components/IdeasModern.tsx
      src/renderer/components/SettingsPageModern.tsx
      src/renderer/components/ChatMessageModern.tsx
      (plus any other files that need touch-ups discovered during visual review)
    </files>
    <action>
      Fine-tune Modern components and any remaining files for a polished, professional light mode.
      These components already have `dark:` variants, so changes here improve the LIGHT side of
      existing class pairs or add light-mode-specific enhancements. DO NOT change any dark: values.

      **1. Shadows and depth**

      In light mode, shadows are the primary depth cue (unlike dark mode where luminance differences
      are stronger). Ensure the following:

      - Cards (KanbanCardModern, MeetingCardModern, DashboardModern stat cards):
        Verify `shadow-sm` is present on the base class (not just on hover). Cards should subtly
        float above the background. If missing, add it.

      - Sidebar: Consider adding a subtle light-mode shadow for depth. For example, add to the
        sidebar nav element: `shadow-[1px_0_3px_rgba(0,0,0,0.04)]` or just use the existing border.

      **2. Sidebar tooltip**

      SidebarModern tooltip uses `bg-surface-800 text-white`. With natural values, surface-800 is
      #1e293b (dark) — dark tooltip on light bg is correct and looks good. Verify it works.

      **3. Hover and focus state verification**

      For Modern components, verify hover states create visible feedback in light mode:
      - `hover:bg-surface-100 dark:hover:bg-surface-800` — surface-100 = #f1f5f9 (subtle) ✓
      - `hover:border-primary-300 dark:hover:border-primary-700` — verify primary-300 contrast
      - `hover:shadow-md` — visible on light bg ✓

      If any hover states are too subtle, increase contrast. For example, if surface-100 hover is
      invisible on a surface-50 background, use surface-200 instead.

      **4. Dashboard page**

      DashboardModern stat cards: `bg-white dark:bg-surface-900` on `bg-surface-50/50 dark:bg-surface-950`:
      - In light mode: white cards on very slightly gray bg (#f8fafc at 50% opacity)
      - This creates subtle depth. Verify it looks good. If cards don't float enough, add `shadow-sm`.

      **5. Board page**

      BoardColumnModern: `bg-surface-50 dark:bg-surface-900/50`:
      - In light mode: surface-50 = #f8fafc (very light gray) ✓
      - Cards inside: `bg-white dark:bg-surface-800` — white cards on light columns ✓

      **6. Brainstorm chat**

      Verify AI messages and user messages have clear visual distinction in light mode.
      Chat bubbles use `bg-white dark:bg-surface-900` which should be fine.

      **7. Settings page**

      SettingsPageModern sections: `bg-white dark:bg-surface-900`. Verify section dividers and
      borders are visible. If input backgrounds blend with the section background, adjust.

      **8. Focus Overlay polish**

      Verify the FocusOverlay light mode treatment from Task 2 produces a clean, zen-like experience.
      The light overlay should feel calm and minimal — soft indigo accents on a bright background.

      **9. Final sweep: search for remaining hardcoded dark-only patterns**

      Grep for `bg-surface-[89]` in all .tsx files and verify each instance either:
      a) Already has a `dark:` variant (Modern components), OR
      b) Was updated in Task 2, OR
      c) Is inside a component that's not rendered (dead code — skip)

      Fix any remaining misses.

      **10. Card drag animations**

      The card-grab/card-drop keyframes use hardcoded `rgba(0,0,0,...)` shadows. These produce
      dark shadows which work in light mode (shadows are dark). Verify they look appropriate and
      not too heavy. If too strong for light mode, add light-mode variants in globals.css.

      **WHY:** Modern components already have the `dark:` pattern but may need tweaks for the light
      side to feel polished. The goal is a light mode that feels intentionally designed — clean,
      airy, with proper depth hierarchy — not just "the other mode."
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no type errors
      2. Run full test suite: `npm test` — all 150 tests pass
      3. Visual verification in light mode — go through EVERY page:
         - Dashboard: stat cards float, heatmap visible, standup area clean
         - Projects: project cards have shadows, hover works, create modal clean
         - Board: columns have depth, cards float, drag preview visible
         - Meetings: meeting cards clean, recording controls visible
         - Ideas: idea cards clean, detail modal polished
         - Brainstorm: chat bubbles clear, sidebar clean, input area styled
         - Settings: sections organized, inputs/selects styled, provider cards clean
         - Focus Overlay: immersive light theme, ring visible, text readable
         - All modals: white bg, visible borders, proper shadows
      4. Toggle back to dark mode — verify EVERY page looks IDENTICAL to before
      5. Rapid theme switching (10+ times) — no flicker, no stuck states
      6. Check keyboard shortcuts, command palette, toasts in both modes
    </verify>
    <done>
      Light mode is polished and professional across all pages. Shadows provide depth, colors are
      warm and readable, hover/focus states provide clear feedback. Dark mode is 100% visually
      unchanged. Theme switching is instant and flicker-free.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Modern components' existing light-side classes (bg-white, bg-surface-50, etc.) work
        correctly with the natural Slate palette values from Task 1
      - The FocusOverlay light theme can be achieved with the dark: pattern without a full rewrite
    </assumptions>
  </task>
</phase>
