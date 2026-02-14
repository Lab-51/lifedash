# Current State

## Session Info
Last updated: 2026-02-14
Session focus: Audio device selection + level monitoring + silence detection
Checkpoint reason: Three recording improvements implemented, ready for user testing

## Position
Milestone: Standalone Distribution
Phase: 9 (Distribution Readiness)
Plan: 9.1 — COMPLETE + ad-hoc recording improvements
Latest commit: 903432a on main (pushed to origin)

## Ad-Hoc Features (this session)

### 1. Audio Device Selection
**Problem:** Recording didn't capture headset microphone — `getUserMedia()` used OS default.
**Solution:** Microphone selection in Settings > Audio Devices.
- `audioCaptureService.ts` — `enumerateAudioDevices()`, `AudioDeviceInfo` type, `micDeviceId` param
- `AudioDeviceSection.tsx` — New settings component with device dropdown + auto-refresh
- `SettingsPage.tsx` — Added Audio Devices section
- `recordingStore.ts` — Loads saved mic device from settings before capture

### 2. Audio Level Meter
**Problem:** No way to tell if audio is being captured vs silence.
**Solution:** Real-time level bar in recording UI.
- `audioCaptureService.ts` — RMS calculation in ScriptProcessorNode callback, `onAudioLevel()` API
- `RecordingControls.tsx` — `AudioLevelMeter` component (green bar, amber "No audio" warning)

### 3. Silence Detection
**Problem:** Whisper wastes CPU on silent segments and hallucinates ("you").
**Solution:** RMS threshold check before dispatching to Whisper.
- `transcriptionService.ts` — `calculateInt16RMS()`, skips segments below threshold (RMS < 50)

### Console Warnings Triaged
- **CSP warning (unsafe-eval):** Expected in dev mode. No action needed.
- **ScriptProcessorNode deprecation:** Known v2 item. Not breaking.

### Verification
- TypeScript: zero errors
- Tests: 99/99 pass
- [ ] Audio level meter shows green bar when speaking — needs user verification
- [ ] "No audio detected" warning when mic is silent — needs user verification
- [ ] Headset mic selectable in Settings > Audio Devices — needs user verification
- [ ] Silent segments skipped (check terminal logs for "Skipping silent segment") — needs user verification

## Previous Ad-Hoc Fixes
1. **DevTools opening in packaged builds** — Changed guard to `!app.isPackaged`
2. **Recording crash (whole app closes)** — Removed Worker thread from transcription pipeline

## Phase 1-7 — COMPLETE
All requirements R1-R17 delivered (99 points).

## Phase 8 — COMPLETE
Plans 8.1-8.7 + 4 ad-hoc features delivered.

## Phase 9 — IN PROGRESS
- Plan 9.1: COMPLETE (PGlite migration + packaging)
- Ad-hoc: DevTools fix + recording crash fix + audio device selection + level meter + silence detection
- Plan 9.2+: Not yet planned

## Confidence Levels
Overall approach: HIGH
Audio device selection: HIGH (standard Web APIs)
Audio level meter: HIGH (RMS from ScriptProcessorNode callback)
Silence detection: HIGH (simple RMS threshold, well-understood)

## Decisions Made (Phase 9)
- PGlite over embedded-postgres: smaller bundle, WASM arch-independent
- Audio device selection stored in settings key-value store (key: `audio:inputDeviceId`)
- Device enumeration via Web API — no IPC needed
- Audio level: RMS * 5 scaling for visual responsiveness
- Silence threshold: RMS < 50 on Int16 scale (~0.15% of max amplitude)
- Level meter: green (audio), amber (loud), grey with warning (silent)

## Blockers
- None

## Recording Performance Notes
- CPU spike for ~2-5 seconds every 10 seconds is NORMAL — Whisper processes each segment
- WAV file size: ~1.9 MB per minute (16kHz mono 16-bit PCM)
- Smaller model (tiny) = faster but less accurate; larger model (base/small) = slower but better
