// === FILE PURPOSE ===
// Zustand store for toast notifications. Provides useToastStore hook
// for React components and a standalone toast() function for non-component
// code (e.g. store actions).

import { create } from 'zustand';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  action?: { label: string; onClick: () => void };
}

interface ToastStore {
  toasts: Toast[];
  addToast: (message: string, type?: Toast['type'], action?: Toast['action'], duration?: number) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  addToast: (message, type = 'success', action, duration = 3000) => {
    const id = crypto.randomUUID();
    set({ toasts: [...get().toasts, { id, message, type, action }] });
    setTimeout(() => get().removeToast(id), duration);
  },
  removeToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

/** Convenience function — callable from anywhere (components, stores, utils). */
export function toast(message: string, type?: Toast['type'], action?: Toast['action'], duration?: number) {
  useToastStore.getState().addToast(message, type, action, duration);
}
