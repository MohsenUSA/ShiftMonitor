import type { Employee, HistoryEntry, Shift } from './model.ts';
import { entryStatus, groupedHistory, scheduleSummary } from './status.ts';
import { fmtDur } from './time.ts';

const EXPORT_COLS = ['Employee', 'Type', 'Start', 'End', 'Duration (min)', 'Expected (min)', 'Status'];

function exportRow(h: HistoryEntry): (string | number)[] {
  const mins = h.durationMins ?? parseInt(h.duration);
  let status = entryStatus(h).label;
  if (h.ptoNote) status += ` · ${h.ptoNote}`;
  if (h.inStatus) status += ` · in: ${h.inStatus}`;
  if (h.outStatus) status += ` · out: ${h.outStatus}`;
  return [
    h.employee, h.type, h.start, h.end,
    isNaN(mins) ? (h.duration || '') : mins,
    h.expected ?? '',
    status,
  ];
}

function summaryRows(shifts: Shift[], employees: Employee[]): [string, string | number][] {
  const s = scheduleSummary(shifts, employees);
  return [
    ['Scheduled hours (net of lunch)', s.netHours],
    ['Total scheduled time', s.schedMins ? fmtDur(s.schedMins) : '0m'],
    ['Lunch breaks deducted', s.lunchCount],
    ['Team members', s.teamCount],
    ['Scheduled team members', s.scheduledCount],
  ];
}

const orderedEntries = (history: HistoryEntry[]) => groupedHistory(history).flatMap(([, entries]) => entries);

export function historyCSV(history: HistoryEntry[], shifts: Shift[], employees: Employee[]): string {
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ...summaryRows(shifts, employees).map(r => r.map(cell).join(',')),
    '',
    EXPORT_COLS.map(cell).join(','),
    ...orderedEntries(history).map(h => exportRow(h).map(cell).join(',')),
  ];
  return '﻿' + lines.join('\r\n');
}

/* ---------- Minimal XLSX writer (zip of OpenXML parts, stored uncompressed) ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function makeZip(files: { name: string; text: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;

  files.forEach(f => {
    const name = enc.encode(f.name), data = enc.encode(f.text);
    const crc = crc32(data);

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, data);

    const ce = new DataView(new ArrayBuffer(46));
    ce.setUint32(0, 0x02014b50, true);
    ce.setUint16(4, 20, true);
    ce.setUint16(6, 20, true);
    ce.setUint32(16, crc, true);
    ce.setUint32(20, data.length, true);
    ce.setUint32(24, data.length, true);
    ce.setUint16(28, name.length, true);
    ce.setUint32(42, offset, true);
    central.push(new Uint8Array(ce.buffer), name);

    offset += 30 + name.length + data.length;
  });

  const centralSize = central.reduce((s, a) => s + a.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);

  const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let p = 0;
  all.forEach(a => { out.set(a, p); p += a.length; });
  return out;
}

export function historyXLSX(history: HistoryEntry[], shifts: Shift[], employees: Employee[]): Uint8Array {
  const xmlEsc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // style ids: 0 plain · 1 header · 2 green · 3 red · 4 purple · 5 amber · 6 indigo
  const STYLE: Record<string, number> = { '#dcfce7': 2, '#fee2e2': 3, '#f3e8ff': 4, '#fffbeb': 5, '#eef2ff': 6 };
  const styleOf = (h: HistoryEntry) => STYLE[entryStatus(h).color] || 0;

  const cellXml = (v: unknown, col: number, row: number, s: number) => {
    const ref = String.fromCharCode(65 + col) + row;
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${s}" t="inlineStr"><is><t>${xmlEsc(v)}</t></is></c>`;
  };

  let rowsXml = '', r = 1;
  summaryRows(shifts, employees).forEach(([label, val]) => {
    rowsXml += `<row r="${r}">${cellXml(label, 0, r, 0)}${cellXml(val, 1, r, 0)}</row>`;
    r++;
  });
  r++;   // blank spacer row
  const headerRow = r;
  rowsXml += `<row r="${headerRow}">${EXPORT_COLS.map((c, i) => cellXml(c, i, headerRow, 1)).join('')}</row>`;
  orderedEntries(history).forEach((h, i) => {
    const s = styleOf(h), rr = headerRow + 1 + i;
    rowsXml += `<row r="${rr}">${exportRow(h).map((v, ci) => cellXml(v, ci, rr, s)).join('')}</row>`;
  });

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${[30, 14, 12, 12, 14, 14, 24].map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rowsXml}</sheetData></worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="12"/><name val="Calibri"/></font><font><b/><sz val="12"/><name val="Calibri"/></font></fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${['DCFCE7', 'FEE2E2', 'F3E8FF', 'FFFBEB', 'EEF2FF'].map(c => `<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="6" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="6" borderId="0" xfId="0" applyFill="1"/></cellXfs></styleSheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Break History" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

  return makeZip([
    { name: '[Content_Types].xml', text: contentTypes },
    { name: '_rels/.rels', text: rootRels },
    { name: 'xl/workbook.xml', text: workbook },
    { name: 'xl/_rels/workbook.xml.rels', text: wbRels },
    { name: 'xl/styles.xml', text: styles },
    { name: 'xl/worksheets/sheet1.xml', text: sheet },
  ]);
}
