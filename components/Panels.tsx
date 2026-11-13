'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import * as A from '@/lib/actions';
import type { Employee, TeamSnapshot } from '@/lib/model';
import {
  buildBulkRows, extractName, extractShiftSegments, findTimes, matchEmployeesInText, revalidateBulk,
  type BulkRow,
} from '@/lib/parse';
import { breakRulesSummary } from '@/lib/rules';
import { avatarColor, clampTimeInput, initials, parseHM, stepHM } from '@/lib/time';

type Run = (action: (ctx: A.Ctx) => A.Result, opts?: { inlineError?: boolean }) => A.Result;

export function Avatar({ name }: { name: string }) {
  return <span className="avatar" style={{ background: avatarColor(name) }}>{initials(name)}</span>;
}

/* ---------- Team roster ---------- */

/* Inline rename. Mounted fresh each time editing starts, so it begins from
   the current name. keepOpen: Enter stays put so a clash can be corrected;
   blur (the user is leaving) reverts instead. */
function PillEditor({ emp, onDone, run }: { emp: Employee; onDone: () => void; run: Run }) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(emp.name);
  const done = useRef(false);

  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);

  const save = (keepOpen: boolean) => {
    if (done.current) return;
    const r = run(ctx => A.renameEmployee(ctx, emp.id, value));
    if (r.error && keepOpen) { input.current?.select(); return; }
    done.current = true;
    onDone();
  };

  return (
    <span className="pill">
      <Avatar name={emp.name} />
      <input ref={input} className="pill-edit" type="text" value={value} autoComplete="off" maxLength={40}
             aria-label={`Rename ${emp.name}`}
             onChange={e => setValue(e.target.value)}
             onKeyDown={e => {
               if (e.key === 'Enter') { e.preventDefault(); save(true); }
               else if (e.key === 'Escape') { e.preventDefault(); done.current = true; onDone(); }
             }}
             onBlur={() => save(false)} />
    </span>
  );
}

function EmployeePill({ emp, editing, onEdit, onDone, run }: {
  emp: Employee; editing: boolean; onEdit: () => void; onDone: () => void; run: Run;
}) {
  if (editing) return <PillEditor emp={emp} onDone={onDone} run={run} />;
  return (
    <span className="pill">
      <Avatar name={emp.name} />
      <button type="button" className="pill-name" onClick={onEdit} title="Rename">{emp.name}</button>
      <button className="pill-x" title="Remove" aria-label={`Remove ${emp.name}`} onClick={() => {
        run(ctx => {
          const has = ctx.shifts.some(s => s.employeeId === emp.id);
          if (!confirm(has ? `Remove ${emp.name} and their scheduled shifts?` : `Remove ${emp.name}?`)) return { ops: [] };
          return A.deleteEmployee(ctx, emp.id);
        });
      }}>×</button>
    </span>
  );
}

export function TeamPanel({ snap, run, accRef }: { snap: TeamSnapshot; run: Run; accRef: RefObject<HTMLDetailsElement | null> }) {
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const roster = [...snap.employees].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const add = () => {
    if (!name.trim()) return;
    run(ctx => A.addEmployee(ctx, name));
    setName('');
    input.current?.focus();
  };

  return (
    <details className="card acc" ref={accRef}>
      <summary>👥 Team <span className="acc-hint">add &amp; manage employees</span></summary>
      <div className="acc-body">
        <div className="add-row">
          <input ref={input} placeholder="Employee name" value={name} aria-label="Employee name"
                 onChange={e => setName(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') add(); }} />
          <button onClick={add} disabled={!name.trim()}>Add</button>
        </div>
        <div className="roster" data-testid="roster">
          {roster.length
            ? roster.map(e => (
              <EmployeePill key={e.id} emp={e} run={run} editing={editingId === e.id}
                            onEdit={() => setEditingId(e.id)} onDone={() => setEditingId(null)} />
            ))
            : <div className="empty" style={{ width: '100%' }}><span className="empty-icon">👋</span>No employees yet</div>}
        </div>
      </div>
    </details>
  );
}

/* ---------- Schedule a shift ---------- */

function TimeInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const el = e.currentTarget;
    const onMinutes = (el.selectionStart ?? 0) >= 3;   // 'HH:MM' — colon is index 2
    onChange(stepHM(value, e.key === 'ArrowUp' ? 1 : -1, onMinutes));
    requestAnimationFrame(() => (onMinutes ? el.setSelectionRange(3, 5) : el.setSelectionRange(0, 2)));
  };
  return (
    <input type="text" id={id} value={value} placeholder="HH:MM" maxLength={5} inputMode="numeric" autoComplete="off"
           onChange={e => onChange(clampTimeInput(e.target.value))}
           onKeyDown={onKeyDown}
           onBlur={() => { const v = parseHM(value); if (v) onChange(v); }} />
  );
}

const snippet = (s: string) => (s.length > 32 ? s.slice(0, 31) + '…' : s);

function BulkPreview({ rows, setRows, onAdd, shifts }: {
  rows: BulkRow[]; setRows: (r: BulkRow[]) => void; onAdd: () => void; shifts: TeamSnapshot['shifts'];
}) {
  const valid = rows.filter(r => r.valid);
  const newCount = valid.filter(r => r.isNew).length;
  return (
    <div className="bulk-preview" data-testid="bulk-preview">
      <div className="bulk-head">
        {valid.length} of {rows.length} ready to add
        {newCount ? ` · ${newCount} new employee${newCount === 1 ? '' : 's'}` : ''}
      </div>
      <div className="bulk-list">
        {rows.map(r => (
          <div key={r.id} className={'bulk-row ' + (r.valid ? 'ok' : 'bad')}>
            <span className="bulk-ic">{r.valid ? '✓' : '⚠'}</span>
            {r.isNew
              ? <input className="bulk-name-edit" value={r.name} placeholder="New employee name"
                       onChange={e => setRows(revalidateBulk(rows.map(x => (x.id === r.id ? { ...x, name: e.target.value } : x)), shifts))}
                       onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
              : <span className="bulk-name" title={r.line}>{r.name || <em>{snippet(r.line)}</em>}</span>}
            <span className="bulk-time">{r.start || '—'}–{r.end || '—'}</span>
            {r.valid
              ? <span className={'bulk-reason' + (r.isNew ? ' new' : '')}>{r.isNew ? '＋ new' : ''}</span>
              : <span className="bulk-reason">{r.reason}</span>}
            <button className="bulk-x" title="Remove row"
                    onClick={() => setRows(revalidateBulk(rows.filter(x => x.id !== r.id), shifts))}>×</button>
          </div>
        ))}
      </div>
      <button className="btn-primary" disabled={!valid.length} onClick={onAdd}>
        Add {valid.length} shift{valid.length === 1 ? '' : 's'}
      </button>
    </div>
  );
}

export function SchedulePanel({ snap, run, accRef }: { snap: TeamSnapshot; run: Run; accRef: RefObject<HTMLDetailsElement | null> }) {
  const { employees, shifts } = snap;
  const [paste, setPaste] = useState('');
  const [status, setStatus] = useState<{ text: string; warn: boolean } | null>(null);
  const [bulk, setBulk] = useState<BulkRow[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [start, setStart] = useState('00:00');
  const [end, setEnd] = useState('00:00');
  const [error, setError] = useState<string | null>(null);

  // A teammate may remove the selected employee while this form is open.
  const selected = selectedId && employees.some(e => e.id === selectedId) ? selectedId : null;
  const roster = [...employees].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const q = search.trim().toLowerCase();
  const chipMatches = roster.filter(e => e.name.toLowerCase().includes(q));
  const close = () => { if (accRef.current) accRef.current.open = false; };

  /* A single shift fills the form inline; two or more open the review list. */
  const onPaste = (text: string) => {
    setPaste(text);
    if (!text.trim()) { setStatus(null); setBulk([]); return; }
    const segments = extractShiftSegments(text);
    if (segments.length >= 2) { setStatus(null); setBulk(buildBulkRows(segments, employees, shifts)); return; }
    setBulk([]);

    const matches = employees.length ? matchEmployeesInText(text, employees) : [];
    const times = findTimes(text);
    // Unknown name + a clear window → review list, where a new employee is created.
    if (matches.length === 0 && times.length === 2 && extractName(text)) {
      setStatus(null);
      setBulk(buildBulkRows(segments, employees, shifts));
      return;
    }

    const parts: string[] = [];
    let warn = false;
    if (!employees.length) { parts.push('add a team member first'); warn = true; }
    else if (matches.length === 1) { setSelectedId(matches[0].id); setError(null); parts.push(`employee ${matches[0].name}`); }
    else if (matches.length === 0) { parts.push('no matching employee — pick one'); warn = true; }
    else { parts.push(`${matches.length} employees matched — pick one`); warn = true; }

    if (times.length === 2) { setStart(times[0]); setEnd(times[1]); parts.push(`start ${times[0]}, end ${times[1]}`); }
    else if (times.length === 0) { parts.push('no times — enter manually'); warn = true; }
    else if (times.length === 1) { parts.push('only one time — enter manually'); warn = true; }
    else { parts.push('more than two times — enter manually'); warn = true; }
    setStatus({ text: (warn ? '⚠ ' : '✓ ') + parts.join(' · '), warn });
  };

  const addShift = () => {
    const r = run(ctx => A.addShift(ctx, selected, start, end), { inlineError: true });
    if (r.error) { setError(r.error); return; }
    setError(null);
    setSelectedId(null);
    setStart('00:00'); setEnd('00:00');
    onPaste('');
    close();
  };

  const addBulk = () => {
    run(ctx => A.addBulkShifts(ctx, bulk));
    setPaste(''); setBulk([]); setStatus(null);
    close();
  };

  const newDay = () => {
    run(ctx => {
      if (!ctx.shifts.length && !ctx.history.length) return A.newDay(ctx);
      const tip = ctx.history.length ? '\n\nTip: export the Break History (CSV/Spreadsheet) first if you need it for records.' : '';
      if (!confirm('Start a new day?\n\nThis removes all shifts and the break history for everyone on this team. Your employees are kept for scheduling.' + tip)) return { ops: [] };
      return A.newDay(ctx);
    });
    close();
  };

  return (
    <details className="card acc" ref={accRef}>
      <summary>🗓️ Schedule a Shift <span className="acc-hint">breaks planned automatically</span>
        <button className="btn-outline btn-sm acc-head-btn" title="Clear all shifts and break history, keep employees"
                onClick={e => { e.preventDefault(); e.stopPropagation(); newDay(); }}>⟳ New Day</button>
      </summary>
      <div className="acc-body">
        <p className="hint">{breakRulesSummary(snap.team.breakRules)}</p>

        <label htmlFor="shiftPaste">Paste shift text <span className="lbl-hint">optional</span></label>
        <textarea id="shiftPaste" className="shift-paste" rows={2} value={paste} onChange={e => onPaste(e.target.value)}
                  placeholder="Paste one or more rows — one shift per line. Auto-detects the employee and times (HH:MM); unknown names open a review list where you can edit them and add as new employees." />
        {status && <div className={'parse-status ' + (status.warn ? 'warn' : 'ok')}>{status.text}</div>}
        {bulk.length > 0 && <BulkPreview rows={bulk} setRows={setBulk} onAdd={addBulk} shifts={shifts} />}

        <label>Employee</label>
        {roster.length > 1 && (
          <input className="chip-search" type="text" placeholder="🔍 Search employees…" autoComplete="off"
                 value={search} onChange={e => setSearch(e.target.value)} />
        )}
        <div className="select-chips" data-testid="employee-chips">
          {!roster.length
            ? <span className="hint" style={{ margin: 0 }}>Add a team member first.</span>
            : chipMatches.length
              ? chipMatches.map(e => (
                <button key={e.id} type="button" className={'chip' + (e.id === selected ? ' selected' : '')}
                        onClick={() => { setSelectedId(selected === e.id ? null : e.id); setError(null); }}>
                  {e.name}
                </button>
              ))
              : <span className="hint" style={{ margin: 0 }}>No employees match “{q}”.</span>}
        </div>
        {error && <div className="form-error">{error}</div>}

        <div className="field-row">
          <div>
            <label htmlFor="shiftStart">Start <span className="lbl-hint">24h</span></label>
            <TimeInput id="shiftStart" value={start} onChange={setStart} />
          </div>
          <div>
            <label htmlFor="shiftEnd">End <span className="lbl-hint">24h</span></label>
            <TimeInput id="shiftEnd" value={end} onChange={setEnd} />
          </div>
        </div>

        <button className="btn-primary" onClick={addShift} disabled={!(selected && parseHM(start) && parseHM(end))}>Add Shift</button>
      </div>
    </details>
  );
}
