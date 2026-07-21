// @vitest-environment jsdom
// === FILE PURPOSE ===
// Tests the cloud-transcription consent dialog (GUARD.1 Task 4): a labelled modal
// that names the cloud provider audio would be sent to, opens focus on the safe
// (Cancel) action, cancels on Escape, confirms/cancels via its labelled buttons,
// and restores focus to the opener on close. This is the privacy gate for a
// local -> cloud transcription switch.

import { describe, it, expect, vi } from 'vitest';
import { useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CloudTranscriptionConsentDialog from '../CloudTranscriptionConsentDialog';

describe('CloudTranscriptionConsentDialog', () => {
  it('is a labelled modal that names the cloud provider', () => {
    render(<CloudTranscriptionConsentDialog provider="deepgram" onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    // The provider name appears in the title and the body copy.
    expect(screen.getAllByText(/Deepgram/).length).toBeGreaterThan(0);
    expect(screen.getByText(/leaves your machine/i)).toBeInTheDocument();
  });

  it('names AssemblyAI when that is the target provider', () => {
    render(<CloudTranscriptionConsentDialog provider="assemblyai" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getAllByText(/AssemblyAI/).length).toBeGreaterThan(0);
  });

  it('opens focus on Cancel (the safe, non-sending default)', () => {
    render(<CloudTranscriptionConsentDialog provider="deepgram" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /cancel/i })).toHaveFocus();
  });

  it('confirms and cancels via the labelled buttons', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<CloudTranscriptionConsentDialog provider="deepgram" onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: /send to deepgram/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    render(<CloudTranscriptionConsentDialog provider="deepgram" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the trigger when it closes (WCAG 2.4.3)', () => {
    function Harness() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(true);
      return (
        <>
          <button ref={triggerRef} type="button">
            Switch to Deepgram
          </button>
          {open && (
            <CloudTranscriptionConsentDialog
              provider="deepgram"
              onConfirm={vi.fn()}
              onCancel={() => setOpen(false)}
              returnFocusRef={triggerRef}
            />
          )}
        </>
      );
    }
    render(<Harness />);

    expect(screen.getByRole('button', { name: /cancel/i })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByRole('button', { name: /switch to deepgram/i })).toHaveFocus();
  });
});
