// === FILE PURPOSE ===
// Generic edit/save/cancel chrome shared by every Twin profile section card
// (V3.3 Task 3) — owns editing/saving/error state and the view<->editor switch;
// TwinPage supplies the concrete view/editor content and the save call, so this
// file has no knowledge of individual section shapes (see TwinFieldEditors.tsx
// for the reusable field renderers, and twinProfileService.updateProfileSection
// for the section-level patch semantics this saves against).
//
// === DEPENDENCIES ===
// react, lucide-react

import { useState } from 'react';
import type { ReactNode } from 'react';
import type { TwinProfile } from '../../../shared/types/twin';

interface TwinSectionCardProps<T> {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** Seeds the editor's draft from the current value when Edit is clicked. */
  initialDraft: () => T;
  renderView: () => ReactNode;
  renderEditor: (draft: T, setDraft: (next: T) => void) => ReactNode;
  /** Persists the draft (a section-level patch) and returns the updated profile. */
  onSave: (draft: T) => Promise<TwinProfile>;
  onSaved: (profile: TwinProfile) => void;
}

export default function TwinSectionCard<T>({
  title,
  icon: Icon,
  initialDraft,
  renderView,
  renderEditor,
  onSave,
  onSaved,
}: TwinSectionCardProps<T>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<T | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setDraft(initialDraft());
    setError(null);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (draft === null) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await onSave(draft);
      onSaved(updated);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="hud-panel clip-corner-cut-sm p-4 min-w-0">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={16} className="text-[var(--color-accent-dim)] shrink-0" />
          <h3 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)] truncate">
            {title}
          </h3>
        </div>
        {!isEditing && (
          <button
            type="button"
            onClick={startEdit}
            className="shrink-0 text-xs font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-dim)] transition-colors"
          >
            Edit
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-500 mb-2 break-words">{error}</p>}

      {isEditing && draft !== null ? (
        <>
          {renderEditor(draft, setDraft)}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--color-border)]">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="text-xs border border-[var(--color-accent-dim)] text-[var(--color-accent)] hover:border-[var(--color-accent)] px-2.5 py-1 rounded transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              disabled={saving}
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        renderView()
      )}
    </section>
  );
}
