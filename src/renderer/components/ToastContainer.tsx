// === FILE PURPOSE ===
// Renders toast notifications in a fixed position (bottom-right, above status bar).
// Reads from the useToastStore Zustand store. Max 3 visible toasts.

import { X } from 'lucide-react';
import { useToastStore } from '../hooks/useToast';
import type { Toast } from '../hooks/useToast';

const TYPE_COLORS: Record<Toast['type'], string> = {
  success: '#22c55e',
  error: '#ef4444',
  info: '#3b82f6',
};

function ToastContainer() {
  const toasts = useToastStore(s => s.toasts);
  const removeToast = useToastStore(s => s.removeToast);

  // Show only the last 3 toasts
  const visible = toasts.slice(-3);

  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-8 right-4 z-50 flex flex-col gap-2">
      {visible.map(t => (
        <div
          key={t.id}
          className="bg-surface-800 border border-surface-700 rounded-lg px-4 py-2 shadow-lg flex items-center gap-3"
          style={{ borderLeftWidth: 3, borderLeftColor: TYPE_COLORS[t.type] }}
        >
          <span className="text-sm text-surface-200">{t.message}</span>
          <button
            onClick={() => removeToast(t.id)}
            className="text-surface-400 hover:text-surface-200 transition-colors shrink-0"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default ToastContainer;
