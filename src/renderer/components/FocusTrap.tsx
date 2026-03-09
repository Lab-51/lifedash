// === FILE PURPOSE ===
// Thin wrapper around focus-trap-react that standardizes focus trap behavior
// across all modals. Traps Tab/Shift+Tab within the modal, closes on Escape,
// and restores focus to the trigger element when deactivated.

import FocusTrapReact from 'focus-trap-react';
import type { FocusTrapProps as FocusTrapReactProps } from 'focus-trap-react';

interface FocusTrapProps {
  children: React.ReactNode;
  /** Whether the trap is active (typically tied to modal open state) */
  active: boolean;
  /** Called when the trap deactivates (Escape key or clickOutside) */
  onDeactivate: () => void;
  /** Allow clicking outside the trap to deactivate it (default: true) */
  clickOutsideDeactivates?: boolean;
  /**
   * Custom escapeDeactivates — pass a function for conditional Escape handling
   * (e.g., skip Escape when focus is in an input/textarea/contenteditable).
   * Pass `true` for default behavior, `false` to disable Escape entirely.
   * Default: true
   */
  escapeDeactivates?: boolean | ((e: KeyboardEvent) => boolean);
}

export default function FocusTrap({
  children,
  active,
  onDeactivate,
  clickOutsideDeactivates = true,
  escapeDeactivates = true,
}: FocusTrapProps) {
  const focusTrapOptions: FocusTrapReactProps['focusTrapOptions'] = {
    // Let each modal handle its own initial focus (autoFocus inputs, etc.)
    initialFocus: false,
    // Restore focus to the element that opened the modal
    returnFocusOnDeactivate: true,
    // Use the trap container itself as fallback if no focusable elements exist
    fallbackFocus: () => {
      // Return the container element itself — focus-trap requires a valid fallback
      const container = document.querySelector('[data-focus-trap-container]');
      return (container as HTMLElement) || document.body;
    },
    escapeDeactivates,
    clickOutsideDeactivates,
    onDeactivate,
    // Prevent focus-trap from throwing when there are no tabbable elements
    allowOutsideClick: true,
  };

  return (
    <FocusTrapReact active={active} focusTrapOptions={focusTrapOptions}>
      <div data-focus-trap-container tabIndex={-1} style={{ display: 'contents' }}>
        {children}
      </div>
    </FocusTrapReact>
  );
}
