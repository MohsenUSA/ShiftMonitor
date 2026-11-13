'use client';

import { useEffect, useRef, useState } from 'react';
import type { Backend, TeamSummary } from '@/lib/backend/types';
import type { User } from '@/lib/model';
import { getPref, setPref } from '@/lib/prefs';
import { History } from './History';
import { SchedulePanel, TeamPanel } from './Panels';
import { StatsRow } from './StatsRow';
import { Timeline, type GanttMode } from './Timeline';
import { TodaysShifts } from './TodaysShifts';
import { useToast } from './Toast';
import { Topbar } from './Topbar';
import { useNow } from './useNow';
import { useReminders } from './useReminders';
import { useTeamData } from './useTeamData';

interface Props {
  backend: Backend;
  user: User;
  team: TeamSummary;
  teams: TeamSummary[];
  onSwitchTeam: (id: string) => void;
  onManageTeams: () => void;
  onSignOut: () => void;
}

export function Dashboard(p: Props) {
  const toast = useToast();
  const now = useNow();
  const { snap, loadError, connected, run, reload } = useTeamData(p.backend, p.team.id);
  const reminders = useReminders(snap, now, toast);
  const [mode, setModeState] = useState<GanttMode>(() => (getPref('ganttMode') === 'employee' ? 'employee' : 'shift'));
  const [editingId, setEditingId] = useState<string | null>(null);
  const teamAcc = useRef<HTMLDetailsElement>(null);
  const scheduleAcc = useRef<HTMLDetailsElement>(null);
  const firstLoad = useRef(true);

  const setMode = (m: GanttMode) => { setModeState(m); setPref('ganttMode', m); };

  // First visit to an empty team: open the Team panel so it's clear where to start.
  useEffect(() => {
    if (snap && firstLoad.current) {
      firstLoad.current = false;
      if (!snap.employees.length && teamAcc.current) teamAcc.current.open = true;
    }
  }, [snap]);

  // A teammate may delete the shift being edited.
  const editing = editingId && snap?.shifts.some(s => s.id === editingId) ? editingId : null;

  return (
    <>
      <Topbar user={p.user} team={p.team} teams={p.teams} connected={connected}
              remindersOn={reminders.on} onToggleReminders={reminders.toggle}
              onSwitchTeam={p.onSwitchTeam} onManageTeams={p.onManageTeams} onSignOut={p.onSignOut} />
      <main className="page">
        {!connected && snap && (
          <div className="sync-banner">⚠️ Lost the live connection — reconnecting. Changes you make are still saved; teammates&apos; changes will appear once reconnected.</div>
        )}
        {loadError && !snap && (
          <div className="sync-banner">
            ⚠️ Couldn&apos;t load this team: {loadError} <button className="btn-outline btn-sm" onClick={reload}>Retry</button>
          </div>
        )}
        {!snap ? (
          !loadError && <div className="empty"><span className="empty-icon">⏳</span>Loading {p.team.name}…</div>
        ) : (
          <>
            <StatsRow snap={snap} run={run} toast={toast} />
            <div className="accordions">
              <TeamPanel snap={snap} run={run} accRef={teamAcc} />
              <SchedulePanel snap={snap} run={run} accRef={scheduleAcc} />
            </div>
            <Timeline snap={snap} mode={mode} setMode={setMode} onEditShift={setEditingId} />
            <TodaysShifts snap={snap} run={run} editingId={editing} setEditingId={setEditingId} />
            <History snap={snap} run={run} toast={toast} />
          </>
        )}
      </main>
      <footer className="site-foot"><span>version 4.0 · {p.backend.kind === 'dev' ? 'local dev backend' : 'cloud'}</span></footer>
    </>
  );
}
