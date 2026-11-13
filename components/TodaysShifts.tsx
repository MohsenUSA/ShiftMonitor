'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as A from '@/lib/actions';
import type { Shift, TeamSnapshot } from '@/lib/model';
import { breakState, clockStatus, sortShifts, withinShift } from '@/lib/status';
import {
  OFF_KINDS, addMinutes, fmtDur, fmtIso, formatTime, fullOffKind, isFullOff, isoToHM, minToHM, minutesBetween,
  nowAbs, offBlocks, offSummary, type OffBlock, workSpan,
} from '@/lib/time';
import { Avatar } from './Panels';
import { useCopy } from './Toast';
import { useNow } from './useNow';

type Run = (action: (ctx: A.Ctx) => A.Result) => A.Result;

/* ---------- Edit panel ---------- */

function initialOff(shift: Shift, kind: 'pto' | 'drop'): { when: A.OffWhen; mins: string } {
  const total = minutesBetween(shift.start, shift.end);
  const s = shift[`${kind}Start`] || 0, e = shift[`${kind}End`] || 0;
  if (s >= total && s > 0) return { when: 'full', mins: '' };
  if (s) return { when: 'start', mins: String(s) };
  if (e) return { when: 'end', mins: String(e) };
  return { when: 'none', mins: '' };
}

function EditPanel({ shift, run, onClose }: { shift: Shift; run: Run; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(shift.start);
  const [end, setEnd] = useState(shift.end);
  const [clockIn, setClockIn] = useState(shift.clockIn ? isoToHM(shift.clockIn) : '');
  const [clockOut, setClockOut] = useState(shift.clockOut ? isoToHM(shift.clockOut) : '');
  const [pto, setPto] = useState(() => initialOff(shift, 'pto'));
  const [drop, setDrop] = useState(() => initialOff(shift, 'drop'));
  const [punches, setPunches] = useState<Record<number, { start: string; end: string }>>(() => {
    const p: Record<number, { start: string; end: string }> = {};
    shift.breaks.forEach((b, i) => {
      if (b.status !== 'scheduled') p[i] = { start: isoToHM(b.actualStart!), end: b.actualEnd ? isoToHM(b.actualEnd) : '' };
    });
    return p;
  });

  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, []);

  // Live preview of the working window after PTO and drop.
  let preview = '', previewBad = false;
  if (start && end) {
    const total = minutesBetween(start, end);
    const p = A.offFromForm(pto.when, Number(pto.mins), total), d = A.offFromForm(drop.when, Number(drop.mins), total);
    const offS = p.start + d.start, offE = p.end + d.end;
    if (offS + offE > total) { preview = '⚠ off-time exceeds the shift'; previewBad = true; }
    else if (offS + offE === total && total > 0) preview = '→ full shift off';
    else if (offS + offE > 0) preview = `→ works ${formatTime(addMinutes(start, offS))} – ${formatTime(addMinutes(start, total - offE))}`;
  }

  const save = () => {
    const r = run(ctx => A.saveShiftEdit(ctx, shift.id, {
      start, end, clockIn, clockOut, punches,
      pto: { when: pto.when, mins: Number(pto.mins) || 0 },
      drop: { when: drop.when, mins: Number(drop.mins) || 0 },
    }));
    if (!r.error && r.ops.length) onClose();
  };

  const offRow = (label: string, v: typeof pto, set: typeof setPto, testId: string) => (
    <div className="ef-row">
      <span className="ef-label">{label}</span>
      <select value={v.when} style={{ width: 'auto' }} data-testid={testId}
              onChange={e => set({ ...v, when: e.target.value as A.OffWhen })}>
        <option value="none">none</option>
        <option value="start">start of shift</option>
        <option value="end">end of shift</option>
        <option value="full">full shift</option>
      </select>
      {(v.when === 'start' || v.when === 'end') && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input type="number" min={0} step={15} placeholder="min" value={v.mins} style={{ width: 74 }}
                 onChange={e => set({ ...v, mins: e.target.value })} />
          <span className="ef-dash">min</span>
        </span>
      )}
    </div>
  );

  return (
    <div className="edit-panel" ref={ref}>
      <div className="ef-row">
        <span className="ef-label">Shift</span>
        <input type="time" value={start} onChange={e => setStart(e.target.value)} aria-label="Shift start" />
        <span className="ef-dash">–</span>
        <input type="time" value={end} onChange={e => setEnd(e.target.value)} aria-label="Shift end" />
      </div>
      <div className="ef-row">
        <span className="ef-label">Clock in/out</span>
        <input type="time" value={clockIn} onChange={e => setClockIn(e.target.value)} aria-label="Clock in" />
        <span className="ef-dash">–</span>
        <input type="time" value={clockOut} onChange={e => setClockOut(e.target.value)} aria-label="Clock out" />
      </div>
      {offRow('PTO', pto, setPto, 'pto-when')}
      {offRow('Shift drop', drop, setDrop, 'drop-when')}
      <div className="ef-row">
        <span className="ef-label" />
        <span className="ef-hint" style={{ marginLeft: 0, color: previewBad ? 'var(--red)' : undefined }}>{preview}</span>
      </div>
      {shift.breaks.map((br, i) => punches[i] && (
        <div className="ef-row" key={i}>
          <span className="ef-label">{br.type}</span>
          <input type="time" value={punches[i].start} aria-label={`${br.type} start`}
                 onChange={e => setPunches({ ...punches, [i]: { ...punches[i], start: e.target.value } })} />
          <span className="ef-dash">–</span>
          <input type="time" value={punches[i].end} aria-label={`${br.type} end`}
                 onChange={e => setPunches({ ...punches, [i]: { ...punches[i], end: e.target.value } })} />
        </div>
      ))}
      <div className="ef-row">
        <button className="btn-xs btn-start" onClick={save}>Save</button>
        <button className="btn-ghost btn-sm" onClick={onClose}>Cancel</button>
        <span className="ef-hint">clear a time to remove that punch</span>
      </div>
    </div>
  );
}

/* ---------- Rows ---------- */

function OffChip({ b }: { b: OffBlock }) {
  const k = OFF_KINDS[b.kind];
  const from = formatTime(minToHM(b.from)), to = formatTime(minToHM(b.to));
  return (
    <div className={`break-cell ${k.cls}`} title={`${k.word} ${fmtDur(b.mins)} · ${from} – ${to}`}>
      <span className="dot" />
      <span className="bc-label">{k.emoji} {k.word}</span>
      <span className="bc-time">{from} – {to}</span>
      <span className="bc-status">{fmtDur(b.mins)}</span>
    </div>
  );
}

function ShiftRow({ shift, snap, run, editing, onEdit, onCloseEdit }: {
  shift: Shift; snap: TeamSnapshot; run: Run; editing: boolean; onEdit: () => void; onCloseEdit: () => void;
}) {
  const now = useNow();
  const copy = useCopy();
  const name = A.employeeName(snap, shift.employeeId);
  const remove = () => { if (confirm('Remove this shift?')) run(ctx => A.deleteShift(ctx, shift.id)); };

  const who = (sub: ReactNode) => (
    <div className="shift-who">
      <Avatar name={name} />
      <div style={{ minWidth: 0 }}>
        <div className="shift-name" title={`${name} — click to copy`} onClick={() => copy(name)}>{name}</div>
        {sub}
      </div>
    </div>
  );

  if (editing) {
    return (
      <div className="shift-row" data-testid="shift-row">
        {who(<div className="shift-time">editing shift…</div>)}
        <EditPanel shift={shift} run={run} onClose={onCloseEdit} />
      </div>
    );
  }

  const actionsTail = (
    <>
      <button className="btn-ghost btn-sm" onClick={onEdit} title="Edit shift times" aria-label="Edit shift">✎</button>
      <button className="btn-ghost btn-sm" onClick={remove} title="Remove shift" aria-label="Remove shift">✕</button>
    </>
  );

  if (isFullOff(shift)) {
    const k = OFF_KINDS[fullOffKind(shift)];
    return (
      <div className="shift-row" data-testid="shift-row">
        {who(<div className="shift-time">{formatTime(shift.start)} – {formatTime(shift.end)}</div>)}
        <div className="shift-main">
          <div className={`pto-full ${k.cls}`}>{k.emoji} Full-shift {k.word}</div>
          <div className="shift-actions">{actionsTail}</div>
        </div>
      </div>
    );
  }

  const { s, e } = workSpan(shift);
  const progress = Math.max(0, Math.min(100, (nowAbs(shift, now) - s) / (e - s) * 100));
  const off = offSummary(shift);
  const inShift = withinShift(shift, now);
  const blocks = offBlocks(shift);
  const cin = shift.clockIn ? clockStatus(shift.clockIn, s, shift, 'in') : null;
  const cout = shift.clockOut ? clockStatus(shift.clockOut, e, shift, 'out') : null;

  return (
    <div className="shift-row" data-testid="shift-row">
      {who(
        <>
          <div className="shift-time">{formatTime(shift.start)} – {formatTime(shift.end)}</div>
          {off && <div className="pto-badge" title={`Working hours ${formatTime(minToHM(s))} – ${formatTime(minToHM(e))}`}>{off}</div>}
          {(cin || cout) && (
            <div className="stamps">
              {cin && <span className={`stamp ${cin.color}`}>In {fmtIso(shift.clockIn!)} · {cin.label}</span>}
              {cout && <span className={`stamp ${cout.color}`}>Out {fmtIso(shift.clockOut!)} · {cout.label}</span>}
            </div>
          )}
        </>,
      )}
      <div className="shift-main">
        <div className="shift-breaks">
          {blocks.filter(b => b.edge === 'start').map(b => <OffChip key={b.kind + b.edge} b={b} />)}
          {shift.breaks.map((br, i) => {
            const st = breakState(br, shift, now);
            const un = br.type === 'Unscheduled';
            let timer = null;
            if (br.status === 'active') {
              const secs = Math.max(0, Math.floor((+now - +new Date(br.actualStart!)) / 1000));
              timer = <span className={'timer' + (secs > br.expected * 60 ? ' over' : '')}>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>;
            }
            return (
              <div key={i} className={`break-cell ${st.key}${un ? ' unsched' : ''}`} data-testid="break-cell"
                   title={`${br.type} · ${formatTime(br.scheduled)} · ${un ? 'unplanned' : br.expected + ' min'}`}>
                <span className="dot" />
                <span className="bc-label">{br.type}</span>
                <span className="bc-time">{formatTime(br.scheduled)}</span>
                {timer}
                <span className="bc-status">{st.label}</span>
                {br.status === 'scheduled' && (inShift
                  ? <button className="btn-xs btn-start" onClick={() => run(ctx => A.startBreak(ctx, shift.id, i))}>Start</button>
                  : <button className="btn-xs btn-start" disabled title="Breaks can only be taken during the shift">Start</button>)}
                {br.status === 'active' && <button className="btn-xs btn-end" onClick={() => run(ctx => A.endBreak(ctx, shift.id, i))}>End</button>}
              </div>
            );
          })}
          {blocks.filter(b => b.edge === 'end').map(b => <OffChip key={b.kind + b.edge} b={b} />)}
        </div>
        <div className="shift-actions">
          {!shift.clockIn
            ? <button className="btn-xs btn-start" onClick={() => run(ctx => A.clockIn(ctx, shift.id))}>Clock In</button>
            : !shift.clockOut && <button className="btn-xs btn-end" onClick={() => run(ctx => A.clockOut(ctx, shift.id))}>Clock Out</button>}
          <button className="btn-outline btn-xs" title="Log an unscheduled break starting now" disabled={!inShift}
                  onClick={() => run(ctx => A.addUnscheduledBreak(ctx, shift.id))}>+ Break</button>
          {actionsTail}
        </div>
      </div>
      <div className="shift-progress-line" style={{ width: `${progress}%` }} />
    </div>
  );
}

export function TodaysShifts({ snap, run, editingId, setEditingId }: {
  snap: TeamSnapshot; run: Run; editingId: string | null; setEditingId: (id: string | null) => void;
}) {
  const shifts = sortShifts(snap.shifts);
  return (
    <div className="card">
      <div className="card-head-row"><h2>Today&apos;s Shifts</h2></div>
      <p className="hint">Live view of every scheduled break. Rows change color as breaks come due.</p>
      <div data-testid="dashboard">
        {!shifts.length
          ? <div className="empty"><span className="empty-icon">🗓️</span>No shifts scheduled.<br />Add an employee and schedule a shift to get started.</div>
          : shifts.map(s => (
            <ShiftRow key={s.id} shift={s} snap={snap} run={run} editing={editingId === s.id}
                      onEdit={() => setEditingId(s.id)} onCloseEdit={() => setEditingId(null)} />
          ))}
      </div>
    </div>
  );
}
