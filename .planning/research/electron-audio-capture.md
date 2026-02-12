# Electron Audio Capture Research

## Summary
Electron's `desktopCapturer` API has limited audio capture support. The recommended approach is **`electron-audio-loopback`** (npm package, MIT license) which wraps platform-native APIs (WASAPI on Windows, ScreenCaptureKit/CoreAudio on macOS, PulseAudio on Linux) and provides a simple `getLoopbackAudioMediaStream()` API.

## Key Findings

### desktopCapturer API
- Provides access to media sources for capturing audio/video from the desktop
- Uses `navigator.mediaDevices.getUserMedia` under the hood
- Supports `loopback` audio for system sound capture
- Docs: https://www.electronjs.org/docs/latest/api/desktop-capturer

### Windows (Primary Target)
- **System audio capture works** via desktopCapturer with loopback
- Can capture application audio (Zoom, Teams, Meet running in browser or desktop apps)
- Uses WASAPI under the hood for audio capture
- **VERIFIED**: Windows support is the most mature

### macOS (Secondary)
- `navigator.mediaDevices.getUserMedia` does NOT work for audio capture on macOS
- Fundamental limitation: apps need a signed kernel extension for system audio
- On macOS 12.3+, `navigator.mediaDevices.getDisplayMedia` can capture system audio
- Recent (June 2025) work on ScreenCaptureKit API integration for improved loopback audio
- **LIMITATION**: More complex, requires user permission prompt

### Linux
- Support varies by distro and audio system (PulseAudio/PipeWire)
- Generally works but less tested
- **UNVERIFIED**: Specific behavior not confirmed

## Implementation Approach

```typescript
// Basic pattern for system audio capture in Electron
const sources = await desktopCapturer.getSources({ types: ['screen'] });
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    mandatory: {
      chromeMediaSource: 'desktop'
    }
  },
  video: false // audio-only for meeting capture
});
```

## Key Discovery: electron-audio-loopback

**Package:** `electron-audio-loopback` (MIT license, actively maintained)
**GitHub:** https://github.com/alectrocute/electron-audio-loopback

This package is the recommended solution. It:
- Wraps WASAPI (Windows), ScreenCaptureKit/CoreAudio (macOS), PulseAudio (Linux)
- Provides `getLoopbackAudioMediaStream()` returning a standard MediaStream
- Includes prebuilt binaries (no node-gyp compilation needed)
- Requires Electron >= 31.0.1

```typescript
// Main process
import { initMain } from 'electron-audio-loopback';
initMain();

// Renderer process
const stream = await getLoopbackAudioMediaStream();
const audioTrack = stream.getAudioTracks()[0];
// Use with Web Audio API, MediaRecorder, etc.
```

**macOS 15.0+ workaround** (ScreenCaptureKit broken):
```typescript
const stream = await getLoopbackAudioMediaStream({ forceCoreAudioTap: true });
```

## Audio Processing Pipeline
```
System Audio → electron-audio-loopback → Web Audio API (resample 48kHz→16kHz)
  → MediaRecorder (encode WAV) → Buffer (10s chunks) → Whisper → Transcript
```

**Format conversion needed:**
- System audio: 48kHz stereo 32-bit float
- Whisper expects: 16kHz mono 16-bit PCM
- Web Audio API handles resampling

## Recommendations for Living Dashboard
1. **Use `electron-audio-loopback`** as the primary audio capture solution
2. **Target Windows first** — best WASAPI support
3. Stream audio to Web Audio API for resampling/processing before feeding to Whisper
4. Add macOS support (with CoreAudio tap fallback for macOS 15+)
5. Reference project: `mic-speaker-streamer` by same author shows real-time audio → OpenAI streaming

## Risks
- Audio quality depends on system audio settings
- USB audio devices may not work reliably on Windows (WASAPI limitation)
- macOS 15.0+ requires CoreAudio fallback (ScreenCaptureKit broken)
- Linux requires PipeWire (PulseAudio not well supported in Electron)
- No per-application audio capture — captures system mix
- Need to handle audio dropout gracefully during meetings

## Sources
- https://www.electronjs.org/docs/latest/api/desktop-capturer
- https://github.com/alectrocute/electron-audio-loopback
- https://github.com/alectrocute/mic-speaker-streamer
- https://github.com/electron/electron/issues/47490
- https://github.com/electron/electron/issues/25120
- https://github.com/electron/electron/pull/47493
