'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/** Small, accessible status channel: every failed save says so out loud. */
export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
}

const ToastContext = createContext<{ push: (message: string, tone?: Toast['tone']) => void }>({
  push: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 6000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto max-w-lg rounded-lg border px-4 py-2 text-sm shadow-lg ${
              toast.tone === 'error'
                ? 'border-bad/40 bg-surface text-bad'
                : toast.tone === 'success'
                  ? 'border-good/40 bg-surface text-good'
                  : 'border-line bg-surface text-ink'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
