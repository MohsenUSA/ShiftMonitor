'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

const ToastCtx = createContext<(msg: string) => void>(() => {});

export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 10000);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div className="toast" role="status" style={{ display: 'flex' }}>
          <span className="toast-msg">{msg}</span>
          <button className="toast-x" onClick={() => setMsg(null)} title="Dismiss">✕</button>
        </div>
      )}
    </ToastCtx.Provider>
  );
}

/* Copy to the clipboard, with an execCommand fallback where the async API
   is blocked. */
export function useCopy() {
  const toast = useToast();
  return useCallback((text: string) => {
    if (!text) return;
    const done = () => toast(`Copied “${text}” to clipboard.`);
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); }
      catch { toast('Could not copy to clipboard.'); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }, [toast]);
}
