// @vitest-environment jsdom
// Migration fix E: Ctrl+4 ("Projects") was removed from the digit-shortcut map. The
// /projects route now redirects to `/`, so the shortcut just landed on Sessions home;
// projects live only inside sessions, with no standalone page to jump to. The other
// digit shortcuts are unaffected.
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { NavigateFunction } from 'react-router-dom';
import useKeyboardShortcuts from '../useKeyboardShortcuts';

function Harness({ navigate }: { navigate: NavigateFunction }) {
  useKeyboardShortcuts(navigate);
  return null;
}

function pressCtrl(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }));
}

describe('useKeyboardShortcuts', () => {
  it('Ctrl+4 no longer navigates to /projects (route retired in the IA collapse)', () => {
    const navigate = vi.fn() as unknown as NavigateFunction;
    render(<Harness navigate={navigate} />);
    pressCtrl('4');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('still maps a surviving digit shortcut (control: Ctrl+2 → /meetings)', () => {
    const navigate = vi.fn() as unknown as NavigateFunction;
    render(<Harness navigate={navigate} />);
    pressCtrl('2');
    expect(navigate).toHaveBeenCalledWith('/meetings');
  });
});
