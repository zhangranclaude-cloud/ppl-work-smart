'use strict';
// Builds a rehearsal input for the feedback tool from the Phase 5 mock data: an "Excel export" CSV
// and one combined raw log, with known defects planted so every data quality check has something to find.
// All data is fake. Run: node feedback/demo/make-demo.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PHASE5 = path.join(__dirname, '..', '..', 'mock', 'phase5');

// --all: every Phase 5 session, no planted defects (input for the Phase 7 rules rehearsal).
if (process.argv.includes('--all')) {
  const dir = path.join(__dirname, 'all');
  fs.mkdirSync(dir, { recursive: true });
  try { execFileSync(process.execPath, [path.join(PHASE5, 'check.js'), '--export', path.join(dir, 'export.csv')], { stdio: 'ignore' }); } catch { /* exit code 1 only means mismatches */ }
  const lines = fs.readdirSync(path.join(PHASE5, 'logs')).flatMap(f => fs.readFileSync(path.join(PHASE5, 'logs', f), 'utf8').split('\n').filter(Boolean)).sort();
  fs.writeFileSync(path.join(dir, 'raw.log'), lines.join('\n') + '\n');
  console.log(`all/export.csv and all/raw.log: ${lines.length} log lines`);
  process.exit(0);
}

const DIR = __dirname;
const SESSIONS = ['000000000005', '000000000006', '000000000007', '000000000009', '000000000014'];
const sid = n => `fa4e0000-0000-4000-8000-${n}`;

// 1. The SPL result for the mock data, in the export's 13-column layout.
const tmp = path.join(DIR, '.full-export.csv');
try { execFileSync(process.execPath, [path.join(PHASE5, 'check.js'), '--export', tmp], { stdio: 'ignore' }); } catch { /* exit code 1 only means mismatches */ }
const [head, ...lines] = fs.readFileSync(tmp, 'utf8').trim().split('\n');
fs.unlinkSync(tmp);
const cols = head.split(',');
const parse = line => { const out = []; line.replace(/("(?:[^"]|"")*"|[^,]*)(,|$)/g, (m, c, sep) => { if (m !== '' || sep) out.push(c.startsWith('"') ? c.slice(1, -1).replace(/""/g, '"') : c); return ''; }); return Object.fromEntries(cols.map((c, i) => [c, out[i] ?? ''])); };
let rows = lines.map(parse).filter(r => SESSIONS.some(n => r.sessionId === sid(n)));

const pad = (n, w = 2) => String(n).padStart(w, '0');
const shift = (t, ms) => { const d = new Date(Date.parse(t.replace(' ', 'T') + 'Z') + ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`; };
const find = (n, step) => rows.find(r => r.sessionId === sid(n) && r.Step === String(step));

// 2. Planted defects (each one should appear in the report).
const defects = [];
find('000000000014', 3).sessionId = '';
defects.push('session …014 step 3: sessionId emptied');
const wam = rows.find(r => r.sessionId === sid('000000000006') && r.Flow.includes('/wam/v1/limits [!]'));
wam.EventTime = shift(wam.EventTime, 2000);
defects.push(`session …006 step ${wam.Step}: EventTime moved +2000 ms`);
const wsResp = rows.find(r => r.sessionId === sid('000000000009') && r.Flow.includes('WS: /ws/fund/transfer [!]'));
rows = rows.filter(r => r !== wsResp);
defects.push(`session …009 step ${wsResp.Step}: WS response row deleted`);
const entResp = rows.find(r => r.sessionId === sid('000000000007') && r.Flow.includes('Enterprise: FundTransfer [!]'));
entResp.HopStatus = 'SUCCESS';
defects.push(`session …007 step ${entResp.Step}: HopStatus changed FAILED → SUCCESS`);
for (const r of rows) r.EventTime = shift(r.EventTime, 8 * 3600000);
defects.push('all rows: EventTime shown 8 h ahead of the raw log (export in UTC+8, logs in UTC)');

const cell = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
fs.writeFileSync(path.join(DIR, 'export.csv'), [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n') + '\n');

// 3. One raw log with the related request/response lines of these sessions, plus a WS call missing from the export.
const raw = [];
for (const f of fs.readdirSync(path.join(PHASE5, 'logs'))) {
  for (const line of fs.readFileSync(path.join(PHASE5, 'logs', f), 'utf8').split('\n').filter(Boolean)) {
    if (SESSIONS.some(n => line.includes(sid(n)) || line.includes(`FAKE-TXN-${n.slice(-2)}-`))) raw.push(line);
  }
}
const s6 = sid('000000000006');
const anchor = raw.filter(l => l.includes(s6)).map(l => l.slice(0, 23)).sort().pop();
const t = Date.parse(anchor.replace(' ', 'T') + 'Z') + 40;
const ts = ms => shift(new Date(ms).toISOString().slice(0, 23).replace('T', ' '), 0);
raw.push(`${ts(t)} INFO WSAppLog ["WS:" ${s6}] request: URL?: POST: /ws/customer/notify "transactionRef : FAKE-TXN-06-9"`);
raw.push(`${ts(t + 22)} INFO WSAppLog ["WS:" ${s6}] RESPONSE from Enterprise URL?: POST: /ws/customer/notify "transactionRef : FAKE-TXN-06-9" status: 200`);
defects.push('session …006: WS /ws/customer/notify request and response added to the log only');
raw.sort();
fs.writeFileSync(path.join(DIR, 'raw.log'), raw.join('\n') + '\n');

fs.writeFileSync(path.join(DIR, 'planted-defects.txt'), defects.map(d => `- ${d}`).join('\n') + '\n');
console.log(`export.csv: ${rows.length} rows; raw.log: ${raw.length} lines\nPlanted defects:\n${defects.map(d => `- ${d}`).join('\n')}`);
