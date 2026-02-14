# Plan: Custom Recordings Save Folder (Ad-hoc Feature)

## Problem

Audio recordings save to a hard-coded path (`userData/recordings/`) buried in AppData. Users want
to choose a visible, backed-up location (e.g., `D:\My Recordings\`) and have recordings survive
app reinstalls.

## Solution

Add a "Recordings Folder" section to Settings. The main-process `getRecordingsDir()` reads from
the settings DB with a fallback to the default path. Follows existing patterns: `AudioDeviceSection`
for UI, `backup.ts` for dialog, direct DB reads from main-process services.

<phase n="9.ad-hoc" name="Custom Recordings Save Folder">
  <context>
    Currently `getRecordingsDir()` in audioProcessor.ts is hard-coded to
    `app.getPath('userData') + '/recordings'`. The returned absolute path is stored in
    `meetings.audio_path` in the database, so old recordings remain accessible regardless
    of future path changes.

    The settings system (key-value store) already supports get/set/delete via IPC.
    Example: `AudioDeviceSection.tsx` uses key `audio:inputDeviceId`.

    The folder picker dialog pattern already exists in `src/main/ipc/backup.ts`
    (`dialog.showOpenDialog` with `openDirectory`).

    `registerSettingsHandlers()` currently takes no args. Other handlers like
    `registerRecordingHandlers(mainWindow)` and `registerBackupHandlers(mainWindow)`
    already receive mainWindow for dialog parenting.

    Key files to read:
    @src/main/services/audioProcessor.ts (143 lines — getRecordingsDir + saveWav)
    @src/main/ipc/settings.ts (61 lines — existing settings IPC handlers)
    @src/main/ipc/index.ts (46 lines — handler registration)
    @src/preload/domains/settings.ts (26 lines — preload bridge)
    @src/shared/types/electron-api.ts (ElectronAPI interface — settings section at lines 118-122)
    @src/renderer/components/settings/AudioDeviceSection.tsx (147 lines — pattern to follow)
    @src/renderer/pages/SettingsPage.tsx (187 lines — renders setting sections)
  </context>

  <task type="auto" n="1">
    <n>Add settings-aware recordings path + IPC plumbing</n>
    <files>
      src/main/services/audioProcessor.ts (make getRecordingsDir async, read from settings DB)
      src/main/ipc/settings.ts (add folder picker + default path handlers, accept mainWindow)
      src/main/ipc/index.ts (pass mainWindow to registerSettingsHandlers)
      src/preload/domains/settings.ts (add pickRecordingsFolder + getDefaultRecordingsPath)
      src/shared/types/electron-api.ts (extend ElectronAPI interface)
    </files>
    <action>
      **audioProcessor.ts changes:**
      1. Add imports: `getDb` from `../db/connection`, `settings` from `../db/schema`, `eq` from `drizzle-orm`
      2. Rename current `getRecordingsDir()` to `getDefaultRecordingsDir()` (keep sync, same body)
      3. Add new async `getRecordingsDir()`:
         - Query settings table for key `recordings:savePath`
         - If found and non-empty, return that value
         - On error or missing, return `getDefaultRecordingsDir()`
         - Wrap DB access in try/catch so recording never fails due to a settings read error
      4. In `saveWav()` line 105: change `const dir = getRecordingsDir()` to `const dir = await getRecordingsDir()`
         (saveWav is already async, so this is a trivial change)

      WHY: The main process needs to read the setting directly from the DB because
      there's no IPC path from main→main. This is the established pattern — other services
      like transcriptionProviderService.ts read settings the same way.

      **settings.ts changes:**
      1. Change import to include `BrowserWindow, dialog` from electron and `app` from electron
      2. Change signature: `registerSettingsHandlers(mainWindow: BrowserWindow)`
      3. Add handler `settings:pick-recordings-folder`:
         - Calls `dialog.showOpenDialog(mainWindow, { title: 'Choose Recordings Folder', properties: ['openDirectory', 'createDirectory'] })`
         - Returns selected path or null if cancelled
      4. Add handler `settings:get-default-recordings-path`:
         - Returns `path.join(app.getPath('userData'), 'recordings')`
         - WHY: Renderer needs to display the default path without hardcoding it

      **index.ts changes:**
      1. Line 33: `registerSettingsHandlers()` → `registerSettingsHandlers(mainWindow)`

      **preload/domains/settings.ts changes:**
      1. Add to settingsBridge object:
         - `pickRecordingsFolder: () => ipcRenderer.invoke('settings:pick-recordings-folder')`
         - `getDefaultRecordingsPath: () => ipcRenderer.invoke('settings:get-default-recordings-path')`

      **electron-api.ts changes:**
      1. After line 122 (deleteSetting), add:
         - `pickRecordingsFolder: () => Promise<string | null>`
         - `getDefaultRecordingsPath: () => Promise<string>`
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero type errors
      2. `npx vitest run` — all existing tests pass
      3. The app should still record and save audio to the default path (no regression)
    </verify>
    <done>
      getRecordingsDir() reads from settings DB with fallback to default.
      Two new IPC handlers registered. Preload bridge and TypeScript interface updated.
      All existing functionality unchanged.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - getDb() is available when stopRecording runs (DB initialized before recording starts)
      - The settings table schema (`key`, `value`) is unchanged
      - `path` module is already imported in audioProcessor.ts
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Create Recordings Folder settings UI</n>
    <files>
      src/renderer/components/settings/RecordingsSavePathSection.tsx (NEW — settings component)
      src/renderer/pages/SettingsPage.tsx (import + render new section)
    </files>
    <action>
      **RecordingsSavePathSection.tsx — NEW FILE:**
      Follow the AudioDeviceSection.tsx pattern exactly.

      Component structure:
      1. Settings key constant: `recordings:savePath`
      2. State: `currentPath`, `defaultPath`, `isCustom`, `loading`
      3. On mount useEffect:
         - Load saved setting via `window.electronAPI.getSetting(SETTINGS_KEY)`
         - Load default path via `window.electronAPI.getDefaultRecordingsPath()`
         - If saved setting exists → `isCustom: true`, show saved path
         - Otherwise → show default path
      4. `handleBrowse`:
         - Call `window.electronAPI.pickRecordingsFolder()`
         - If user picks a folder → `window.electronAPI.setSetting(key, folder)`
         - Update local state
      5. `handleReset`:
         - Call `window.electronAPI.deleteSetting(key)`
         - Revert to default path display

      UI layout (matching AudioDeviceSection styling):
      - Section header: FolderOpen icon + "Recordings Folder" title
      - Subtitle: "Choose where audio recordings are saved on disk."
      - Card container (bg-surface-800 rounded-lg border):
        - Label: "Save Location" with "(custom)" badge when custom
        - Row: `code` element showing path (truncated) + "Browse..." button + "Reset" button (only when custom)
        - Info text: "Changing this folder only affects new recordings. Existing recordings remain accessible at their original paths."

      WHY: Users need a discoverable way to control where recordings go.
      The section sits right after Audio Devices since both are recording-related settings.

      **SettingsPage.tsx changes:**
      1. Import `RecordingsSavePathSection`
      2. Render it right after `<AudioDeviceSection />` (after line 78):
         ```
         {/* === Section: Recordings Folder === */}
         <RecordingsSavePathSection />
         ```
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero type errors
      2. `npx vitest run` — all existing tests pass
      3. Manual: Open Settings → "Recordings Folder" section visible after Audio Devices
      4. Manual: Shows default path (userData/recordings)
      5. Manual: Click Browse → pick folder → path updates, "(custom)" badge appears, Reset button visible
      6. Manual: Close and reopen Settings → custom path persists
      7. Manual: Click Reset → path reverts to default, Reset button disappears
      8. Manual: Record a meeting → stop → verify WAV saved to custom folder
      9. Manual: Reset → record again → verify WAV saved to default folder
    </verify>
    <done>
      "Recordings Folder" section appears in Settings after Audio Devices.
      Users can browse for a custom folder, see the current path, and reset to default.
      New recordings save to the selected folder. Old recordings remain accessible.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - FolderOpen and RotateCcw icons are available in lucide-react (both are standard icons)
      - The settings page has room for another section (it scrolls, so this is fine)
    </assumptions>
  </task>
</phase>
