'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { employeeName } from '@/lib/actions';
import type { TeamSnapshot } from '@/lib/model';
import { getPref, setPref } from '@/lib/prefs';
import { REMIND_BEFORE } from '@/lib/status';
import { breakAbs, formatTime, nowAbs } from '@/lib/time';
import { faviconURI } from './favicon';

let audioCtx: AudioContext | undefined;
function chime() {
  try {
    const W = window as unknown as { webkitAudioContext?: typeof AudioContext };
    audioCtx = audioCtx || new (window.AudioContext || W.webkitAudioContext!)();
    const ctx = audioCtx;
    ([[880, 0], [1175, 0.18]] as const).forEach(([freq, at]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.4);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.45);
    });
  } catch { /* audio unavailable — the toast still shows */ }
}

/* Tab badge: red dot on the favicon + count in the title while the tab is
   hidden, so a reminder that fires on another tab is still noticed. */
function setTabAlert(count: number) {
  document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach(l => { l.href = faviconURI(count > 0); });
  document.title = count ? `🔴 (${count}) Shift Monitor` : 'Shift Monitor';
}

/* 5-minute heads-up before each scheduled break. On/off is per device. */
export function useReminders(snap: TeamSnapshot | null, now: Date, toast: (m: string) => void) {
  const [on, setOn] = useState(() => getPref('remindersOn') === '1');
  const reminded = useRef(new Set<string>());
  const pending = useRef(0);

  useEffect(() => {
    const onVis = () => {
      if (!document.hidden && pending.current) { pending.current = 0; setTabAlert(0); }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (!on || !snap) return;
    snap.shifts.forEach(shift => shift.breaks.forEach((br, i) => {
      if (br.status !== 'scheduled') return;
      const diff = breakAbs(br, shift) - nowAbs(shift, now);
      const key = `${shift.id}:${i}:${br.scheduled}`;
      if (diff > 0 && diff <= REMIND_BEFORE && !reminded.current.has(key)) {
        reminded.current.add(key);
        const msg = `${employeeName(snap, shift.employeeId)} — ${br.type} at ${formatTime(br.scheduled)} (in ${Math.ceil(diff)} min)`;
        toast('🔔 ' + msg);
        chime();
        if ('Notification' in window && Notification.permission === 'granted') new Notification('Break coming up', { body: msg });
        if (document.hidden) { pending.current++; setTabAlert(pending.current); }
      }
    }));
  }, [on, snap, now, toast]);

  const toggle = useCallback(() => {
    const next = !on;
    setOn(next);
    setPref('remindersOn', next ? '1' : null);
    if (next) {
      chime();   // user gesture unlocks audio for later reminders
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      toast(`Reminders on — you'll get a heads-up ${REMIND_BEFORE} minutes before each break.`);
    } else {
      toast('Break reminders off.');
    }
  }, [on, toast]);

  return { on, toggle };
}
