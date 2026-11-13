'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/* One shared 1-second tick: everything time-based (clock, break states,
   timers, the now-line) re-renders from this. */
const NowCtx = createContext<Date>(new Date(0));

export const useNow = () => useContext(NowCtx);

export function NowProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <NowCtx.Provider value={now}>{children}</NowCtx.Provider>;
}
