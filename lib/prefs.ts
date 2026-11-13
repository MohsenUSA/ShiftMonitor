/* Per-device preferences (reminders, timeline view, last team). These stay in
   the browser on purpose — they are personal, not shared team data. Storage
   can throw in private modes or sandboxed previews, so every access is
   guarded and the app works without it. */

export function getPref(key: string): string | null {
  try { return localStorage.getItem('sm.' + key); } catch { return null; }
}

export function setPref(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem('sm.' + key);
    else localStorage.setItem('sm.' + key, value);
  } catch { /* storage unavailable — preference just won't persist */ }
}
