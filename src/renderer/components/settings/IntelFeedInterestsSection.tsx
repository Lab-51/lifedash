// === FILE PURPOSE ===
// Intel Feed Interests section for the Settings page (Intel Feed tab).
// Tag/chip input — user types a topic, presses Enter, it appears as a pill.
// Stored as comma-separated string in settings for backward compatibility.

import { useEffect, useState, useRef, useCallback } from 'react';
import { Newspaper, X, Plus } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';

const SETTING_KEY = 'intel.interests';

/** Parse a stored comma-separated string into a deduplicated tag array. */
function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}

export default function IntelFeedInterestsSection() {
  const settings = useSettingsStore((s) => s.settings);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const [tags, setTags] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [saved, setSaved] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync from persisted setting on load
  useEffect(() => {
    const raw = settings[SETTING_KEY];
    if (raw != null) {
      setTags(parseTags(raw)); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [settings]);

  const persist = useCallback(
    async (newTags: string[]) => {
      await setSetting(SETTING_KEY, newTags.join(', '));
      setSaved(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setSaved(false), 2000);
    },
    [setSetting],
  );

  const addTag = useCallback(
    (raw: string) => {
      const tag = raw.trim();
      if (!tag) return;
      // Prevent duplicates (case-insensitive)
      if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
        setInputValue('');
        return;
      }
      const next = [...tags, tag];
      setTags(next);
      setInputValue('');
      persist(next);
    },
    [tags, persist],
  );

  const removeTag = useCallback(
    (index: number) => {
      const next = tags.filter((_, i) => i !== index);
      setTags(next);
      persist(next);
    },
    [tags, persist],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(inputValue);
    }
    // Backspace on empty input removes last tag
    if (e.key === 'Backspace' && inputValue === '' && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  return (
    <section className="hud-panel-accent clip-corner-cut-sm p-6">
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-1">
          <Newspaper size={16} className="text-[var(--color-accent)]" />
          <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">
            Feed Interests
          </span>
          <div className="h-px flex-1 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
          {saved && <span className="text-xs text-emerald-500 animate-in fade-in duration-200">Saved</span>}
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Add topics you care about. Articles matching these interests will be ranked higher in your feed.
        </p>
      </div>

      {/* How it works */}
      <div className="mb-4 p-4 rounded-lg bg-[var(--color-chrome)] border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] space-y-2">
        <p className="font-medium text-[var(--color-text-primary)]">How ranking works</p>
        <p>
          When new articles are fetched, AI scores each one 1-10 based on significance. Your interests influence these
          scores — specific topics like <span className="text-[var(--color-accent)]">AI agents</span>,{' '}
          <span className="text-[var(--color-accent)]">local LLMs</span>, or{' '}
          <span className="text-[var(--color-accent)]">Electron</span> work better than broad terms like &quot;AI
          related&quot;.
        </p>
        <p>
          Your active project names are included automatically — no need to add them here. Use the{' '}
          <span className="text-[var(--color-accent)]">Top</span> sort in the feed to see highest-ranked articles first.
        </p>
      </div>

      {/* Input row */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? 'e.g., AI agents' : 'Add another topic...'}
          className="flex-1 px-3 py-2 text-sm bg-[var(--color-chrome)] border border-[var(--color-border)] rounded-md text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] transition-colors"
        />
        <button
          onClick={() => addTag(inputValue)}
          disabled={!inputValue.trim()}
          className="px-3 py-2 text-sm rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Tag list */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-4">
          {tags.map((tag, i) => (
            <span
              key={`${tag}-${i}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border border-[var(--color-border-accent)] bg-[var(--color-accent-muted)] text-[var(--color-accent)]"
            >
              {tag}
              <button
                onClick={() => removeTag(i)}
                className="cursor-pointer hover:text-red-400 transition-colors"
                aria-label={`Remove ${tag}`}
              >
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}

      {tags.length === 0 && (
        <p className="text-xs text-[var(--color-text-muted)] mt-3">
          No interests added yet. Your active project names are used automatically.
        </p>
      )}
    </section>
  );
}
