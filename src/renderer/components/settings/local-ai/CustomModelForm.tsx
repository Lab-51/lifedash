// === FILE PURPOSE ===
// "Add your own GGUF" form for Settings → Local AI. Registers a user-supplied
// model from a local file (native picker) or a direct .gguf URL, then hands the
// registered entry back so the catalog list refreshes.
//
// === DEPENDENCIES ===
// React, lucide-react, window.electronAPI (`pickLocalModelFile`,
// `registerCustomLocalModel`), shared ModelRole type.
//
// === LIMITATIONS ===
// - Registering by URL does NOT download; the entry appears in the catalog with a
//   Download button like any other, so the user stays in control.
// - The main process rejects a name/role mismatch (the runtime infers "embedding"
//   from an `embed` filename); that error is surfaced verbatim rather than guessed at.

import { useState } from 'react';
import { FolderOpen, Loader2, Plus } from 'lucide-react';
import type { ModelRole } from '../../../../shared/types/localModels';

interface CustomModelFormProps {
  onAdded: () => void;
  onCancel: () => void;
}

const INPUT_CLASS =
  'w-full text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]';

export default function CustomModelForm({ onAdded, onCancel }: CustomModelFormProps) {
  const [displayName, setDisplayName] = useState('');
  const [filePath, setFilePath] = useState('');
  const [url, setUrl] = useState('');
  const [role, setRole] = useState<ModelRole>('chat');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePick = async () => {
    try {
      const picked = await window.electronAPI?.pickLocalModelFile?.();
      if (picked) {
        setFilePath(picked);
        setUrl('');
        if (!displayName.trim())
          setDisplayName(
            picked
              .split(/[\\/]/)
              .pop()
              ?.replace(/\.gguf$/i, '') ?? '',
          );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the file picker.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    const trimmedUrl = url.trim();
    if (!name) return setError('Give the model a name so you can recognise it later.');
    if (!filePath && !trimmedUrl) return setError('Pick a .gguf file or paste a direct .gguf URL.');
    if (filePath && trimmedUrl) return setError('Use either a file or a URL, not both.');

    setSubmitting(true);
    setError(null);
    try {
      await window.electronAPI.registerCustomLocalModel({
        displayName: name,
        role,
        ...(filePath ? { filePath } : { url: trimmedUrl }),
      });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that model.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3 rounded-lg border border-[var(--color-border)] space-y-3 overflow-hidden"
    >
      {error && (
        <p className="p-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-data break-words overflow-hidden">
          {error}
        </p>
      )}

      <div>
        <label htmlFor="custom-gguf-name" className="block text-xs text-[var(--color-text-secondary)] mb-1.5 font-data">
          Name
        </label>
        <input
          id="custom-gguf-name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="My fine-tuned model"
          className={INPUT_CLASS}
        />
      </div>

      <div>
        <span className="block text-xs text-[var(--color-text-secondary)] mb-1.5 font-data">File on this computer</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePick}
            className="shrink-0 flex items-center gap-1.5 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] px-2.5 py-1.5 rounded-lg text-xs transition-colors"
          >
            <FolderOpen size={13} aria-hidden="true" />
            Choose .gguf…
          </button>
          <span className="min-w-0 flex-1 text-[0.6875rem] text-[var(--color-text-muted)] font-data break-words overflow-hidden">
            {filePath || 'No file selected'}
          </span>
        </div>
      </div>

      <div>
        <label htmlFor="custom-gguf-url" className="block text-xs text-[var(--color-text-secondary)] mb-1.5 font-data">
          …or a direct .gguf URL
        </label>
        <input
          id="custom-gguf-url"
          type="text"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (e.target.value) setFilePath('');
          }}
          placeholder="https://…/model-Q4_K_M.gguf"
          className={INPUT_CLASS}
        />
        <p className="mt-1 text-[0.6875rem] text-[var(--color-text-muted)] break-words">
          A URL is only registered here — you still press Download when you want the file.
        </p>
      </div>

      <fieldset>
        <legend className="block text-xs text-[var(--color-text-secondary)] mb-1.5 font-data">Role</legend>
        <div className="flex items-center gap-4 text-sm text-[var(--color-text-secondary)]">
          {(['chat', 'embedding'] as ModelRole[]).map((value) => (
            <label key={value} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="custom-gguf-role"
                value={value}
                checked={role === value}
                onChange={() => setRole(value)}
                className="w-3.5 h-3.5"
              />
              <span className="capitalize">{value}</span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-[0.6875rem] text-[var(--color-text-muted)] break-words">
          The runtime decides by filename: an embedding model’s file name must contain “embed”.
        </p>
      </fieldset>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex items-center gap-1.5 border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] disabled:opacity-50 px-3 py-1.5 text-sm transition-all clip-corner-cut-sm"
        >
          {submitting ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Plus size={14} aria-hidden="true" />
          )}
          Add model
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] px-3 py-1.5 text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
