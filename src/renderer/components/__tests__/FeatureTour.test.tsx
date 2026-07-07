// @vitest-environment jsdom
// Regression tests for the V3.1 review finding #1: TOUR_STEPS must match the
// collapsed 3-entry IA (Sessions / Twin / Settings) and a spotlight target that
// isn't in the DOM must degrade to a centered tooltip instead of collapsing to
// an unstyled top-left corner.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.stubGlobal('electronAPI', {
  setSetting: vi.fn().mockResolvedValue(undefined),
});

const { default: FeatureTour } = await import('../FeatureTour');

function tooltipFor(text: string) {
  const el = screen.getByText(text);
  return el.closest('.tour-tooltip') as HTMLElement;
}

describe('FeatureTour', () => {
  it('renders the welcome step centered (no spotlight) on first render', () => {
    render(<FeatureTour onComplete={vi.fn()} />);
    expect(screen.getByText('Welcome to LifeDash')).toBeInTheDocument();
    expect(tooltipFor('Welcome to LifeDash')).toHaveStyle({ top: '50%', left: '50%' });
  });

  it('degrades a missing spotlight target to a centered tooltip instead of jamming top-left', () => {
    // No element with data-tour-id="nav-sessions" exists in this test's DOM --
    // simulates a future nav change removing the anchor the tour points at.
    render(<FeatureTour onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Sessions — your meetings, captured')).toBeInTheDocument();
    expect(tooltipFor('Sessions — your meetings, captured')).toHaveStyle({ top: '50%', left: '50%' });
  });

  it('spotlights and positions the tooltip beside the anchor when it exists in the DOM', () => {
    const anchor = document.createElement('div');
    anchor.setAttribute('data-tour-id', 'nav-sessions');
    document.body.appendChild(anchor);

    try {
      render(<FeatureTour onComplete={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      const tooltip = tooltipFor('Sessions — your meetings, captured');
      // Once a real anchor is found, the tooltip switches out of the centered
      // (top:50%/left:50%) layout to a spotlight-relative position.
      expect(tooltip.style.top).not.toBe('50%');
      expect(tooltip.style.left).not.toBe('50%');
    } finally {
      document.body.removeChild(anchor);
    }
  });

  it('only references the current 3-entry IA -- no retired Intel/Projects/Brainstorm/Ideas/Focus steps', () => {
    render(<FeatureTour onComplete={vi.fn()} />);
    const retiredStepTitles = [
      /stay informed/i,
      /from insight to execution/i,
      /think with ai/i,
      /capture ideas on the fly/i,
      /track deep work/i,
    ];
    for (const pattern of retiredStepTitles) {
      expect(screen.queryByText(pattern)).toBeNull();
    }
  });

  it('marks the tour completed and calls onComplete(false) via Skip tour', async () => {
    const onComplete = vi.fn();
    render(<FeatureTour onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Skip tour'));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(false));
    expect(window.electronAPI.setSetting).toHaveBeenCalledWith('featureTour.completed', 'true');
  });
});
