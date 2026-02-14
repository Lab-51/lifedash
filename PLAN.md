# Plan 10.1 — Enterprise Distribution Readiness (Tier 1)

<phase n="10.1" name="Enterprise Distribution Readiness">
  <context>
    Living Dashboard is being prepared for enterprise internal distribution.
    Enterprise laptops enforce AppLocker/WDAC policies, EDR monitoring, and
    proxy-gated internet access. The current build is unsigned, uses a
    user-space Squirrel installer, and makes direct HTTP calls to AI APIs.

    This plan addresses the three Tier 1 blockers:
    1. Code signing — unsigned apps are blocked by AppLocker + SmartScreen
    2. MSI installer — enterprise IT deploys via SCCM/Intune (not Squirrel)
    3. Proxy support — AI API calls fail behind corporate proxies

    @PROJECT.md @STATE.md @forge.config.ts @src/main/services/ai-provider.ts
  </context>

  <task type="auto" n="1">
    <n>Self-signed code signing + Squirrel signing config</n>
    <files>
      forge.config.ts
      scripts/generate-cert.ps1 (new)
      .gitignore
    </files>
    <action>
      Enterprise IT will push our signing certificate as a Trusted Publisher
      via Group Policy, so a self-signed cert is sufficient (no EV purchase).

      1. Create `scripts/generate-cert.ps1` — PowerShell script that:
         - Generates a self-signed code signing certificate using
           `New-SelfSignedCertificate -Type CodeSigningCert`
         - Exports it to `certs/living-dashboard.pfx` with password from env var
         - Includes instructions for IT to import into GPO Trusted Publishers
         - Subject: "CN=Living Dashboard, O=Living Dashboard"

      2. Update `forge.config.ts`:
         - Add signing config to `MakerSquirrel`:
           `certificateFile: './certs/living-dashboard.pfx'`
           `certificatePassword: process.env.CERT_PASSWORD`
         - Only sign when CERT_PASSWORD env var is set (dev builds skip signing)

      3. Update `.gitignore`:
         - Add `certs/` directory (PFX files must never be committed)

      WHY: Without signing, AppLocker rejects the executable and SmartScreen
      shows a scary warning. Self-signed + GPO trust is the standard free
      path for internal enterprise tools.
    </action>
    <verify>
      - `scripts/generate-cert.ps1` exists and has clear comments
      - `forge.config.ts` conditionally applies signing when CERT_PASSWORD is set
      - `certs/` is in `.gitignore`
      - `npx tsc --noEmit` passes
      - `npm run package` succeeds without CERT_PASSWORD set (signing skipped)
    </verify>
    <done>
      Signing infrastructure in place. Dev builds work without cert.
      With cert + password, MakerSquirrel produces a signed installer.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - PowerShell 5.1+ available on Windows build machines
      - signtool.exe available via Windows SDK (MakerSquirrel invokes it)
      - Self-signed cert is acceptable for internal distribution (IT pushes trust via GPO)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Add WiX MSI installer for enterprise deployment</n>
    <files>
      package.json
      forge.config.ts
    </files>
    <preconditions>
      - Task 1 complete (signing config available)
      - WiX Toolset v3 installed on build machine (external dependency)
    </preconditions>
    <action>
      Enterprise IT deploys software via SCCM/Intune using MSI packages.
      The current Squirrel installer writes to %LOCALAPPDATA% which some
      AppLocker policies block. MSI installs to Program Files.

      1. Install `@electron-forge/maker-wix` as a devDependency:
         `npm install --save-dev @electron-forge/maker-wix`

      2. Update `forge.config.ts`:
         - Import `MakerWix` from `@electron-forge/maker-wix`
         - Add MakerWix to the `makers` array with config:
           name, manufacturer, upgradeCode (stable GUID), ui.chooseDirectory
         - Keep MakerSquirrel as default (for dev/personal use)
         - MSI is the enterprise distribution target

      3. The `upgradeCode` GUID must be stable across versions — generate once
         and hardcode. This allows MSI upgrades to replace previous installs.

      WHY: MSI is the standard enterprise deployment format. It supports
      silent install (msiexec /i app.msi /quiet), GPO deployment,
      SCCM/Intune distribution, and Program Files installation.
    </action>
    <verify>
      - `@electron-forge/maker-wix` is in devDependencies
      - `forge.config.ts` imports and configures MakerWix
      - `npx tsc --noEmit` passes
      - `npm run make` produces an MSI file (requires WiX Toolset installed)
    </verify>
    <done>
      Running `npm run make` produces both Squirrel .exe and WiX .msi installers.
      MSI supports silent install and installs to Program Files.
    </done>
    <confidence>MEDIUM</confidence>
    <assumptions>
      - @electron-forge/maker-wix package exists and is compatible with Forge v7
      - WiX Toolset v3 is installed on the build machine (not bundled)
      - MSI maker supports the options listed (chooseDirectory, upgradeCode)
      - VERIFY: Check @electron-forge/maker-wix docs/npm before implementing
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Proxy-aware networking for AI API calls</n>
    <files>
      src/main/services/proxyService.ts (new)
      src/main/services/ai-provider.ts (modify)
      src/main/main.ts (modify)
      src/renderer/components/settings/ProxySettingsSection.tsx (new)
      src/renderer/pages/SettingsPage.tsx (modify)
      src/main/ipc/settings.ts (modify — add proxy IPC handlers)
      src/preload/domains/settings.ts (modify — add proxy bridge)
      src/shared/types/electron-api.ts (modify — extend interface)
    </files>
    <preconditions>
      - No dependency on tasks 1 or 2 (independent)
    </preconditions>
    <action>
      AI API calls use Node.js fetch in the main process, which does NOT
      respect system proxy settings. Enterprise networks route all traffic
      through a proxy — without this, all AI features silently fail.

      1. Create `src/main/services/proxyService.ts`:
         - Detect proxy from environment (HTTP_PROXY, HTTPS_PROXY, NO_PROXY)
         - Fallback: read from settings DB (proxy:url, proxy:noProxy)
         - Export `getProxyUrl()` and `applyGlobalProxy()`
         - Use undici ProxyAgent + setGlobalDispatcher to intercept
           all Node.js fetch calls in the main process
           (Electron 40 / Node 22 uses undici for built-in fetch)

      2. Update `src/main/main.ts`:
         - Call `applyGlobalProxy()` early in app startup (before any AI calls)

      3. Update `src/main/services/ai-provider.ts`:
         - No changes needed IF global dispatcher approach works
         - If undici global dispatcher does not cover the SDK's fetch,
           pass a custom fetch option to each provider's create function

      4. Create `src/renderer/components/settings/ProxySettingsSection.tsx`:
         - Text input for proxy URL (e.g. http://proxy.corp.com:8080)
         - Text input for no-proxy list (comma-separated domains)
         - "Use system proxy" checkbox (reads env vars)
         - Save to settings DB via IPC

      5. Wire up IPC in `src/main/ipc/settings.ts`:
         - settings:getProxy — returns current proxy config
         - settings:setProxy — saves and re-applies proxy

      6. Add to `src/renderer/pages/SettingsPage.tsx`:
         - New "Network / Proxy" section using ProxySettingsSection

      WHY: Without proxy support, all AI features (brainstorming, meeting
      intelligence, connection testing) fail silently on enterprise networks.
      This is a hard blocker for any corporate deployment.
    </action>
    <verify>
      - `npx tsc --noEmit` passes
      - `npx vitest run` — all 99 tests still pass
      - Proxy settings UI renders in Settings page
      - Setting a proxy URL saves to DB and persists across restarts
      - With HTTP_PROXY env var set, AI provider connection test routes through proxy
    </verify>
    <done>
      AI API calls respect proxy configuration. Users can set proxy via
      Settings UI or environment variables. System proxy auto-detected.
    </done>
    <confidence>MEDIUM</confidence>
    <assumptions>
      - Electron 40 uses Node 22 with undici-backed fetch
      - undici is available in Electron's Node.js runtime (no extra install needed)
      - setGlobalDispatcher(new ProxyAgent(...)) intercepts all fetch calls
      - VERIFY: Test that undici global dispatcher affects AI SDK's internal fetch
      - VERIFY: Check if @ai-sdk/openai and @ai-sdk/anthropic accept a custom fetch option
    </assumptions>
  </task>
</phase>
