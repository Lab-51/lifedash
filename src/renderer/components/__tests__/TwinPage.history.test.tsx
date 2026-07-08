// @vitest-environment jsdom
// === FILE PURPOSE ===
// Tests TwinPage's V3.3.5 "Build from my history" entry affordance (Task 3): it is
// offered both in the populated-profile header and from the empty state, and each
// opens the creation wizard (which lands on its mode-choice screen — the direct
// history-mode open is left to Task 6 since TwinWizard has no initialMode prop).
// window.electronAPI is mocked; the wizard's own flow is covered by its own tests.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { TwinProfile } from '../../../shared/types/twin';

const twinGetProfile = vi.fn();
const twinGetCreationModel = vi
  .fn()
  .mockResolvedValue({ providerLabel: 'openai', modelLabel: 'gpt-5-mini', isLocal: false, isFrontier: true });

vi.stubGlobal('electronAPI', {
  twinGetProfile,
  twinUpdateProfileSection: vi.fn(),
  twinDraftSection: vi.fn(),
  twinGetCreationModel,
  getAIProviders: vi.fn().mockResolvedValue([]),
  getAllSettings: vi.fn().mockResolvedValue({}),
});

const { default: TwinPage } = await import('../TwinPage');

function fullProfile(): TwinProfile {
  return {
    brief: {},
    identity: { name: 'Jane', role: 'PM' },
    domain: {},
    projects: [],
    people: [],
    vocabulary: [],
    goals: [],
    preferences: {},
    updatedAt: '2026-07-08T12:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TwinPage — "Build from my history" entry', () => {
  it('offers it in the header of a populated profile and opens the wizard', async () => {
    twinGetProfile.mockResolvedValue(fullProfile());
    render(<TwinPage />);
    await screen.findByText(/Mirrors Jane/);

    fireEvent.click(screen.getByRole('button', { name: /build from my history/i }));
    expect(await screen.findByRole('heading', { name: /refine your twin/i })).toBeInTheDocument();
  });

  it('offers it from the empty state and opens the wizard', async () => {
    twinGetProfile.mockResolvedValue(null);
    render(<TwinPage />);

    fireEvent.click(await screen.findByRole('button', { name: /build from my history/i }));
    expect(await screen.findByRole('heading', { name: /set up your twin/i })).toBeInTheDocument();
  });
});
