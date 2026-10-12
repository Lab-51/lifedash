// @vitest-environment jsdom
// === FILE PURPOSE ===
// TWIN-LOOP.3 Task 3: the profile field editors enforce the save limits
// (shared/twinLimits) while the user types - every input carries maxLength equal to
// its field's limit, the list editor stops adding at LIST_MAX, an AI draft is clamped
// when it fills the form, and a STORED value already over its limit gets a plain
// field-specific message (and a save-blocking error) instead of the generic failure.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ObjectFieldsEditor, ListFieldsEditor, fieldsToDraft, pruneRows, overLimitError } from '../TwinFieldEditors';
import { BRIEF_FIELDS, IDENTITY_FIELDS, PROJECT_FIELDS, GOAL_FIELDS } from '../twinFields';
import { SHORT_MAX, TEXT_MAX, LIST_MAX } from '../../../../shared/twinLimits';

describe('field editors carry the shared limits', () => {
  it('gives each object-section input maxLength equal to its field limit', () => {
    render(<ObjectFieldsEditor fields={BRIEF_FIELDS} value={{ statement: '' }} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('maxlength', String(TEXT_MAX));

    render(<ObjectFieldsEditor fields={IDENTITY_FIELDS} value={{}} onChange={vi.fn()} />);
    for (const input of screen.getAllByRole('textbox').slice(1)) {
      expect(input).toHaveAttribute('maxlength', String(SHORT_MAX));
    }
  });

  it('gives each list-row input its field limit (short name, long description)', () => {
    render(<ListFieldsEditor fields={PROJECT_FIELDS} rows={[{}]} onChange={vi.fn()} addLabel="Add project" />);
    expect(screen.getByLabelText('Project name')).toHaveAttribute('maxlength', String(SHORT_MAX));
    expect(screen.getByLabelText('Description')).toHaveAttribute('maxlength', String(TEXT_MAX));
  });

  it('stops adding rows at LIST_MAX', () => {
    const full = Array.from({ length: LIST_MAX }, () => ({ value: 'g' }));
    render(<ListFieldsEditor fields={GOAL_FIELDS} rows={full} onChange={vi.fn()} addLabel="Add goal" />);
    expect(screen.getByRole('button', { name: 'Add goal' })).toBeDisabled();
    expect(screen.getByText(/holds at most 500 entries/i)).toBeInTheDocument();
  });
});

describe('a draft is clamped when it fills the form', () => {
  it('cuts each field to its own limit only when asked to clamp', () => {
    const long = { name: 'n'.repeat(SHORT_MAX + 5), description: 'd'.repeat(TEXT_MAX + 5) };
    const clamped = fieldsToDraft(PROJECT_FIELDS, long, true);
    expect(clamped.name).toHaveLength(SHORT_MAX);
    expect(clamped.description).toHaveLength(TEXT_MAX);
    // a stored value is shown as-is, never silently cut
    expect(fieldsToDraft(PROJECT_FIELDS, long).name).toHaveLength(SHORT_MAX + 5);
  });
});

describe('a stored value already over its limit', () => {
  it('shows the field-specific message naming the field and the limit', () => {
    render(
      <ObjectFieldsEditor fields={BRIEF_FIELDS} value={{ statement: 's'.repeat(TEXT_MAX + 1) }} onChange={vi.fn()} />,
    );
    expect(screen.getByText('Shorten Statement to 4,000 characters to save.')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows no message at exactly the limit', () => {
    render(<ObjectFieldsEditor fields={BRIEF_FIELDS} value={{ statement: 's'.repeat(TEXT_MAX) }} onChange={vi.fn()} />);
    expect(screen.queryByText(/shorten/i)).toBeNull();
  });

  it('blocks the save with the same message (object and list rows)', () => {
    expect(overLimitError(IDENTITY_FIELDS, { name: 'n'.repeat(SHORT_MAX + 1) })).toBe(
      'Shorten Name to 200 characters to save.',
    );
    expect(pruneRows(PROJECT_FIELDS, [{ name: 'p'.repeat(SHORT_MAX + 1) }]).error).toBe(
      'Shorten Project name to 200 characters to save.',
    );
  });
});
