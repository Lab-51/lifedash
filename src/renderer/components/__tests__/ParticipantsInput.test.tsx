// @vitest-environment jsdom
// ParticipantsInput (BRIEF-QUAL.1 Task 4) — comma-separated names tokenized
// into removable chips. Mirrors the participantNameSchema zod rules client-side
// (trim, 1-80 chars, max 24, no '@'), with a "names only" hint on a rejected
// email.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import ParticipantsInput from '../ParticipantsInput';

describe('ParticipantsInput', () => {
  it('renders existing chips with a remove button per chip', () => {
    render(<ParticipantsInput value={['Alex Chen', 'Sam Rivera']} onChange={vi.fn()} />);
    expect(screen.getByText('Alex Chen')).toBeInTheDocument();
    expect(screen.getByText('Sam Rivera')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Alex Chen' })).toBeInTheDocument();
  });

  it('tokenizes a comma-separated entry into chips on Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ParticipantsInput value={[]} onChange={onChange} />);
    await user.type(screen.getByLabelText('Participants'), 'Alex Chen, Sam Rivera{Enter}');
    expect(onChange).toHaveBeenCalledWith(['Alex Chen', 'Sam Rivera']);
  });

  it('tokenizes on blur too', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <>
        <ParticipantsInput value={[]} onChange={onChange} />
        <button type="button">elsewhere</button>
      </>,
    );
    await user.type(screen.getByLabelText('Participants'), 'Jordan Lee');
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(onChange).toHaveBeenCalledWith(['Jordan Lee']);
  });

  it('removes a chip via its remove button', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ParticipantsInput value={['Alex Chen', 'Sam Rivera']} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Remove Alex Chen' }));
    expect(onChange).toHaveBeenCalledWith(['Sam Rivera']);
  });

  it('Backspace on an empty input removes the last chip', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ParticipantsInput value={['Alex Chen', 'Sam Rivera']} onChange={onChange} />);
    const input = screen.getByLabelText('Participants');
    input.focus();
    await user.keyboard('{Backspace}');
    expect(onChange).toHaveBeenCalledWith(['Alex Chen']);
  });

  it('rejects an email address and shows the "names only" hint instead of adding it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ParticipantsInput value={[]} onChange={onChange} />);
    await user.type(screen.getByLabelText('Participants'), 'alex@example.com{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/names only/i)).toBeInTheDocument();
  });

  it('adds the valid names from a mixed entry and flags the rejected email', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ParticipantsInput value={[]} onChange={onChange} />);
    await user.type(screen.getByLabelText('Participants'), 'Alex Chen, bob@example.com, Sam Rivera{Enter}');
    expect(onChange).toHaveBeenCalledWith(['Alex Chen', 'Sam Rivera']);
    expect(screen.getByText(/names only/i)).toBeInTheDocument();
  });

  it('disables entry once the 24-participant cap is reached', () => {
    const onChange = vi.fn();
    const existing = Array.from({ length: 24 }, (_, i) => `Name ${i}`);
    render(<ParticipantsInput value={existing} onChange={onChange} />);
    expect(screen.getByLabelText('Participants')).toBeDisabled();
  });
});
