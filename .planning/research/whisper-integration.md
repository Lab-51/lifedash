# Whisper Integration Research

## Summary
Local Whisper transcription is feasible in Electron via whisper.cpp Node.js bindings. Real-time transcription requires a chunking approach (not true streaming). Multiple API alternatives exist for higher quality.

## Key Findings

### Local Options (Node.js)

| Package | Status | GPU | PCM Streaming | Notes |
|---------|--------|-----|---------------|-------|
| **`@kutalia/whisper-node-addon`** | **Active (Jan 2025)** | **Vulkan, CUDA, Metal** | **Yes** | **RECOMMENDED — best for real-time** |
| `@lumen-labs-dev/whisper-node` | Active (Feb 2025) | Yes | Yes | Good alternative |
| `nodejs-whisper` | Active (Sep 2024) | Yes | Yes | CPU-optimized, stable |
| `smart-whisper` | Active | Yes | Yes | Auto-model management |
| `whisper-node` (original) | Stale (Aug 2024) | Yes | Limited | Legacy — avoid for new projects |

**`@kutalia/whisper-node-addon` advantages:**
- Cross-platform prebuilt binaries (no node-gyp needed)
- GPU acceleration: Vulkan (Intel/AMD), CUDA (NVIDIA), Metal (Apple)
- Accepts raw PCM audio (16kHz, 16-bit mono) directly
- English-only model variants (`.en`) are 20-30% faster

### Real-Time Transcription
- **Whisper is NOT a streaming model** — it processes fixed-length audio chunks
- Real-time approach: capture audio in chunks (5-30 seconds), transcribe each chunk
- `whisper.rn` (React Native) has best real-time support with VAD (Voice Activity Detection)
- For Electron: implement audio chunking + queue system
- Latency: expect 2-10 seconds delay depending on model size and hardware

### Model Sizes and Performance

| Model | Size | RAM | Speed (CPU) | Quality |
|-------|------|-----|-------------|---------|
| tiny | 39MB | ~1GB | Very fast | Basic |
| base | 74MB | ~1GB | Fast | Good for English |
| small | 244MB | ~2GB | Moderate | Good multilingual |
| medium | 769MB | ~5GB | Slow | Very good |
| large-v3 | 1.5GB | ~10GB | Very slow | Best |

### API Alternatives

| Provider | Price | Quality | Real-time | Notes |
|----------|-------|---------|-----------|-------|
| OpenAI Whisper API | $0.006/min | Excellent | No (batch) | Easiest integration |
| Deepgram | $0.0043/min | Excellent | Yes (WebSocket) | True real-time streaming |
| AssemblyAI | $0.00025/sec | Excellent | Yes (WebSocket) | Real-time + speaker diarization |

### Recommended Approach for Living Dashboard

1. **Default: Local whisper.cpp** via `@kutalia/whisper-node-addon`
   - Use `small` model (244MB, ~2GB RAM) for balance of speed/quality
   - English-only: use `small.en` for 20-30% faster processing
   - Chunk audio into 10-second segments with 2-second overlap
   - Process chunks in sequence via worker thread
   - GPU: 1-3 seconds latency; CPU-only: 10-30 seconds for 30s audio

2. **Premium: Deepgram or AssemblyAI API** for true real-time
   - WebSocket-based streaming
   - Speaker diarization (identify who's speaking)
   - Much better quality with less CPU usage

3. **Fallback: OpenAI Whisper API** for batch processing
   - Upload recording after meeting ends
   - Highest accuracy, lowest local resource usage

## Architecture Pattern

```
Audio Stream → Chunker (10s segments) → Queue → Whisper Worker → Text Accumulator → UI
                                          ↓
                                   (alternative: WebSocket → Deepgram API)
```

## Critical Constraint
- Audio MUST be exactly **16kHz, 16-bit, mono PCM** for Whisper
- System audio is typically 48kHz stereo 32-bit float → needs resampling
- Web Audio API in renderer can handle resampling

## Model Bundling Strategy
- `small` model = 1.4GB — too large for Electron installer
- Recommended: lazy download on first run (background, with progress bar)
- Store models in app data directory, not in app bundle
- Provide tier selector: "Fast (tiny)" vs "Balanced (small)" vs "Accurate (medium)"

## Risks
- Local Whisper on CPU can be slow for real-time (especially medium/large models)
- Audio quality significantly affects transcription accuracy
- Background noise from meetings reduces quality
- GPU acceleration requires proper drivers (CUDA/Vulkan/Metal)
- Model files are large (1-5GB) — first download is slow
- Memory leaks possible if models not properly released between transcriptions

## Sources
- https://www.npmjs.com/package/@kutalia/whisper-node-addon
- https://github.com/ariym/whisper-node
- https://www.npmjs.com/package/nodejs-whisper
- https://github.com/ggml-org/whisper.cpp/issues/1653
- https://www.assemblyai.com/blog/offline-speech-recognition-whisper-browser-node-js
- https://github.com/ufal/whisper_streaming
