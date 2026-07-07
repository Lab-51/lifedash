// @vitest-environment jsdom
// Migration fix D: under the session-centric IA there is no standalone project-create
// surface, so the command palette's "New Project..." action (which routed to the now-
// retired /projects?action=create and dead-ended on the home redirect) was removed.
// The sibling create actions remain.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// jsdom doesn't implement scrollIntoView (the palette scrolls the selected row into view).
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = vi.fn();
}

vi.stubGlobal('electronAPI', {
  searchTranscripts: vi.fn().mockResolvedValue([]),
});

const { default: CommandPalette } = await import('../CommandPalette');

function renderPalette() {
  return render(<CommandPalette isOpen onClose={() => {}} navigate={vi.fn()} />);
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no longer offers a "New Project..." command (projects are created from a session)', () => {
    renderPalette();
    expect(screen.queryByText('New Project...')).toBeNull();
  });

  it('still offers the sibling create action ("New Idea...")', () => {
    renderPalette();
    expect(screen.getByText('New Idea...')).toBeInTheDocument();
  });
});
