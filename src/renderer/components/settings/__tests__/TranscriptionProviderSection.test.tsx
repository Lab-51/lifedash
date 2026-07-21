// @vitest-environment jsdom
// === FILE PURPOSE ===
// Behavior tests for the consent gate + local-only toggle wiring in
// TranscriptionProviderSection (GUARD.1 Task 4):
//   - switching FROM local TO a cloud provider opens the consent dialog and does
//     NOT persist until confirmed,
//   - declining keeps the selection local (transcriptionSetProvider not called),
//   - confirming persists the cloud provider,
//   - enabling the local-only toggle persists the setting and disables the cloud
//     provider rows.
// window.electronAPI is stubbed; the real IPC/enforcement is covered by the
// main-side service tests.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const transcriptionGetConfig = vi.fn();
const transcriptionSetProvider = vi.fn();
const getSetting = vi.fn();
const setSetting = vi.fn();
const getWhisperModels = vi.fn();
const whisperGetActiveModel = vi.fn();
const getWhisperBackend = vi.fn();
const onWhisperDownloadProgress = vi.fn();

let localOnlyStored = 'false';

vi.stubGlobal('electronAPI', {
  transcriptionGetConfig,
  transcriptionSetProvider,
  transcriptionSetApiKey: vi.fn(),
  transcriptionTestProvider: vi.fn(),
  getSetting,
  setSetting,
  getWhisperModels,
  whisperGetActiveModel,
  getWhisperBackend,
  onWhisperDownloadProgress,
  downloadWhisperModel: vi.fn(),
  whisperSetActiveModel: vi.fn(),
});

import TranscriptionProviderSection from '../TranscriptionProviderSection';

beforeEach(() => {
  vi.clearAllMocks();
  localOnlyStored = 'false';
  transcriptionGetConfig.mockResolvedValue({
    type: 'local',
    hasDeepgramKey: true,
    hasAssemblyaiKey: false,
    localModelAvailable: true,
  });
  transcriptionSetProvider.mockResolvedValue(undefined);
  setSetting.mockResolvedValue(undefined);
  getSetting.mockImplementation(async (key: string) => {
    if (key === 'transcription:localOnly') return localOnlyStored;
    return null;
  });
  getWhisperModels.mockResolvedValue([]);
  whisperGetActiveModel.mockResolvedValue(null);
  getWhisperBackend.mockResolvedValue('cpu');
  onWhisperDownloadProgress.mockReturnValue(() => {});
});

async function renderLoaded() {
  render(<TranscriptionProviderSection />);
  // Wait for the async config load to render the provider radios.
  return screen.findByRole('radio', { name: 'Deepgram' });
}

describe('TranscriptionProviderSection — cloud consent gate', () => {
  it('opens the consent dialog on a local -> cloud switch and does not persist yet', async () => {
    const deepgram = await renderLoaded();
    fireEvent.click(deepgram);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getAllByText(/Deepgram/).length).toBeGreaterThan(0);
    // Nothing persisted until the user confirms.
    expect(transcriptionSetProvider).not.toHaveBeenCalled();
  });

  it('declining keeps the selection local (no provider change persisted)', async () => {
    const deepgram = await renderLoaded();
    fireEvent.click(deepgram);
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(transcriptionSetProvider).not.toHaveBeenCalled();
  });

  it('confirming persists the cloud provider', async () => {
    const deepgram = await renderLoaded();
    fireEvent.click(deepgram);
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: /send to deepgram/i }));

    await waitFor(() => expect(transcriptionSetProvider).toHaveBeenCalledWith('deepgram'));
  });
});

describe('TranscriptionProviderSection — local-only toggle', () => {
  it('persists the setting and disables the cloud provider rows when enabled', async () => {
    await renderLoaded();
    const toggle = await screen.findByRole('checkbox', { name: /local-only/i });

    // Cloud rows start enabled…
    expect(screen.getByRole('radio', { name: 'Deepgram' })).not.toBeDisabled();
    expect(screen.getByRole('radio', { name: 'AssemblyAI' })).not.toBeDisabled();

    fireEvent.click(toggle);

    // …the setting is persisted…
    await waitFor(() => expect(setSetting).toHaveBeenCalledWith('transcription:localOnly', 'true'));
    // …and the cloud rows become disabled (local stays selectable).
    expect(screen.getByRole('radio', { name: 'Deepgram' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'AssemblyAI' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Local (Whisper)' })).not.toBeDisabled();
  });

  it('renders cloud rows disabled when local-only was already on at load', async () => {
    localOnlyStored = 'true';
    await renderLoaded();

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Deepgram' })).toBeDisabled());
  });
});
