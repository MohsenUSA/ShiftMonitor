'use client';

import * as A from '@/lib/actions';
import type { BreakRules, TeamSnapshot } from '@/lib/model';
import { BREAK_RULE_DEFAULTS, BREAK_RULE_FIELDS } from '@/lib/rules';
import { breakState, scheduleSummary } from '@/lib/status';
import { fmtDur, formatTime } from '@/lib/time';
import { useNow } from './useNow';

type Run = (action: (ctx: A.Ctx) => A.Result) => A.Result;

function Stats({ snap }: { snap: TeamSnapshot }) {
  const now = useNow();
  const { shifts, employees } = snap;
  const name = (id: string) => A.employeeName(snap, id);
  const active: string[] = [], dueSoon: string[] = [], overdue: string[] = [];

  shifts.forEach(s => s.breaks.forEach(b => {
    const st = breakState(b, s, now);
    const nm = name(s.employeeId);
    if (st.key === 'active') {
      const mins = Math.max(1, Math.floor((+now - +new Date(b.actualStart!)) / 60000));
      active.push(`${nm} — ${b.type}, ${fmtDur(mins)} so far`);
    } else if (st.key === 'soon' || st.key === 'upcoming') {
      dueSoon.push(`${nm} — ${b.type} at ${formatTime(b.scheduled)} (${st.label.toLowerCase()})`);
    } else if (st.key === 'overdue') {
      overdue.push(`${nm} — ${b.type} (${st.label.toLowerCase()}, was ${formatTime(b.scheduled)})`);
    }
  }));

  const scheduledIds = new Set(shifts.map(s => s.employeeId));
  const teamTip = employees.length
    ? employees.map(e => `${e.name}${scheduledIds.has(e.id) ? ' · scheduled today' : ' · no shift today'}`).join('\n')
    : 'No employees yet — add them in the Team panel';
  const scheduledNames = employees.filter(e => scheduledIds.has(e.id)).map(e => e.name);
  const tip = (lines: string[], empty: string) => (lines.length ? lines.join('\n') : empty);

  const sum = scheduleSummary(shifts, employees);
  const hoursTip = sum.shiftCount
    ? `${fmtDur(sum.schedMins)} scheduled across ${sum.shiftCount} shift${sum.shiftCount > 1 ? 's' : ''}`
      + (sum.lunchMins ? ` − ${fmtDur(sum.lunchMins)} (${sum.lunchCount} lunch break${sum.lunchCount > 1 ? 's' : ''})` : '')
      + ` = ${fmtDur(sum.netMins)} net`
    : 'No shifts scheduled yet';

  const cards = [
    { icon: '⏱️', bg: 'var(--green-soft)', label: 'Scheduled hrs', num: sum.shiftCount ? `${sum.netHours}h` : '0h', tip: hoursTip },
    { icon: '👥', bg: 'var(--accent-soft)', label: 'Team members', num: employees.length, tip: teamTip },
    { icon: '🗓️', bg: 'var(--blue-soft)', label: 'Scheduled', num: scheduledIds.size,
      tip: scheduledNames.length ? scheduledNames.join('\n') : 'No team members scheduled yet' },
    { icon: '☕', bg: 'var(--blue-soft)', label: 'On break now', num: active.length, tip: tip(active, 'No one is on a break right now') },
    { icon: '⏰', bg: 'var(--amber-soft)', label: 'Due in 30 min', num: dueSoon.length, tip: tip(dueSoon, 'No breaks due in the next 30 minutes') },
    { icon: '⚠️', bg: 'var(--red-soft)', label: 'Overdue', num: overdue.length, tip: tip(overdue, 'No overdue breaks') },
  ];

  return (
    <div className="stats">
      {cards.map(c => (
        <div className="stat" key={c.label} title={c.tip} data-testid={`stat-${c.label}`}>
          <div className="stat-icon" style={{ background: c.bg }}>{c.icon}</div>
          <div>
            <div className="stat-num">{c.num}</div>
            <div className="stat-label">{c.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BreakRulesPanel({ rules, run, toast }: { rules: BreakRules; run: Run; toast: (m: string) => void }) {
  const apply = (next: BreakRules, msg: string) => {
    run(ctx => A.setBreakRules(ctx, next));
    toast(msg);
  };
  return (
    <details className="card acc rules-tile">
      <summary>
        <span className="rules-head">
          <span className="rules-title">⏱️ Break Rules</span>
          <span className="acc-hint rules-hint">quick breaks &amp; lunch timing</span>
        </span>
      </summary>
      <div className="acc-body">
        <div className="rules-grid">
          {BREAK_RULE_FIELDS.map(f => 'group' in f
            ? <div className="rules-sub" key={f.group}>{f.group}</div>
            : (
              <div key={f.key}>
                <label htmlFor={`rule_${f.key}`}>{f.label}</label>
                <select id={`rule_${f.key}`} value={rules[f.key]}
                        onChange={e => apply({ ...rules, [f.key]: Number(e.target.value) },
                          'Break rules updated — upcoming breaks re-planned.')}>
                  {f.opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </div>
            ))}
        </div>
        <div className="rules-actions">
          <button className="btn-outline btn-sm" onClick={() => apply({ ...BREAK_RULE_DEFAULTS }, 'Break rules reset to defaults.')}>
            Reset to defaults
          </button>
          <span className="ef-hint">Changes re-plan the breaks that haven&apos;t started yet on today&apos;s shifts — for everyone on this team.</span>
        </div>
        <p className="rules-note">⚠️ These timings are scheduling defaults, not legal guidance. Please refer to your
          respective state and local labor laws for the quick-break and lunch-break rules that apply to your
          workplace, and set the times above to match.</p>
      </div>
    </details>
  );
}

export function StatsRow({ snap, run, toast }: { snap: TeamSnapshot; run: Run; toast: (m: string) => void }) {
  return (
    <div className="stats-row">
      <Stats snap={snap} />
      <BreakRulesPanel rules={snap.team.breakRules} run={run} toast={toast} />
    </div>
  );
}
