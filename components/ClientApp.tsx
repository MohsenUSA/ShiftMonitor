'use client';

import dynamic from 'next/dynamic';

/* The whole app is live, per-user and clock-driven, so it renders only in
   the browser; the server just ships the shell. */
const App = dynamic(() => import('./App'), {
  ssr: false,
  loading: () => <div className="gate"><div className="gate-card"><p className="sub">Loading…</p></div></div>,
});

export default function ClientApp() {
  return <App />;
}
