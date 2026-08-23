// === FILE PURPOSE ===
// Shared participant chip input (BRIEF-QUAL.1 Task 4) — a comma-separated text
// entry tokenized into removable chips. Reused by RecordingControls (optional
// prefill, collapsed under the template/language row) and MeetingHeader (the
// always-visible inline post-hoc editor). Names only, mirroring the
// participantNameSchema zod rules client-side so a rejected paste never has to
// round-trip through the main process just to bounce back: trim, 1-80 chars,
// max 24, no '@'.
//
// === DEPENDENCIES ===
// react, lucide-react (Users, X)

import { useId, useState } from 'react';
import { Users, X } from 'lucide-react';

const MAX_PARTICIPANTS = 24;
const MAX_NAME_LENGTH = 80;

interface ParticipantsInputProps {
  value: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

/** Split a comma-separated entry into trimmed, valid names. Anything containing
 *  '@' is rejected outright (never coerced into a name) — the caller surfaces a
 *  "names only" hint when `rejectedEmail` comes back true. */
function tokenize(raw: string): { names: string[]; rejectedEmail: boolean } {
  const names: string[] = [];
  let rejectedEmail = false;
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes('@')) {
      rejectedEmail = true;
      continue;
    }
    names.push(trimmed.slice(0, MAX_NAME_LENGTH));
  }
  return { names, rejectedEmail };
}

export default function ParticipantsInput({ value, onChange, disabled, placeholder }: ParticipantsInputProps) {
  const [draft, setDraft] = useState('');
  const [showEmailHint, setShowEmailHint] = useState(false);
  const inputId = useId();
  const atCapacity = value.length >= MAX_PARTICIPANTS;

  const commit = () => {
    if (!draft.trim()) return;
    const { names, rejectedEmail } = tokenize(draft);
    setShowEmailHint(rejectedEmail);
    if (names.length === 0) {
      setDraft('');
      return;
    }
    const merged = Array.from(new Set([...value, ...names])).slice(0, MAX_PARTICIPANTS);
    onChange(merged);
    setDraft('');
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="flex items-center gap-1.5 text-xs text-surface-500">
        <Users size={12} />
        Participants
      </label>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((name, index) => (
            <span
              key={`${name}-${index}`}
              className="inline-flex items-center gap-1 max-w-full overflow-hidden text-xs bg-surface-100 dark:bg-surface-800 border border-[var(--color-border)] rounded-full pl-2.5 pr-1 py-1"
            >
              <span className="truncate break-words">{name}</span>
              <button
                type="button"
                onClick={() => removeAt(index)}
                disabled={disabled}
                aria-label={`Remove ${name}`}
                className="p-0.5 rounded-full text-surface-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        id={inputId}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            removeAt(value.length - 1);
          }
        }}
        placeholder={
          atCapacity ? `Up to ${MAX_PARTICIPANTS} participants` : (placeholder ?? 'Add name, comma-separated...')
        }
        disabled={disabled || atCapacity}
        className="w-full text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-1.5
                   text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)]
                   focus:outline-none focus:border-[var(--color-accent-dim)] disabled:opacity-50"
      />
      {showEmailHint && <p className="text-xs text-amber-400">Names only — an email address wasn&apos;t added.</p>}
    </div>
  );
}
