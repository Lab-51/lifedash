// @vitest-environment jsdom
// === FILE PURPOSE ===
// Tests the Digital Twin mode-choice SOTA gate + one-tap (V3.3.5 Task 6, finding
// #6.2). Proves: a user whose only configured frontier provider is Gemini gets a
// one-tap "Use <Gemini>" that writes the twin_interview task-model setting to
// gemini-2.5-flash (previously Gemini had NO default model, so no one-tap appeared);
// and when NO frontier provider is configured the notice points at Settings instead
// of rendering a dead notice. Quick form is never gated.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import { useSettingsStore } from '../../../stores/settingsStore';
import type { AIProvider } from '../../../../shared/types/ai';
import type { TwinCreationModel } from '../../../../shared/types/twin';

const twinGetCreationModel = vi.fn();
const getAIProviders = vi.fn();
const getAllSettings = vi.fn();
const setSetting = vi.fn();

vi.stubGlobal('electronAPI', { twinGetCreationModel, getAIProviders, getAllSettings, setSetting });

const { default: TwinModeChoice } = await import('../TwinModeChoice');

const LOCAL_MODEL: TwinCreationModel = {
  providerLabel: 'ollama',
  modelLabel: 'llama3.2',
  isLocal: true,
  isFrontier: false,
};

function geminiProvider(): AIProvider {
  return {
    id: 'g1',
    name: 'google',
    displayName: 'My Gemini',
    enabled: true,
    hasApiKey: true,
    baseUrl: null,
    createdAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
  };
}

function renderChoice() {
  return render(
    <MemoryRouter>
      <TwinModeChoice brief="" onBriefChange={vi.fn()} onChoose={vi.fn()} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ providers: [], settings: {} });
  twinGetCreationModel.mockResolvedValue(LOCAL_MODEL); // gated (non-frontier)
  getAllSettings.mockResolvedValue({});
  setSetting.mockResolvedValue(undefined);
});

describe('TwinModeChoice — Gemini one-tap (finding #6.2)', () => {
  it('offers a one-tap "Use <Gemini>" writing twin_interview → gemini-2.5-flash', async () => {
    getAIProviders.mockResolvedValue([geminiProvider()]);
    renderChoice();

    // Gated deep cards each carry the one-tap now that google has a default model.
    const useBtns = await screen.findAllByRole('button', { name: /use my gemini/i });
    expect(useBtns.length).toBeGreaterThan(0);

    fireEvent.click(useBtns[0]);
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalled());
    const [key, value] = setSetting.mock.calls[0] as [string, string];
    expect(key).toBe('ai.taskModels');
    expect(JSON.parse(value).twin_interview).toEqual({ providerId: 'g1', model: 'gemini-2.5-flash' });
  });

  it('points at Settings (no dead notice) when NO frontier provider is configured', async () => {
    getAIProviders.mockResolvedValue([]);
    renderChoice();

    // The SOTA notice still shows, but with a Settings pointer instead of a one-tap.
    expect(await screen.findAllByText(/state-of-the-art model/i)).not.toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /set up a frontier model in settings/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^use /i })).toBeNull();
    // Quick form is never gated.
    expect(screen.getByRole('button', { name: /start quick form/i })).toBeInTheDocument();
  });
});
