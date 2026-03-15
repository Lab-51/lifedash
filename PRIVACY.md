# Privacy Policy

LifeDash is designed with privacy as a core principle. Your data stays on your machine unless you explicitly choose otherwise.

## Data Storage

All data is stored locally on your machine in an embedded PostgreSQL database (PGlite). Database files are kept in Electron's userData directory. Nothing is sent to external servers by default.

## AI API Keys

Your API keys are stored locally and encrypted using your operating system's secure storage (Windows DPAPI, macOS Keychain, or Linux libsecret). Keys are only transmitted to the AI provider you configured (OpenAI, Anthropic, Deepgram, AssemblyAI, etc.) when you actively use AI features. Keys are never sent anywhere else.

## Meeting Recordings

Audio files are saved locally in the directory you choose. Transcription can be performed entirely on your machine using Whisper, or via a cloud transcription API — the choice is yours in Settings.

## Cloud Sync (Optional)

If you enable Cloud Sync, your data syncs to a Supabase backend under your authenticated account. You can disable sync at any time in Settings. No data leaves your machine unless you explicitly enable this feature and sign in.

## Crash Reporting (Optional)

If you opt in via Settings, anonymous crash reports are sent to Sentry to help improve LifeDash. Personal data — including file paths, usernames, and home directory paths — is stripped before transmission. Crash reporting is disabled by default.

## Analytics

LifeDash does not collect usage analytics, telemetry, or behavioral data. There are no tracking pixels, no third-party analytics SDKs, and no data shared with advertisers.

## Data Deletion

You can delete all local data by:
- Removing the app's userData directory (see Settings > About for the path)
- Uninstalling the application

If you used Cloud Sync, you can delete your synced data by signing into your account and requesting deletion.

## Open Source

LifeDash is open source. You can inspect the complete source code to verify these privacy claims.
