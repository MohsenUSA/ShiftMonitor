'use client';

import * as A from '@/lib/actions';
import { historyCSV, historyXLSX } from '@/lib/export';
import type { TeamSnapshot } from '@/lib/model';
import { groupedHistory } from '@/lib/status';
import { Avatar } from './Panels';

type Run = (action: (ctx: A.Ctx) => A.Result) => A.Result;

function download(name: string, mime: string, content: BlobPart) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const today = () => new Date().toISOString().slice(0, 10);

export function History({ snap, run, toast }: { snap: TeamSnapshot; run: Run; toast: (m: string) => void }) {
  const { history, shifts, employees } = snap;

  const exportCSV = () => {
    if (!history.length) { toast('No history to export yet.'); return; }
    download(`break-history-${today()}.csv`, 'text/csv;charset=utf-8', historyCSV(history, shifts, employees));
    toast('CSV exported.');
  };
  const exportXLSX = () => {
    if (!history.length) { toast('No history to export yet.'); return; }
    download(`break-history-${today()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      historyXLSX(history, shifts, employees) as BlobPart);
    toast('Spreadsheet file exported — colors included.');
  };
  const clear = () => {
    if (!history.length || !confirm('Clear all break history for everyone on this team?')) return;
    run(ctx => A.clearHistory(ctx));
  };

  return (
    <div className="card">
      <div className="card-head-row">
        <h2>Break History</h2>
        <div className="head-actions">
          <button className="btn-outline btn-sm" onClick={exportCSV} title="Plain-data export">⬇ CSV</button>
          <button className="btn-outline btn-sm" onClick={exportXLSX} title="Spreadsheet export with color-coded cells">⬇ Spreadsheet</button>
          <button className="btn-ghost btn-sm" onClick={clear}>Clear</button>
        </div>
      </div>
      <p className="hint">Completed breaks, grouped by employee.</p>
      <div data-testid="history">
        {!history.length
          ? <div className="empty"><span className="empty-icon">📋</span>No completed breaks yet</div>
          : groupedHistory(history).map(([name, entries]) => {
            const breaks = entries.filter(h => h.type !== 'Shift');
            const shiftEntry = entries.find(h => h.type === 'Shift');
            const total = breaks.reduce((sum, h) => sum + (h.durationMins ?? (parseInt(h.duration) || 0)), 0);
            // Uncontrolled <details>: React never sets `open`, so expanded
            // groups stay expanded across live updates.
            return (
              <details className="hist-acc" key={name}>
                <summary>
                  <Avatar name={name} />
                  <span className="hist-name">{name}</span>
                  <span className="hist-types">{breaks.map(h => h.type).join(' · ')}</span>
                  <span className="hist-meta">
                    {breaks.length} break{breaks.length === 1 ? '' : 's'} · {total} min{shiftEntry ? ` · worked ${shiftEntry.duration}` : ''}
                  </span>
                  <span className="chev">▾</span>
                </summary>
                <table>
                  <thead><tr><th>Break</th><th>Start</th><th>End</th><th>Duration</th></tr></thead>
                  <tbody>
                    {entries.map(h => (
                      <tr key={h.id}>
                        <td>{h.type}{h.ptoNote && <span className="cell-note"> · {h.ptoNote}</span>}</td>
                        <td>{h.start}{h.inStatus && <span className="cell-note"> · {h.inStatus}</span>}</td>
                        <td>{h.end}{h.outStatus && <span className="cell-note"> · {h.outStatus}</span>}</td>
                        <td>{h.duration}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            );
          })}
      </div>
    </div>
  );
}
