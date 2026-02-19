# Plan H.1 — Transcription Language Selection

<phase n="H.1" name="Transcription Language Selection">
  <context>
    The transcription system currently hardcodes language as 'en' (English) in 3 places:
    - transcriptionService.ts:232 — `language: 'en'` passed to Whisper
    - deepgramTranscriber.ts:57,135 — `language=en` in API URL
    - assemblyaiTranscriber.ts:102,256 — `language_code: 'en'` in request body

    The user wants to support Czech ('cs') and English ('en') transcription, plus
    mixed-language recordings. Whisper supports auto-detection when the language
    parameter is omitted — it detects per-segment, which works well for bilingual
    meetings since audio is already chunked into 10-second segments.

    IMPORTANT: English-only models (*.en) cannot transcribe Czech or auto-detect.
    The user must use a multilingual model (tiny, base, small) for non-English.
    The UI must warn about this incompatibility.

    Language options:
    - English ('en') — works with all models
    - Czech ('cs') — requires multilingual model
    - Auto-detect ('auto') — requires multilingual model; best for mixed Czech/English

    Cloud providers:
    - Deepgram: supports `language=cs`, auto-detect via `detect_language=true`
    - AssemblyAI: supports `language_code` param, auto-detect via `language_detection: true`

    Settings pattern: key-value in settings table (e.g. 'transcription:language' → 'en')

    @PROJECT.md @STATE.md
    @src/main/services/transcriptionService.ts
    @src/main/services/deepgramTranscriber.ts
    @src/main/services/assemblyaiTranscriber.ts
    @src/main/services/audioProcessor.ts
    @src/main/services/whisperModelManager.ts
    @src/main/ipc/recording.ts
    @src/renderer/stores/recordingStore.ts
    @src/renderer/components/RecordingControls.tsx
    @src/renderer/components/settings/TranscriptionProviderSection.tsx
    @src/shared/types/meetings.ts
  </context>

  <task type="auto" n="1">
    <n>Backend — make transcription language configurable across all providers</n>
    <files>
      src/main/services/transcriptionService.ts
      src/main/services/deepgramTranscriber.ts
      src/main/services/assemblyaiTranscriber.ts
      src/shared/types/meetings.ts (or shared/types/index.ts)
    </files>
    <action>
      WHY: Language is hardcoded to 'en' in 3 services. We need to read a configurable
      language setting and pass it through to each provider, including an 'auto' mode
      for mixed-language recordings.

      1. Add a TranscriptionLanguage type to shared types:
         `type TranscriptionLanguage = 'en' | 'cs' | 'auto';`
         Add a TRANSCRIPTION_LANGUAGES constant array with {code, label} for UI use:
         [{ code: 'en', label: 'English' }, { code: 'cs', label: 'Czech (Čeština)' }, { code: 'auto', label: 'Auto-detect (mixed)' }]

      2. In transcriptionService.ts:
         - Add a module-level `activeLanguage: string = 'en'` variable
         - In `start()`: read the language setting from DB via settings table directly:
           ```typescript
           const db = getDb();
           const langRows = await db.select().from(settings).where(eq(settings.key, 'transcription:language'));
           activeLanguage = langRows.length > 0 ? langRows[0].value : 'en';
           ```
         - In `dispatchToWhisper()`: replace `language: 'en'` with:
           - If activeLanguage === 'auto': omit the language option entirely (Whisper auto-detects)
           - Otherwise: `language: activeLanguage`
         - In `dispatchToApi()`: pass activeLanguage to the cloud transcriber functions

      3. In deepgramTranscriber.ts:
         - Add `language` parameter to `transcribeSegment(pcmBuffer, startTimeMs, language)`
           and `transcribeFileWithDiarization(wavBuffer, language)`
         - Default language param to 'en' for backwards compatibility
         - For the URL: if language === 'auto', replace `language=en` with `detect_language=true`
         - Otherwise: use `language=${language}`

      4. In assemblyaiTranscriber.ts:
         - Add `language` parameter to `transcribeSegment(...)` and `transcribeFileWithDiarization(...)`
         - Default language param to 'en' for backwards compatibility
         - For the request body: if language === 'auto', replace `language_code: 'en'` with
           `language_detection: true`
         - Otherwise: `language_code: language`

      5. Update the file header comment in transcriptionService.ts to remove
         "English-only for v1 (language is hardcoded)"
    </action>
    <verify>
      - `npx tsc --noEmit` passes with no errors
      - All 5 hardcoded 'en' occurrences are replaced with dynamic language
      - transcribeSegment and transcribeFileWithDiarization accept language param
      - 'auto' mode correctly omits language for Whisper and uses detect_language for APIs
      - `npm test` passes (150 tests)
    </verify>
    <done>
      All 3 transcription providers accept configurable language.
      'auto' mode enables per-segment language detection for mixed recordings.
      No hardcoded 'en' remains in transcription code.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - settings table is importable and queryable in transcriptionService
      - Deepgram Nova-2 supports Czech ('cs') and detect_language param
      - AssemblyAI supports language_detection: true for auto-detect
      - @fugood/whisper.node auto-detects when language option is omitted
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>UI — language selector in RecordingControls + default in Settings + model warnings</n>
    <files>
      src/renderer/components/RecordingControls.tsx
      src/renderer/components/settings/TranscriptionProviderSection.tsx
      src/main/ipc/recording.ts (add whisper:get-active-model IPC)
      src/preload/domains/meetings.ts (or appropriate preload file)
      src/shared/types/electron-api.d.ts (or wherever ElectronAPI is defined)
    </files>
    <action>
      WHY: Users need to choose the transcription language per-recording and set a default.
      Critical: must warn when English-only Whisper model is selected with non-English language.

      1. Add IPC to check active whisper model:
         - In recording.ts (or a new whisper IPC file): add handler `whisper:get-active-model`
           that returns the model filename string from whisperModelManager.getDefaultModelPath()
           (extract basename) or null if no model.
         - Add to preload bridge + ElectronAPI type.

      2. RecordingControls.tsx — add language dropdown:
         - Import TRANSCRIPTION_LANGUAGES from shared types
         - Add state: `const [selectedLanguage, setSelectedLanguage] = useState('en');`
         - On mount, load default from settings:
           `const savedLang = await window.electronAPI.getSetting('transcription:language');`
           `if (savedLang) setSelectedLanguage(savedLang);`
         - Add a `<select>` for language between the template selector and microphone toggle:
           Options: map TRANSCRIPTION_LANGUAGES to option elements
         - When language changes, save to settings immediately (becomes new default):
           `await window.electronAPI.setSetting('transcription:language', value);`
         - Style: same as existing selects (w-full, same classes)

      3. Model compatibility warning in RecordingControls:
         - On mount (and when selectedLanguage changes), check the active whisper model name
         - If model name contains '.en' AND selectedLanguage !== 'en':
           Show amber warning below the language selector:
           "Current Whisper model ({modelName}) is English-only. Download a multilingual
           model in Settings for {language} transcription."
         - Only show when transcription provider is 'local' (not relevant for cloud APIs)

      4. TranscriptionProviderSection.tsx — add default language selector:
         - Below the provider radio buttons, before Test Connection, add "Transcription Language"
         - Import TRANSCRIPTION_LANGUAGES
         - Load current value from settings on mount, save on change
         - If provider is 'local', show same model compatibility warning
         - Add helper text: "For mixed Czech/English meetings, use 'Auto-detect' with a
           multilingual Whisper model."
    </action>
    <verify>
      - `npx tsc --noEmit` passes
      - RecordingControls shows language dropdown with 3 options
      - Changing language saves to settings (persists across restarts)
      - Settings page shows language selector in Transcription Provider section
      - Amber warning shows when .en model + non-English language + local provider
      - Warning does NOT show when using cloud providers
      - `npm test` passes (150 tests)
    </verify>
    <done>
      Language selector visible in both RecordingControls and Settings.
      Selection persists via settings table.
      Model compatibility warning shows when .en model + non-English + local provider.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - getSetting/setSetting IPC already works (verified in codebase)
      - whisperModelManager.getDefaultModelPath() returns full path (basename extractable)
      - .en suffix in model filename reliably indicates English-only model
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Per-recording language storage + transcription service reads from meeting record</n>
    <files>
      src/main/db/schema/meetings.ts
      src/shared/types/meetings.ts
      src/shared/validation/schemas.ts
      src/main/services/meetingService.ts
      src/main/services/transcriptionService.ts
      src/renderer/stores/recordingStore.ts
      src/renderer/components/RecordingControls.tsx
      src/renderer/components/MeetingDetailModal.tsx (or equivalent meeting detail view)
      drizzle/ (new migration)
    </files>
    <action>
      WHY: Each recording should store its language setting so the transcription service
      uses exactly what was selected at recording time (not whatever the global default
      happens to be), and so users can see what language was used when reviewing past meetings.

      1. Schema migration (next available number):
         - Add `transcriptionLanguage` varchar(10) column to meetings table, nullable
         - null = legacy meetings before this feature (treated as 'en')
         - Ensure migration journal timestamp is monotonically increasing (PGlite constraint)

      2. Update CreateMeetingInput type + validation schema:
         - Add `transcriptionLanguage?: string` to CreateMeetingInput interface
         - Add to Zod schema: `transcriptionLanguage: z.string().max(10).optional()`

      3. meetingService.createMeeting:
         - Accept and persist transcriptionLanguage from input

      4. recordingStore.startRecording:
         - Add `language?: string` parameter
         - Pass to createMeeting as transcriptionLanguage
         - In RecordingControls, pass selectedLanguage to startRecording()

      5. transcriptionService.start():
         - Accept optional `language?: string` parameter
         - If provided, use it as activeLanguage
         - If not provided (backwards compat), fall back to reading from settings
         - Update audioProcessor.startRecording to query the meeting's language and pass it

      6. Display in meeting detail view:
         - Show the transcription language as a small metadata item
         - e.g., "Language: English" or "Language: Auto-detect"
         - Use TRANSCRIPTION_LANGUAGES to look up the display label
         - Only show when transcriptionLanguage is not null (hide for legacy meetings)
    </action>
    <verify>
      - Migration generates and runs without errors (check drizzle journal timestamps)
      - `npx tsc --noEmit` passes
      - New meetings have transcriptionLanguage populated in DB
      - transcriptionService uses per-meeting language (not just global setting)
      - Meeting detail view shows language for new meetings
      - Legacy meetings (null transcriptionLanguage) don't show language badge
      - `npm test` passes (150 tests)
    </verify>
    <done>
      Each meeting stores its transcription language.
      Full pipeline: UI selection → meeting record → audioProcessor → transcriptionService → provider.
      Past meetings display what language was used.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Next migration number is available (check drizzle journal for latest)
      - meetingService.createMeeting can accept the new field via spread/insert
      - audioProcessor can query meetingService for the meeting's language before starting transcription
    </assumptions>
  </task>

</phase>
