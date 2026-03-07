// === Whisper model management types ===

export interface WhisperModel {
  name: string;           // e.g., 'base.en'
  fileName: string;       // e.g., 'ggml-base.en.bin'
  size: string;           // Human-readable: '74 MB'
  description: string;
  available: boolean;     // true if downloaded locally
  recommended: boolean;   // show in UI model picker
}

export interface WhisperDownloadProgress {
  fileName: string;
  downloaded: number;     // bytes
  total: number;          // bytes
  percent: number;        // 0-100
}
