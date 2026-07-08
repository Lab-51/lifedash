// @vitest-environment jsdom
// === FILE PURPOSE ===
// Tests the cloud-consent dialog for "Build from my history" (V3.3.5 Task 3):
// it states the exact counts + provider that would be sent, is a labelled modal
// with Escape-to-cancel and focus opening on the safe (Cancel) action, and calls
// onConfirm/onCancel from its labelled buttons. This is the per-run privacy gate —
// nothing may leave the machine without an explicit Confirm.

import { describe, it, expect, vi } from 'vitest';
import { useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import TwinResearchConsentDialog from '../TwinResearchConsentDialog';
import type { TwinResearchHistoryInfo } from '../../../../shared/types/twin';

const info: TwinResearchHistoryInfo = {
  excerptCount: 3,
  briefCount: 1,
  projectCount: 2,
  cardCount: 5,
  providerLabel: 'openai',
  isLocal: false,
};

describe('TwinResearchConsentDialog', () => {
  it('is a labelled modal that states the provider and exact counts', () => {
    render(<TwinResearchConsentDialog info={info} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(screen.getByText('openai')).toBeInTheDocument();
    // The full "what will be sent" summary, pluralized.
    expect(screen.getByText(/3 meeting excerpts, 1 brief, 2 projects and 5 cards/)).toBeInTheDocument();
  });

  it('opens focus on Cancel (the safe, non-sending default)', () => {
    render(<TwinResearchConsentDialog info={info} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /cancel/i })).toHaveFocus();
  });

  it('confirms and cancels via the labelled buttons', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<TwinResearchConsentDialog info={info} onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: /send & build/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    render(<TwinResearchConsentDialog info={info} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the trigger when it closes (WCAG 2.4.3, finding #6.5)', () => {
    function Harness() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(true);
      return (
        <>
          <button ref={triggerRef} type="button">
            Mine my history
          </button>
          {open && (
            <TwinResearchConsentDialog
              info={info}
              onConfirm={vi.fn()}
              onCancel={() => setOpen(false)}
              returnFocusRef={triggerRef}
            />
          )}
        </>
      );
    }
    render(<Harness />);

    // Focus opens on Cancel…
    expect(screen.getByRole('button', { name: /cancel/i })).toHaveFocus();
    // …and returns to the opener when the dialog closes (not dropped to <body>).
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByRole('button', { name: /mine my history/i })).toHaveFocus();
  });
});
