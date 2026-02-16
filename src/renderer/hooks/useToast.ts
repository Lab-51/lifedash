// === FILE PURPOSE ===
// Zustand store for toast notifications. Provides useToastStore hook
// for React components and a standalone toast() function for non-component
// code (e.g. store actions).

import { create } from 'zustand';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastStore {
  toasts: Toast[];
  addToast: (message: string, type?: Toast['type']) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  addToast: (message, type = 'success') => {
    const id = crypto.randomUUID();
    set({ toasts: [...get().toasts, { id, message, type }] });
    setTimeout(() => get().removeToast(id), 3000);
  },
  removeToast: (id) => {
    set({ toasts: get().toasts.filter(t => t.id !== id) });
  },
}));

/** Convenience function — callable from anywhere (components, stores, utils). */
export function toast(message: string, type?: Toast['type']) {
  useToastStore.getState().addToast(message, type);
}
