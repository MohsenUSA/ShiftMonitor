'use client';

import { Fragment, type ReactNode } from 'react';
import { employeeName } from '@/lib/actions';
import type { Shift, TeamSnapshot } from '@/lib/model';
import { breakState, clockStatus, sortShifts } from '@/lib/status';
import {
  OFF_KINDS, anchorMin, breakAbs, dayMin, fmtDur, fmtIso, formatTime, offBlocks, offSummary, shiftSpan, workSpan,
} from '@/lib/time';
import { useNow } from './useNow';

export type GanttMode = 'shift' | 'employee';

interface Props {
  snap: TeamSnapshot;
  mode: GanttMode;
  setMode: (m: GanttMode) => void;
  onEditShift: (id: string) => void;
}

const pct = (n: number) => `${n.toFixed(2)}%`;

export function Timeline({ snap, mode, setMode, onEditShift }: Props) {
  const now = useNow();
  const shifts = sortShifts(snap.shifts);
  const name = (id: string) => employeeName(snap, id);

  let body: ReactNode;
  if (!shifts.length) {
    body = <div className="empty"><span className="empty-icon">📊</span>The timeline appears once shifts are scheduled.</div>;
  } else {
    const spans = shifts.map(s => ({ shift: s, ...shiftSpan(s) }));

    // Midnight-to-midnight frame, extended only when an overnight shift runs past 24:00.
    const axisEnd = Math.max(1440, Math.ceil(Math.max(...spans.map(s => s.e)) / 60) * 60);
    const range = Math.max(axisEnd, 60);
    const pos = (m: number) => m / range * 100;

    const hours: number[] = [];
    for (let m = 0; m <= axisEnd; m += 60) hours.push(m);

    const nowMin = dayMin(now);

    const track = (shift: Shift, start: number, end: number) => {
      const nm = name(shift.employeeId);
      const ws = workSpan(shift);
      const offTip = offSummary(shift) ? ` · ${offSummary(shift)}` : '';
      return (
        <>
          <div className="g-shift" style={{ left: pct(pos(start)), width: pct(pos(end) - pos(start)) }}
               onDoubleClick={() => onEditShift(shift.id)}
               title={`${nm} · ${formatTime(shift.start)} – ${formatTime(shift.end)} · ${fmtDur(end - start)}${offTip} — double-click to edit`} />
          {offBlocks(shift).map(b => {
            const k = OFF_KINDS[b.kind];
            return <div key={`${b.kind}-${b.edge}`} className={`g-${k.cls}`}
                        style={{ left: pct(pos(b.from)), width: pct(pos(b.to) - pos(b.from)) }}
                        title={`${nm} · ${k.word} ${fmtDur(b.mins)} (${b.edge} of shift)`} />;
          })}
          {shift.breaks.map((br, i) => {
            const st = breakState(br, shift, now);
            // Planned slot by default; once a break ran, draw it where it actually happened.
            let bs = breakAbs(br, shift), bw = br.expected, note = '';
            if (br.actualStart) {
              const d = new Date(br.actualStart);
              bs = anchorMin(d.getHours() * 60 + d.getMinutes(), shift);
              bw = br.actualEnd
                ? Math.max(1, Math.round((+new Date(br.actualEnd) - +d) / 60000))
                : Math.max(1, (+now - +d) / 60000);
              note = ` · taken ${fmtIso(br.actualStart)}`;
            }
            const l = Math.max(pos(bs), 0), r = Math.min(pos(bs + bw), 100);
            if (r <= 0 || l >= 100) return null;
            const un = br.type === 'Unscheduled';
            return <div key={i} className={`g-break ${st.key}${un ? ' unsched' : ''}`}
                        style={{ left: pct(l), width: pct(Math.max(r - l, 0.4)) }}
                        title={`${nm} · ${br.type} · ${formatTime(br.scheduled)} · ${un ? 'unplanned' : br.expected + ' min'} · ${st.label}${note}`} />;
          })}
          {([['clockIn', ws.s, 'in', 'Clock-in'], ['clockOut', ws.e, 'out', 'Clock-out']] as const).map(([field, sched, dir, lbl]) => {
            const iso = shift[field];
            if (!iso) return null;
            const d = new Date(iso);
            const m = anchorMin(d.getHours() * 60 + d.getMinutes(), shift);
            const cs = clockStatus(iso, sched, shift, dir);
            return <div key={field} className={`g-clock ${cs.color}`} style={{ left: pct(Math.min(Math.max(pos(m), 0), 100)) }}
                        title={`${nm} · ${lbl} ${fmtIso(iso)} · ${cs.label}`} />;
          })}
        </>
      );
    };

    let lanes: { key: string; label: string; inner: ReactNode }[];
    if (mode === 'employee') {
      // One lane per employee with all their shifts; earliest-start employee on top.
      const byEmp = new Map<string, { label: string; start: number; items: ReactNode[] }>();
      spans.forEach(sp => {
        const id = sp.shift.employeeId;
        if (!byEmp.has(id)) byEmp.set(id, { label: name(id), start: sp.s, items: [] });
        const g = byEmp.get(id)!;
        g.start = Math.min(g.start, sp.s);
        g.items.push(<Fragment key={sp.shift.id}>{track(sp.shift, sp.s, sp.e)}</Fragment>);
      });
      lanes = [...byEmp.entries()].sort((a, b) => a[1].start - b[1].start)
        .map(([id, g]) => ({ key: id, label: g.label, inner: g.items }));
    } else {
      lanes = spans.map(sp => ({ key: sp.shift.id, label: name(sp.shift.employeeId), inner: track(sp.shift, sp.s, sp.e) }));
    }

    body = (
      <>
        <div className="g-chart" data-testid="timeline">
          <div className="g-gridwrap">{hours.map(m => <div key={m} className="g-line" style={{ left: pct(pos(m)) }} />)}</div>
          <div className="g-nowwrap">
            {nowMin >= 0 && nowMin <= axisEnd && <div className="g-now" style={{ left: pct(pos(nowMin)) }} />}
          </div>
          <div className="g-axis">{hours.map(m => <div key={m} className="g-hour" style={{ left: pct(pos(m)) }}>{Math.floor(m / 60) % 24}</div>)}</div>
          {lanes.map((ln, i) => (
            <div className="g-row" key={ln.key}>
              <div className="g-label" title={ln.label}><span className="g-idx">{i + 1}</span>{ln.label}</div>
              <div className="g-track">{ln.inner}</div>
            </div>
          ))}
        </div>
        <div className="g-legend">
          <span><i style={{ background: 'var(--accent-soft)', border: '1px solid #d8defb' }} />Shift</span>
          <span><i style={{ background: '#94a3b8' }} />Scheduled</span>
          <span><i style={{ background: 'var(--amber)' }} />Due ≤30m</span>
          <span><i style={{ background: 'var(--orange)' }} />Due ≤15m</span>
          <span><i style={{ background: 'var(--red)' }} />Overdue</span>
          <span><i style={{ background: 'var(--blue)' }} />On break</span>
          <span><i style={{ background: 'var(--green)' }} />Done</span>
          <span><i style={{ background: '#a855f7' }} />Unscheduled</span>
          <span><i className="leg-pto" />PTO</span>
          <span><i className="leg-drop" />Drop</span>
        </div>
      </>
    );
  }

  return (
    <div className="card">
      <div className="card-head-row">
        <h2>Timeline</h2>
        <div className="head-actions">
          <div className="seg">
            <button className={'seg-btn' + (mode === 'shift' ? ' active' : '')} onClick={() => setMode('shift')}>By shift</button>
            <button className={'seg-btn' + (mode === 'employee' ? ' active' : '')} onClick={() => setMode('employee')}>By employee</button>
          </div>
        </div>
      </div>
      <p className="hint">Shifts and breaks across the day. The red line is now. Double-click a shift to edit it.</p>
      {body}
    </div>
  );
}
