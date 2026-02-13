# Issues & Deferred Items

## Open Issues
_None yet_

## Deferred Items

### D1: Meeting Calendar Integration (R13)
**Deferred from:** Plan 7.7
**Reason:** Requires OS-level calendar access (Google Calendar API, Outlook/Exchange integration, or desktop calendar IPC). Complex auth flows and platform-specific APIs make this a standalone effort.
**Scope:** Sync scheduled meetings from calendar, auto-create meeting records, pre-populate meeting titles/templates from calendar events.

### D2: Automatic Meeting Detection / VAD (R13)
**Deferred from:** Plan 7.7
**Reason:** Requires Voice Activity Detection (VAD) library to detect when audio starts/stops automatically. Would need continuous audio monitoring even when not recording, which has performance and privacy implications.
**Scope:** Auto-start recording when voice detected in system audio, auto-stop after silence threshold, background listening mode.

## Enhancement Ideas

### E1: Real-time Speaker Diarization
**Context:** Plan 7.7 implements post-recording diarization. Real-time diarization during recording would require consistent speaker labels across 10-second segments, which current APIs don't handle well for short segments.
**Approach:** Could use WebSocket streaming APIs (Deepgram/AssemblyAI) with session-level speaker tracking. Major pipeline refactor required.
