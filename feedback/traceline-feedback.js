#!/usr/bin/env node
'use strict';
// Traceline feedback loop (Phase 6). Aligns a desensitized Splunk result export (CSV or XLSX) with the
// desensitized raw log file, then writes an alignment table, a data quality report and one PlantUML
// sequence diagram per session. No dependencies beyond Node.js.
//
// Usage: node feedback/traceline-feedback.js --excel <export.csv|.xlsx> --log <raw.log>
//          [--config <config.json>] [--out <dir>] [--tolerance <ms>]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- arguments and configuration ----------

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!args.excel || !args.log) {
  console.error('Usage: node feedback/traceline-feedback.js --excel <export.csv|.xlsx> --log <raw.log> [--config <config.json>] [--out <dir>] [--tolerance <ms>]');
  process.exit(2);
}

// Defaults describe the Phase 5 mock format. Put your real values in a config file (see feedback/README.md).
const DEFAULTS = {
  toleranceMs: 500,
  json: {
    session: 'header.sessionId', sessionKey: 'sessionId', txnRef: 'header.transactionRef', endpoint: 'header.apiName',
    httpStatus: 'header.httpStatus', respCode: 'data.responseCode', errCode: 'data.errorCode', errDesc: 'data.errorDescription',
  },
  httpSuccess: ['200'],
  successCodes: ['0000', '00000'],
  hostSuccess: ['0'],
  failPattern: '\\b(exception|timed? ?out)\\b',
  hostLinkRegex: '<RqUID>([^<]+)</RqUID>',
  hostStatusRegex: '<StatusCode>([^<]+)</StatusCode>',
  wsStatusRegex: '(?:RESPONSE from Enterprise|Response:).*\\bstatus:\\s*(\\d{3})',
  downstream: { '^/opi/': 'OPI', '^/wam/': 'WAM', '^/cus/': 'CUS' },
  svcSystems: {}, // main SvcCode → system behind EAI, e.g. { "FT01": "BWC" }, when known
  wsAsSelfCall: true,
};
const cfg = { ...DEFAULTS, ...(args.config ? JSON.parse(fs.readFileSync(args.config, 'utf8')) : {}) };
cfg.json = { ...DEFAULTS.json, ...cfg.json };
if (args.tolerance) cfg.toleranceMs = Number(args.tolerance);
const OUT = args.out || path.join(path.dirname(args.excel), 'out');
const FAIL_RE = cfg.failPattern ? new RegExp(cfg.failPattern, 'i') : null;

// Same layer, direction and session rules as queries/traceline.final.spl ([current] values).
const LAYERS = [
  { name: 'Host', order: 4, test: r => /<(?:\w+:)?SvcCode\b/.test(r) && /(request|response) message/i.test(r), req: /Request Message/i, resp: /Response Message/i },
  { name: 'WS', order: 3, test: r => /WSAppLog/.test(r), req: /request:/i, resp: /(RESPONSE from Enterprise|Response:)/i, sid: /\["?\s*WS:"?\s*([0-9a-fA-F-]{36})\s*\]/ },
  { name: 'Enterprise', order: 2, test: r => /\[Enterprise-HostMessage\]/.test(r), req: /\[Request\]/, resp: /\[Response\]/, sid: /\[Enterprise-HostMessage\]\['sessionIdentity'\]\s*:\s*([0-9a-fA-F-]{36})/ },
  { name: 'eComm', order: 1, test: r => /\[ECOMM-Message\]/.test(r), req: /- Request -/, resp: /- Response -/, sid: /\[ECOMM-Message\]\[\/sessionId\]\s*:\s*([0-9a-fA-F-]{36})/ },
];
const ORDER = Object.fromEntries(LAYERS.map(l => [l.name, l.order]));

// ---------- small helpers ----------

const pad = (n, w = 2) => String(n).padStart(w, '0');
const fmt = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`; };
const norm = v => (v == null || /^(null|none)?$/i.test(String(v).trim()) ? null : String(v).trim());
const normApi = s => String(s ?? '').trim().replace(/(Request|Response)$/i, '').toLowerCase();
const get = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const shortSid = sid => (sid && sid.length > 12 ? sid.slice(-12) : sid || 'none');
const cell = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
const mdCell = v => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function parseCsv(text) {
  const rows = []; let row = [], val = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { val += '"'; i++; } else if (c === '"') q = false; else val += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(val); val = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(val); rows.push(row); row = []; val = ''; }
    else val += c;
  }
  if (val !== '' || row.length) { row.push(val); rows.push(row); }
  return rows.filter(r => r.some(v => v !== ''));
}

// Minimal .xlsx reader: first worksheet, shared and inline strings, numbers as text.
function parseXlsx(buf) {
  const files = {};
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || buf.readUInt32LE(0) !== 0x04034b50) {
    console.error(`${args.excel} is not a valid .xlsx file (it is not a zip archive). Save the export as CSV, or re-save it from Excel as .xlsx.`);
    process.exit(1);
  }
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0, n = buf.readUInt16LE(eocd + 10); i < n; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42), name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
  }
  const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const texts = s => [...s.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unxml(m[1])).join('');
  const shared = [...(files['xl/sharedStrings.xml'] || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => texts(m[1]));
  const sheet = files['xl/worksheets/sheet1.xml'] || files[Object.keys(files).find(k => k.startsWith('xl/worksheets/sheet'))];
  const col = ref => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const rows = [];
  for (const [, inner] of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const [, attrs, body = ''] of inner.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1], type = (attrs.match(/\bt="(\w+)"/) || [])[1];
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      row[ref ? col(ref) : row.length] = type === 's' ? shared[+v] : type === 'inlineStr' ? texts(body) : v != null ? unxml(v) : '';
    }
    rows.push(Array.from(row, v => v ?? ''));
  }
  return rows.filter(r => r.some(v => v !== ''));
}

// Returns { ms, precision } with the time read as a naive local time (no time zone applied).
function parseTime(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,6}))?/);
  if (m) return { ms: Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? Math.round(+`0.${m[7]}` * 1000) : 0), precision: m[7] ? 'ms' : 's' };
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,](\d{1,3}))?/); // DD/MM/YYYY, as Excel re-saves it
  if (m) return { ms: Date.UTC(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0), +(m[7] || 0)), precision: m[7] ? 'ms' : m[6] ? 's' : 'min', excelFormat: true };
  if (/^\d+(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) return { ms: Math.round((+s - 25569) * 86400000), precision: 'ms', excelSerial: true };
  return null;
}
const PRECISION_MS = { ms: 0, s: 999, min: 59999 };

// ---------- read the raw log ----------

const TS = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:[.,](\d{1,6}))?/;
const logEvents = [];
const preamble = [];
fs.readFileSync(args.log, 'utf8').split(/\r?\n/).forEach((line, i) => {
  if (TS.test(line)) logEvents.push({ line: i + 1, raw: line });
  else if (logEvents.length && line.trim()) logEvents[logEvents.length - 1].raw += '\n' + line; // multi-line event
  else if (line.trim()) preamble.push(i + 1);
});

function deriveHop(e) {
  if (e.direction === 'Request') return 'N/A';
  if (e.jsonOK === 0) return 'UNKNOWN';
  if (e.httpStatus != null && !cfg.httpSuccess.includes(e.httpStatus)) return 'FAILED';
  if (e.errCode != null && !cfg.successCodes.includes(e.errCode)) return 'FAILED';
  if (e.errDesc != null) return 'FAILED';
  if (FAIL_RE && FAIL_RE.test(e.raw)) return 'FAILED';
  if (e.hostStatus.some(v => !cfg.hostSuccess.includes(v.trim().toUpperCase()))) return 'FAILED';
  if (e.respCode != null) return cfg.successCodes.includes(e.respCode) ? 'SUCCESS' : 'FAILED';
  if (e.hostStatus.length) return 'SUCCESS';
  if (e.wsStatus != null) return [...cfg.httpSuccess, ...cfg.successCodes].includes(e.wsStatus) ? 'SUCCESS' : 'FAILED';
  if (e.httpStatus != null) return 'SUCCESS';
  return 'UNKNOWN';
}

for (const e of logEvents) {
  const r = e.raw;
  const [, d, t, frac] = r.match(TS);
  e.time = Date.parse(`${d}T${t}Z`) + (frac ? Math.round(+`0.${frac}` * 1000) : 0);
  const layer = LAYERS.find(l => l.test(r));
  e.layer = layer ? layer.name : null;
  e.direction = layer ? (layer.req.test(r) ? 'Request' : layer.resp.test(r) ? 'Response' : null) : null;
  let json = null;
  if (layer && layer.order <= 2) {
    const blob = (r.match(/\{[\s\S]*/) || [])[0];
    if (blob !== undefined) { try { json = JSON.parse(blob); e.jsonOK = 1; } catch { e.jsonOK = 0; } }
    e.sidRex = blob ? (blob.match(new RegExp(`"${cfg.json.sessionKey}"\\s*:\\s*"([^"]+)"`)) || [])[1] : undefined;
  }
  e.json = json;
  const jx = k => norm(json ? get(json, cfg.json[k]) : null);
  Object.assign(e, { httpStatus: jx('httpStatus'), respCode: jx('respCode'), errCode: jx('errCode'), errDesc: jx('errDesc') });
  e.sessionId = jx('session') ?? e.sidRex ?? (layer && layer.sid ? (r.match(layer.sid) || [])[1] : undefined) ?? null;
  e.txnRef = jx('txnRef') ?? (r.match(/(?:transactionReferenceNumber|transactionRef)\s*:\s*([^"\s,;}]+)/) || [])[1] ?? null;
  e.hostRef = cfg.hostLinkRegex ? (r.match(new RegExp(cfg.hostLinkRegex)) || [])[1] ?? null : null;
  e.linkKey = e.txnRef ?? e.hostRef ?? null;
  e.svcCodes = [...r.matchAll(/<(?:\w+:)?SvcCode\b[^>]*>([^<]+)<\/(?:\w+:)?SvcCode>/g)].map(m => m[1]);
  e.hostStatus = cfg.hostStatusRegex ? [...r.matchAll(new RegExp(cfg.hostStatusRegex, 'g'))].map(m => m[1]) : [];
  e.wsStatus = cfg.wsStatusRegex ? (r.match(new RegExp(cfg.wsStatusRegex)) || [])[1] ?? null : null;
  e.url = (r.match(/URL\?:\s+\S+:\s*(\/\S+)/) || [])[1];
  e.api = e.layer === 'WS' ? e.url : e.layer === 'Host' ? e.svcCodes[0]
    : jx('endpoint') ?? (r.match(/([^\[\]\+\s"{}:,]+(?:Request|Response))\b/i) || [])[1];
  e.derived = e.direction ? deriveHop(e) : null;
}
// Host lines carry no session: link them through a LinkKey that belongs to exactly one session.
const linkSessions = new Map();
for (const e of logEvents) if (e.linkKey && e.sessionId) (linkSessions.get(e.linkKey) || linkSessions.set(e.linkKey, new Set()).get(e.linkKey)).add(e.sessionId);
for (const e of logEvents) {
  if (e.sessionId) { e.linkedBy = 'sessionId'; continue; }
  const s = e.linkKey && linkSessions.get(e.linkKey);
  if (s && s.size === 1) { e.sessionId = [...s][0]; e.linkedBy = 'LinkKey'; } else e.linkedBy = s ? 'ambiguous' : 'none';
}
const logUsable = logEvents.filter(e => e.layer && e.direction);

// ---------- read the export ----------

const EXPECTED = ['Step', 'EventTime', 'sessionId', 'Flow', 'HostServices', 'Params', 'ElapsedMs', 'RespCode', 'ErrCode', 'ErrDesc', 'HopStatus', 'SessionStatus', 'FirstFailedHop'];
const table = /\.xlsx$/i.test(args.excel) ? parseXlsx(fs.readFileSync(args.excel)) : parseCsv(fs.readFileSync(args.excel, 'utf8').replace(/^﻿/, ''));
const header = table[0].map(h => h.trim());
const colIndex = Object.fromEntries(EXPECTED.map(c => [c, header.findIndex(h => h.toLowerCase() === c.toLowerCase())]));
const missingCols = EXPECTED.filter(c => colIndex[c] < 0);
const extraCols = header.filter(h => !EXPECTED.some(c => c.toLowerCase() === h.toLowerCase()));
if (['EventTime', 'sessionId', 'Flow', 'HopStatus'].some(c => missingCols.includes(c))) {
  console.error(`The export is missing required columns: ${missingCols.join(', ')}. Found: ${header.join(', ')}`);
  process.exit(1);
}
const rows = table.slice(1).map((r, i) => {
  const o = { excelRow: i + 2 };
  for (const c of EXPECTED) o[c] = colIndex[c] >= 0 ? String(r[colIndex[c]] ?? '').trim() : '';
  const f = o.Flow.match(/(eComm|Enterprise|WS|Host):\s*(.*?)\s*\[([?!])\]\s*$/);
  o.layer = f ? f[1] : null;
  o.api = f ? f[2] : null;
  o.direction = f ? (f[3] === '?' ? 'Request' : 'Response') : null;
  o.t = parseTime(o.EventTime);
  o.sid = o.sessionId && !/^unlinked:/i.test(o.sessionId) ? o.sessionId : null;
  return o;
});

// ---------- align ----------

const key = (sid, layer, dir, api) => `${sid}|${layer}|${dir}|${normApi(api)}`;
const logByKey = new Map();
for (const e of logUsable) if (e.sessionId) (logByKey.get(key(e.sessionId, e.layer, e.direction, e.api)) || logByKey.set(key(e.sessionId, e.layer, e.direction, e.api), []).get(key(e.sessionId, e.layer, e.direction, e.api))).push(e);

// Time zone or clock offset between the export (Splunk user's time zone) and the raw timestamps,
// rounded to 15 minutes. Applied only if it explains at least half of the rows.
const offsetVotes = new Map();
let keyed = 0;
for (const r of rows) {
  const c = r.t && r.sid ? logByKey.get(key(r.sid, r.layer, r.direction, r.api)) : null;
  if (!c) continue;
  keyed++;
  const best = c.reduce((a, e) => (Math.abs(e.time - r.t.ms) < Math.abs(a - r.t.ms) ? e.time : a), c[0].time);
  const vote = Math.round((best - r.t.ms) / 900000) * 900000;
  offsetVotes.set(vote, (offsetVotes.get(vote) || 0) + 1);
}
const [topOffset, topVotes] = [...offsetVotes].sort((a, b) => b[1] - a[1])[0] || [0, 0];
const offsetMs = topOffset !== 0 && topVotes >= keyed / 2 ? topOffset : 0;

const used = new Set();
const tolFor = r => Math.max(cfg.toleranceMs, PRECISION_MS[r.t ? r.t.precision : 'ms']);
function nearest(r, candidates, maxDelta) {
  let best = null;
  for (const e of candidates) {
    if (used.has(e)) continue;
    const delta = e.time - (r.t.ms + offsetMs);
    if (Math.abs(delta) <= maxDelta && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { e, delta };
  }
  return best;
}
function assign(r, hit, level) { used.add(hit.e); Object.assign(r, { log: hit.e, delta: hit.delta, level }); }
const timed = rows.filter(r => r.t && r.layer);
for (const r of timed) { // 1. same session, layer, direction and API, within tolerance
  const hit = r.sid && nearest(r, logByKey.get(key(r.sid, r.layer, r.direction, r.api)) || [], tolFor(r));
  if (hit) assign(r, hit, Math.abs(hit.delta) <= PRECISION_MS[r.t.precision] ? 'EXACT' : 'NEAR');
}
for (const r of timed.filter(x => !x.log && x.sid)) { // 2. same keys, but the time is off by more than the tolerance
  const hit = nearest(r, logByKey.get(key(r.sid, r.layer, r.direction, r.api)) || [], Infinity);
  if (hit) assign(r, hit, 'TIME-MISMATCH');
}
for (const r of timed.filter(x => !x.log && x.sid)) { // 3. same session, layer and direction; the API differs
  const hit = nearest(r, logUsable.filter(e => e.sessionId === r.sid && e.layer === r.layer && e.direction === r.direction), tolFor(r));
  if (hit) assign(r, hit, 'WEAK-API');
}
for (const r of timed.filter(x => !x.log && !x.sid)) { // 4. no session in the export: layer, direction and API only
  const hit = nearest(r, logUsable.filter(e => e.layer === r.layer && e.direction === r.direction && normApi(e.api) === normApi(r.api)), tolFor(r));
  if (hit) { assign(r, hit, 'NO-SID'); if (hit.e.sessionId) { r.sid = hit.e.sessionId; r.sidInferred = true; } }
}
for (const r of rows) if (!r.level) r.level = 'NONE';

// ---------- pair requests and responses, per session ----------

const sessions = new Map();
for (const r of rows) if (r.sid) (sessions.get(r.sid) || sessions.set(r.sid, []).get(r.sid)).push(r);
for (const list of sessions.values()) list.sort((a, b) => (+a.Step || 0) - (+b.Step || 0) || (a.t?.ms ?? 0) - (b.t?.ms ?? 0));

// Walks a session in step order with a call stack: a response closes the latest open request with
// the same layer and API; requests left open above it never got a response.
function pairCalls(list) {
  const stack = [], pairs = new Map(), unanswered = [], orphans = [];
  for (const r of list) {
    if (r.direction === 'Request') {
      // An open request in a deeper layer (or another Host call) cannot be this request's caller: it never got a response.
      while (stack.length && (ORDER[stack[stack.length - 1].layer] > ORDER[r.layer] || (r.layer === 'Host' && stack[stack.length - 1].layer === 'Host'))) unanswered.push(stack.pop());
      r.parent = stack.length ? stack[stack.length - 1] : null;
      if (r.parent) r.parent.hasChild = true;
      stack.push(r);
      continue;
    }
    const i = stack.map(x => `${x.layer}|${normApi(x.api)}`).lastIndexOf(`${r.layer}|${normApi(r.api)}`);
    if (i < 0) { orphans.push(r); continue; }
    unanswered.push(...stack.splice(i + 1));
    const req = stack.pop();
    pairs.set(req, r); pairs.set(r, req);
  }
  unanswered.push(...stack);
  return { pairs, unanswered, orphans };
}
const sessionCalls = new Map([...sessions].map(([sid, list]) => [sid, pairCalls(list)]));

// ---------- data quality ----------

const dq = {
  noSession: rows.filter(r => !r.sessionId || /^unlinked:/i.test(r.sessionId)),
  unparsed: rows.filter(r => !r.layer || !r.t),
  missingResponse: [], missingRequest: [],
  timeBeyond: rows.filter(r => r.level === 'TIME-MISMATCH'),
  weak: rows.filter(r => ['WEAK-API', 'NO-SID'].includes(r.level)),
  noLog: rows.filter(r => r.level === 'NONE'),
  unmappedLog: logUsable.filter(e => !used.has(e)),
  ignoredLog: logEvents.filter(e => !e.layer || !e.direction),
  hopNotInExcel: [],
  contradictions: [],
  sessionStatus: [],
  excelFormat: rows.some(r => r.t && r.t.excelFormat),
  excelSerial: rows.some(r => r.t && r.t.excelSerial),
};
// The raw response for an export request that has no response row, if the log has one.
const logResponseFor = (sid, r) => dq.unmappedLog.find(e => e.sessionId === sid && e.layer === r.layer && e.direction === 'Response'
  && normApi(e.api) === normApi(r.api) && e.time >= r.t.ms + offsetMs);
for (const [sid, c] of sessionCalls) {
  dq.missingResponse.push(...c.unanswered.map(r => ({ sid, r })));
  dq.missingRequest.push(...c.orphans.map(r => ({ sid, r })));
}
for (const e of dq.unmappedLog) {
  const list = e.sessionId ? sessions.get(e.sessionId) : null;
  if (!list || !list.some(r => r.layer === e.layer && normApi(r.api) === normApi(e.api))) dq.hopNotInExcel.push(e);
}
for (const r of rows) {
  if (r.direction !== 'Response' || !r.log || !r.HopStatus) continue;
  if (r.log.derived !== r.HopStatus) dq.contradictions.push(r);
}
// SessionStatus recomputed from the export's own rows, with the same rules as the SPL.
for (const [sid, list] of sessions) {
  const entry = Math.min(...list.map(r => ORDER[r.layer] || 9));
  const entryResults = list.filter(r => ORDER[r.layer] === entry && r.direction === 'Response').map(r => r.HopStatus);
  const failed = list.filter(r => r.HopStatus === 'FAILED');
  const expected = entryResults.includes('FAILED') ? 'FAILED'
    : failed.length && entryResults.includes('SUCCESS') ? 'PARTIAL'
    : failed.length ? 'FAILED'
    : list.some(r => r.HopStatus === 'UNKNOWN') || sessionCalls.get(sid).unanswered.length || !entryResults.length ? 'UNKNOWN' : 'SUCCESS';
  const stated = [...new Set(list.map(r => r.SessionStatus).filter(Boolean))];
  if (stated.length !== 1 || stated[0] !== expected) dq.sessionStatus.push({ sid, stated: stated.join(' / ') || '(empty)', expected });
}

// ---------- PlantUML ----------

const COLOR = { SUCCESS: '#green', FAILED: '#red', UNKNOWN: '#orange' };
const downstreamOf = url => { for (const [re, name] of Object.entries(cfg.downstream)) if (new RegExp(re, 'i').test(url || '')) return name; return null; };
const route = r => ({
  eComm: ['App', 'eComm'],
  Enterprise: ['eComm', 'Enterprise'],
  WS: ['Enterprise', downstreamOf(r.api) || (cfg.wsAsSelfCall ? 'Enterprise' : 'WS')],
  Host: ['Enterprise', 'EAI'],
}[r.layer]);
const evidence = r => (r.level === 'NONE' ? ' <i>(Excel only)</i>' : r.level === 'TIME-MISMATCH' ? ' <i>(log time differs)</i>'
  : r.level === 'WEAK-API' ? ' <i>(API differs in log)</i>' : '') + (r.sidInferred ? ' <i>(session inferred)</i>' : '')
  + (dq.contradictions.includes(r) ? ` <i>(raw log says ${r.log.derived})</i>` : '');
const hostPairsFromLog = e => {
  if (!e || !e.svcCodes.length) return '';
  const pairs = [];
  for (let i = 0; i < e.svcCodes.length; i += 2) pairs.push(`${e.svcCodes[i]} ~ ${e.svcCodes[i + 1] ?? '?'}`);
  return pairs.map((p, i) => `${p}${e.hostStatus[i] != null ? `: ${e.hostStatus[i]}` : ''}`).join('\\n');
};

function plantuml(sid, list) {
  const { pairs } = sessionCalls.get(sid);
  const first = list.find(r => r.SessionStatus) || {};
  const used = new Set(['App', 'eComm']);
  for (const r of list) if (r.layer) route(r).forEach(p => used.add(p));
  const order = ['App', 'eComm', 'Enterprise', 'WS', 'EAI', ...Object.values(cfg.downstream)];
  const out = [
    '@startuml',
    `title Session ${sid}\\nSessionStatus: ${first.SessionStatus || 'n/a'} | FirstFailedHop: ${first.FirstFailedHop || 'none'}`,
    'hide footbox',
    'skinparam responseMessageBelowArrow true',
    'skinparam maxMessageSize 260',
    ...order.filter(p => used.has(p)).map(p => (p === 'App' ? 'actor App' : `participant ${p}`)),
  ];
  const open = [];
  const closeUnanswered = r => {
    const inLog = logResponseFor(sid, r);
    out.push(`note over ${route(r)[1]} #FFE0B2 : [${r.Step}] ${inLog
      ? `response missing from the export\\n(raw log line ${inLog.line}: ${inLog.derived})` : 'no response in export or raw log'}`, `deactivate ${route(r)[1]}`);
  };
  for (const r of list) {
    if (!r.layer) continue;
    const [from, to] = route(r);
    const label = r.layer === 'WS' && to === 'Enterprise' ? `WS ${r.api}` : r.api;
    if (r.direction === 'Request') {
      const resp = pairs.get(r);
      const color = resp ? COLOR[resp.HopStatus] || '#orange' : '#orange';
      const svc = r.layer === 'Host' && r.HostServices ? ` (${r.HostServices})` : '';
      out.push(`${from} -[${color}]> ${to} : [${r.Step}] ${label}${svc}${evidence(r)}`, `activate ${to}`);
      open.push(r);
      continue;
    }
    const req = pairs.get(r);
    if (req) {
      while (open.length && open[open.length - 1] !== req) closeUnanswered(open.pop());
      open.pop();
      if (!req.hasChild && ['eComm', 'Enterprise'].includes(r.layer)) out.push(`note over ${to} #EEEEEE : <i>internal processing only (inferred: no downstream call logged)</i>`);
    }
    const color = COLOR[r.HopStatus] || '#orange';
    const elapsed = r.ElapsedMs ? ` · ${r.ElapsedMs} ms` : '';
    out.push(`${to} -[${color}]-> ${from} : [${r.Step}] ${r.RespCode || r.HopStatus}${elapsed}${req ? '' : ' <i>(request not in export)</i>'}${evidence(r)}`);
    if (r.HopStatus === 'FAILED') {
      const detail = [r.ErrCode && `ErrCode: ${r.ErrCode}`, r.ErrDesc && `ErrDesc: ${r.ErrDesc}`,
        r.layer === 'Host' && hostPairsFromLog(r.log) && `Sub-services (from log):\\n${hostPairsFromLog(r.log)}`].filter(Boolean);
      out.push(`note right of ${to} #FFCDD2 : <b>FAILED</b>${detail.length ? '\\n' + detail.join('\\n') : ''}`);
    }
    if (req) out.push(`deactivate ${to}`);
  }
  while (open.length) closeUnanswered(open.pop());
  out.push(
    'legend right',
    '  <color:green>green</color> success · <color:red>red</color> failed · <color:orange>orange</color> unknown or no response',
    '  <i>(Excel only)</i> = no matching raw log line · grey note = inferred',
    'endlegend',
    '@enduml');
  return out.join('\n') + '\n';
}

// ---------- write outputs ----------

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'alignment.csv'), [
  ['excelRow', 'Step', 'sessionId', 'layer', 'direction', 'api', 'excelTime', 'logLine', 'logTime', 'deltaMs', 'match'].join(','),
  ...rows.map(r => [r.excelRow, r.Step, r.sessionId, r.layer, r.direction, r.api, r.t ? fmt(r.t.ms) : r.EventTime, r.log?.line ?? '',
    r.log ? fmt(r.log.time) : '', r.delta ?? '', r.level].map(cell).join(',')),
].join('\n') + '\n');

const diagrams = [];
for (const [sid, list] of [...sessions].sort()) {
  const file = `session-${shortSid(sid)}.puml`;
  fs.writeFileSync(path.join(OUT, file), plantuml(sid, list));
  diagrams.push({ sid, file, list });
}

const levelCounts = rows.reduce((m, r) => ({ ...m, [r.level]: (m[r.level] || 0) + 1 }), {});
const rowRef = r => `row ${r.excelRow} (step ${r.Step || '?'}, ${r.layer || '?'} ${r.direction || ''} ${r.api || ''})`;
const logRef = e => `line ${e.line} (${fmt(e.time)}, ${e.layer} ${e.direction} ${e.api || ''}, session ${shortSid(e.sessionId)})`;
const list = (items, fn, none = 'None.') => (items.length ? items.map(x => `- ${fn(x)}`).join('\n') : none);

const md = [];
md.push('# Traceline feedback report', '');
md.push('## 1. Inputs', '');
md.push(`- **Export:** \`${path.basename(args.excel)}\`: ${rows.length} rows, ${sessions.size} session(s).`);
md.push(`- **Columns:** ${missingCols.length ? `missing ${missingCols.join(', ')}` : 'all 13 expected columns present'}${extraCols.length ? `; extra: ${extraCols.join(', ')}` : ''}.`);
md.push(`- **EventTime format:** ${[...new Set(rows.map(r => (r.t ? r.t.precision : 'unreadable')))].join(', ')} precision${dq.excelFormat ? '. **Excel has rewritten the times as text**; milliseconds may be lost, which weakens matching' : ''}${dq.excelSerial ? '. Times are stored as Excel date numbers; converted, milliseconds kept' : ''}.`);
md.push(`- **Raw log:** \`${path.basename(args.log)}\`: ${logEvents.length} events (${logEvents.filter(e => e.raw.includes('\n')).length} multi-line), ${logUsable.length} recognised as a layer request or response${preamble.length ? `; ${preamble.length} line(s) before the first timestamp ignored` : ''}.`);
md.push(`- **Clock offset:** ${offsetMs ? `log = export ${offsetMs > 0 ? '+' : '−'} ${Math.abs(offsetMs) / 3600000} h (detected from ${topVotes} of ${keyed} rows, applied before matching)` : 'none detected'}.`);
md.push(`- **Tolerance:** ±${cfg.toleranceMs} ms after the offset (widened to the export's time precision when it has no milliseconds).`, '');

md.push('## 2. Alignment', '');
md.push('Keys: sessionId, layer, direction and API (with any `Request`/`Response` suffix ignored), then the nearest timestamp. Full table: `alignment.csv`.', '');
md.push('| Match | Meaning | Rows |', '|---|---|---|');
for (const [lvl, meaning] of [['EXACT', 'All keys match; same timestamp'], ['NEAR', `All keys match; timestamp within ±${cfg.toleranceMs} ms`],
  ['TIME-MISMATCH', 'All keys match, but the timestamp is beyond tolerance'], ['WEAK-API', 'Same session, layer and direction within tolerance; the API differs'],
  ['NO-SID', 'Export row has no session; matched on layer, direction, API and time'], ['NONE', 'No raw log line found']]) md.push(`| ${lvl} | ${meaning} | ${levelCounts[lvl] || 0} |`);
md.push('');

md.push('## 3. Data quality checks', '');
md.push('### 3.1 Rows with no sessionId', '', list(dq.noSession, r => `${rowRef(r)}: \`${r.sessionId || '(empty)'}\`${r.sidInferred ? ` → log line ${r.log.line} belongs to session \`${shortSid(r.sid)}\` (used in that diagram, marked "session inferred")` : ''}`), '');
md.push('### 3.2 Missing request or response (in the export)', '');
md.push(list([...dq.missingResponse.map(x => ({ ...x, kind: 'request with no response' })), ...dq.missingRequest.map(x => ({ ...x, kind: 'response with no request' }))],
  x => {
    if (x.kind !== 'request with no response') return `Session \`${shortSid(x.sid)}\` ${rowRef(x.r)}: ${x.kind}`;
    const inLog = logResponseFor(x.sid, x.r);
    return `Session \`${shortSid(x.sid)}\` ${rowRef(x.r)}: request with no response. ` + (inLog
      ? `**Raw log line ${inLog.line} has the response**, so the export is missing a row (filtered out, or lost in export or desensitizing).`
      : 'The raw log has no response either: a genuine missing response, such as a timeout or a request still in flight.');
  }), '');
md.push(`### 3.3 Timestamps beyond tolerance (±${cfg.toleranceMs} ms)`, '', list(dq.timeBeyond, r => `${rowRef(r)}: export ${fmt(r.t.ms)}, log line ${r.log.line} ${fmt(r.log.time)} (Δ ${r.delta - 0} ms after offset)`), '');
if (dq.weak.length) md.push('Weaker matches to review:', '', list(dq.weak, r => `${rowRef(r)} → log line ${r.log.line} (${r.level}${r.level === 'WEAK-API' ? `: log API \`${r.log.api}\`` : ''})`), '');
md.push('### 3.4 Export rows with no raw log line', '', list(dq.noLog, rowRef), '');
md.push('### 3.5 Raw log lines not mapped to any export row', '', list(dq.unmappedLog, logRef), '');
if (dq.ignoredLog.length) md.push(`Also ${dq.ignoredLog.length} log event(s) not recognised as any layer's request or response (for example ${dq.ignoredLog.slice(0, 3).map(e => `line ${e.line}`).join(', ')}).`, '');
md.push('### 3.6 Layers or hops in the log but not in the export', '', list(dq.hopNotInExcel, e => `${logRef(e)}: no export row for ${e.layer} \`${e.api}\` in this session`), '');
md.push('### 3.7 HopStatus that contradicts the raw response', '', list(dq.contradictions, r => `${rowRef(r)}: export says **${r.HopStatus}**, raw line ${r.log.line} gives **${r.log.derived}** (http=${r.log.httpStatus ?? '-'}, code=${r.log.respCode ?? '-'}, errCode=${r.log.errCode ?? '-'}, errDesc=${r.log.errDesc ?? '-'}${r.log.hostStatus.length ? `, host=${r.log.hostStatus.join('/')}` : ''}${r.log.wsStatus ? `, ws=${r.log.wsStatus}` : ''})`), '');
md.push('### 3.8 SessionStatus consistency', '', list(dq.sessionStatus, x => `Session \`${shortSid(x.sid)}\`: export says ${x.stated}, its own rows give ${x.expected}`), '');

md.push('## 4. Sequence diagrams', '');
for (const d of diagrams) {
  const st = d.list.find(r => r.SessionStatus) || {};
  md.push(`- \`${d.file}\`: session \`${d.sid}\`, ${st.SessionStatus || 'n/a'}${st.FirstFailedHop ? `, first failed: ${st.FirstFailedHop}` : ''}`);
}
md.push('');

md.push('## 5. Diagram vs evidence', '');
for (const d of diagrams) {
  const backed = d.list.filter(r => ['EXACT', 'NEAR'].includes(r.level)).length;
  const c = sessionCalls.get(d.sid);
  const internal = d.list.filter(r => r.direction === 'Request' && !r.hasChild && c.pairs.has(r) && ['eComm', 'Enterprise'].includes(r.layer));
  md.push(`**Session \`${shortSid(d.sid)}\`**`, '');
  md.push(`- **Directly supported:** ${backed} of ${d.list.length} arrows match a raw log line with all keys and the timestamp.`);
  const weak = d.list.filter(r => !['EXACT', 'NEAR'].includes(r.level));
  if (weak.length) md.push(`- **Weaker evidence:** ${weak.map(r => `step ${r.Step} (${r.level})`).join(', ')}.`);
  md.push('- **Inferred:** the App participant (no App logs; the first arrow is inferred from the eComm request)' +
    (internal.length ? `; "internal processing only" for ${internal.map(r => `${r.layer} ${r.api}`).join(', ')}, because no downstream call was logged between its request and response` : '') +
    (cfg.wsAsSelfCall && d.list.some(r => r.layer === 'WS' && !downstreamOf(r.api)) ? '; WS calls drawn as Enterprise calling itself (assumes WS is Enterprise\'s own web service)' : '') +
    (d.list.some(r => r.layer === 'WS' && downstreamOf(r.api)) ? '; downstream participants named from the URL prefix (`downstream` in the config)' : '') +
    (d.list.some(r => r.layer === 'Host') ? '; EAI as the caller\'s target: the log shows the EAI message, not which system behind EAI (BWC, ICH) handled it' : '') + '.');
  if (c.unanswered.length) md.push(`- **No response logged:** ${c.unanswered.map(r => `step ${r.Step} ${r.layer} ${r.api}`).join(', ')}. The orange arrow shows that nothing came back, not why.`);
  md.push('');
}

md.push('## 6. Host SvcCode pairing checks', '');
const svcNotes = [];
for (const e of logUsable.filter(x => x.layer === 'Host' && x.svcCodes.length)) {
  const codes = e.svcCodes, where = logRef(e);
  const mains = new Set(codes.filter((_, i) => i % 2 === 0));
  if (codes.length % 2) {
    svcNotes.push(`${where}: odd number of SvcCode values (${codes.join(', ')}). The last pair becomes \`X ~ X\`; the layout may be "one main, then subs".`);
  } else if (codes.length > 2 && !codes.slice(1).includes(codes[0])) {
    svcNotes.push(`${where}: SvcCode values ${codes.join(', ')} never repeat the first code. If the layout is "one main, then subs", the pairs shown are wrong.`);
  } else if (mains.size > 1) {
    svcNotes.push(`${where}: more than one main service (${[...mains].join(', ')}) in one message. The arrow is labelled with the first (${codes[0]}) only.`);
  }
  if (e.direction === 'Response' && e.hostStatus.length && e.hostStatus.length !== Math.ceil(codes.length / 2)) svcNotes.push(`${where}: ${e.hostStatus.length} status value(s) for ${Math.ceil(codes.length / 2)} pair(s). Per-sub-service status cannot be matched to pairs.`);
}
md.push(svcNotes.length ? svcNotes.map(n => `- ${n}`).join('\n') : '- No problems found in the logged Host messages: every message has main/sub pairs with one status per pair.', '');
md.push('Always true of this diagram: the Host arrow is labelled with the **first** main code, and its colour reflects the **whole** message. A failed sub-service turns the hop red; the note lists each pair\'s status from the raw log so you can see which one.', '');

fs.writeFileSync(path.join(OUT, 'report.md'), md.filter(l => l !== undefined).join('\n'));

// Phase 7: rules across sessions (rules.md, decision-flow.puml, summary.md).
require('./rules')({ cfg, sessions, sessionCalls, logUsable, downstreamOf, shortSid, fmt, OUT });
console.log(`Wrote ${path.join(OUT, 'report.md')}, alignment.csv and ${diagrams.length} diagram(s).`);
console.log(`Rows: ${rows.length}; match levels: ${Object.entries(levelCounts).map(([k, v]) => `${k} ${v}`).join(', ')}; offset ${offsetMs / 3600000} h.`);
