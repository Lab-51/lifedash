// === FILE PURPOSE ===
// Pure Node.js WAV header construction for mono 16kHz 16-bit PCM audio.

/**
 * Build a 44-byte RIFF/WAVE header for mono, 16 kHz, 16-bit signed PCM.
 * @param dataSize Total PCM byte count (0 for a placeholder header).
 */
export function createWavHeader(dataSize: number): Buffer {
  const header = Buffer.alloc(44);

  header.write('RIFF', 0); // ChunkID
  header.writeUInt32LE(dataSize + 36, 4); // ChunkSize
  header.write('WAVE', 8); // Format
  header.write('fmt ', 12); // Subchunk1ID
  header.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  header.writeUInt16LE(1, 22); // NumChannels (mono)
  header.writeUInt32LE(16_000, 24); // SampleRate
  header.writeUInt32LE(32_000, 28); // ByteRate (16000 * 1 * 2)
  header.writeUInt16LE(2, 32); // BlockAlign (1 * 2)
  header.writeUInt16LE(16, 34); // BitsPerSample
  header.write('data', 36); // Subchunk2ID
  header.writeUInt32LE(dataSize, 40); // Subchunk2Size

  return header;
}

/** Prepend a WAV header to raw PCM data and return a complete .wav buffer. */
export function pcmToWavBuffer(pcmBuffer: Buffer): Buffer {
  return Buffer.concat([createWavHeader(pcmBuffer.byteLength), pcmBuffer]);
}
