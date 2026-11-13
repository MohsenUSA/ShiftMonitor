'use client';

import { useEffect, useRef, useState } from 'react';
import type { TeamSummary } from '@/lib/backend/types';
import type { User } from '@/lib/model';
import { useCopy } from './Toast';
import { useNow } from './useNow';

export function BrandMark() {
  return (
    <span className="brand-mark">
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 9h12v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9z" />
        <path d="M16 10h2.5a2.5 2.5 0 0 1 0 5H16" />
        <path d="M7.5 5.5c0-1 .8-1 .8-2" />
        <path d="M11.5 5.5c0-1 .8-1 .8-2" />
      </svg>
    </span>
  );
}

function Clock() {
  const now = useNow();
  return (
    <div className="clock">
      <div className="clock-time" data-testid="clock">
        {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
      </div>
      <div className="clock-date">{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>
    </div>
  );
}

interface Props {
  user: User;
  team: TeamSummary;
  teams: TeamSummary[];
  connected: boolean;
  remindersOn: boolean;
  onToggleReminders: () => void;
  onSwitchTeam: (id: string) => void;
  onManageTeams: () => void;
  onSignOut: () => void;
}

export function Topbar(p: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const copy = useCopy();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand"><BrandMark />Shift Monitor</div>
        <div className="topbar-right">
          <span className="team-menu-wrap" ref={wrap}>
            <button className="team-btn" onClick={() => setOpen(o => !o)} aria-expanded={open}
                    title={p.connected ? 'Live — changes sync with your team' : 'Reconnecting… changes will sync when back online'}>
              <span className={'sync-dot' + (p.connected ? '' : ' off')} />
              <span className="team-btn-name" data-testid="team-name">{p.team.name}</span>
              <span aria-hidden>▾</span>
            </button>
            {open && (
              <div className="team-menu" role="menu">
                <div className="team-menu-sec">Invite teammates</div>
                <button className="tm-item" onClick={() => copy(p.team.joinCode)} title="Copy join code">
                  <span>Join code</span><span className="tm-code" data-testid="join-code">{p.team.joinCode}</span>
                </button>
                <hr />
                <div className="team-menu-sec">Your teams</div>
                {p.teams.map(t => (
                  <button key={t.id} className={'tm-item' + (t.id === p.team.id ? ' current' : '')}
                          onClick={() => { setOpen(false); p.onSwitchTeam(t.id); }}>
                    <span>{t.name}</span>{t.id === p.team.id && <span>✓</span>}
                  </button>
                ))}
                <button className="tm-item" onClick={() => { setOpen(false); p.onManageTeams(); }}>＋ Create or join a team</button>
                <hr />
                <div className="tm-user">{p.user.name} · {p.user.email}</div>
                <button className="tm-item" onClick={() => { setOpen(false); p.onSignOut(); }}>Sign out</button>
              </div>
            )}
          </span>
          <button className={'bell' + (p.remindersOn ? ' on' : '')} onClick={p.onToggleReminders}
                  title="Remind me 5 minutes before each scheduled break" aria-pressed={p.remindersOn}>
            {p.remindersOn ? '🔔' : '🔕'}
          </button>
          <Clock />
        </div>
      </div>
    </header>
  );
}
