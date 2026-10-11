// @vitest-environment jsdom
// === FILE PURPOSE ===
// TWIN-LOOP.2 Task 6 (c): closing the wizard while "Build from my history" is mining
// stops the main-side run (twinResearchCancel). The REAL wizard and REAL research panel
// are mounted; only the electronAPI bridge and the web sub-section are doubles.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../twin/TwinWebResearchSection', () => ({ default: () => null }));

const twinGetProfile = vi.fn();
const twinResearchHistoryInfo = vi.fn();
const twinResearchHistory = vi.fn();
const twinResearchCancel = vi.fn();
vi.stubGlobal('electronAPI', { twinGetProfile, twinResearchHistoryInfo, twinResearchHistory, twinResearchCancel });

const { default: TwinWizard } = await import('../TwinWizard');

beforeEach(() => {
  vi.clearAllMocks();
  twinGetProfile.mockResolvedValue(null);
  twinResearchCancel.mockResolvedValue(true);
  twinResearchHistoryInfo.mockResolvedValue({
    excerptCount: 1,
    briefCount: 0,
    projectCount: 0,
    cardCount: 0,
    providerLabel: 'lmstudio',
    isLocal: true,
  });
});

describe('TwinWizard - closing during history mining', () => {
  it('unmounting the wizard while mining is in flight calls twinResearchCancel', async () => {
    twinResearchHistory.mockReturnValue(new Promise(() => {})); // the model never answers
    const { unmount } = render(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} initialMode="history" />);

    fireEvent.click(await screen.findByRole('button', { name: /mine my history/i }));
    await vi.waitFor(() => expect(twinResearchHistory).toHaveBeenCalledTimes(1));
    expect(twinResearchCancel).not.toHaveBeenCalled();

    unmount();

    expect(twinResearchCancel).toHaveBeenCalledTimes(1);
  });

  it('closing the wizard before mining starts cancels nothing', async () => {
    const { unmount } = render(<TwinWizard onClose={vi.fn()} onComplete={vi.fn()} initialMode="history" />);
    await screen.findByRole('button', { name: /mine my history/i });
    unmount();
    expect(twinResearchCancel).not.toHaveBeenCalled();
  });
});
