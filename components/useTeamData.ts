'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Ctx, Result } from '@/lib/actions';
import { applyOps } from '@/lib/apply';
import type { Backend } from '@/lib/backend/types';
import type { TeamSnapshot, WriteOp } from '@/lib/model';
import { useToast } from './Toast';

/* Holds one team's data (the caller remounts per team, so state starts empty), keeps it live, and applies changes.
   - Changes apply locally at once (optimistic), then go to the backend in
     order. If a write fails, the snapshot is reloaded from the server.
   - Changes from other users arrive through the subscription. Ops that land
     before the first snapshot are buffered and replayed on top of it (puts
     and deletes are idempotent, so overlap is harmless). */
export function useTeamData(backend: Backend, teamId: string) {
  const toast = useToast();
  const [snap, setSnap] = useState<TeamSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const snapRef = useRef<TeamSnapshot | null>(null);
  const clientId = useMemo(() => crypto.randomUUID(), []);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const set = useCallback((next: TeamSnapshot | null) => {
    snapRef.current = next;
    setSnap(next);
  }, []);

  const reload = useCallback(async () => {
    try {
      set(await backend.loadTeam(teamId));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [backend, teamId, set]);

  useEffect(() => {
    let alive = true;
    let pending: WriteOp[] = [];

    const unsubscribe = backend.subscribe(teamId, clientId, {
      onOps: ops => {
        if (!alive) return;
        if (!snapRef.current) { pending.push(...ops); return; }
        set(applyOps(snapRef.current, ops));
      },
      onResync: () => { if (alive) reload(); },
      onStatus: c => { if (alive) setConnected(c); },
    });

    backend.loadTeam(teamId).then(s => {
      if (!alive) return;
      set(pending.length ? applyOps(s, pending) : s);
      pending = [];
      setLoadError(null);
    }, e => { if (alive) setLoadError((e as Error).message); });

    return () => { alive = false; unsubscribe(); };
  }, [backend, teamId, clientId, reload, set]);

  const commit = useCallback((ops: WriteOp[]) => {
    if (!ops.length || !snapRef.current) return;
    set(applyOps(snapRef.current, ops));
    queue.current = queue.current.then(() => backend.write(teamId, ops, clientId)).catch(e => {
      toast(`Couldn't save: ${(e as Error).message} — reloading the latest data.`);
      return reload();
    });
  }, [backend, teamId, clientId, reload, set, toast]);

  /* Run a pure action against the latest state: show its error or apply
     its ops and show its toast. Returns the result so callers can react. */
  const run = useCallback((action: (ctx: Ctx) => Result, opts?: { inlineError?: boolean }): Result => {
    const s = snapRef.current;
    if (!s) return { ops: [] };
    const result = action({ ...s, now: new Date(), newId: () => crypto.randomUUID() });
    if (result.error) { if (!opts?.inlineError) toast(result.error); return result; }
    commit(result.ops);
    if (result.toast) toast(result.toast);
    return result;
  }, [commit, toast]);

  return { snap, loadError, connected, run, reload };
}
