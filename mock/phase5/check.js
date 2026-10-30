'use strict';
// Local pre-check for Phase 5: re-implements the logic of queries/traceline.final.spl in JavaScript
// (with the mock placeholder values from generate.js) and compares it with the expected results.
// It approximates Splunk; it does not replace running phase5-test.spl in Splunk.
// Run: node mock/phase5/check.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = __dirname;
const BASE_PATH = '/var/log/pods/';
const HTTP_OK = ['200'];
const CODE_OK = ['0000', '00000'];
const HOST_OK = ['0'];
const FAIL = /\b(exception|timed? ?out)\b/i;

function readCsv(file) {
  const rows = [];
  for (const line of fs.readFileSync(path.join(DIR, file), 'utf8').trim().split(/\r?\n/)) {
    const cells = [];
    line.replace(/("(?:[^"]|"")*"|[^,]*)(,|$)/g, (m, cell, sep) => {
      if (m === '' && !sep) return '';
      cells.push(cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell);
      return '';
    });
    rows.push(cells);
  }
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

// ---- load events ----
let events = [];
for (const file of fs.readdirSync(path.join(DIR, 'logs'))) {
  for (const raw of fs.readFileSync(path.join(DIR, 'logs', file), 'utf8').split(/\r?\n/).filter(Boolean)) {
    const [, d, t] = raw.match(/^(\S+) (\S+)/);
    events.push({ raw, source: BASE_PATH + file, time: Date.parse(`${d}T${t}Z`) });
  }
}

// ---- 0. base search (search terms are case-insensitive) ----
const glob = p => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
const has = (r, s) => r.toLowerCase().includes(s.toLowerCase());
events = events.filter(({ raw: r, source: s }) =>
  (glob(BASE_PATH + 'sit-01-online-*.log').test(s) && (has(r, '[ECOMM-Message]') || has(r, '[Enterprise-HostMessage]'))) ||
  (['microservice-sit-01-ms-*.log', 'microservice-sit-01_rewards*.log', 'microservice-sit-01_bfs*.log'].some(p => glob(BASE_PATH + p).test(s)) &&
    ((has(r, 'WSAppLog') && (has(r, 'request:') || has(r, 'RESPONSE from Enterprise') || has(r, 'Response:'))) ||
     (has(r, 'EAI') && has(r, 'SvcCode') && (has(r, 'Request Message') || has(r, 'Response Message'))))));

const get = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const norm = v => (v == null || /^(null|none)?$/i.test(String(v).trim()) ? null : String(v).trim());

for (const e of events) {
  const r = e.raw;
  // 1. layer
  e.LayerName = /<(?:\w+:)?SvcCode\b/.test(r) && /(request|response) message/i.test(r) ? 'Host'
    : /WSAppLog/.test(r) ? 'WS' : /\[Enterprise-HostMessage\]/.test(r) ? 'Enterprise' : /\[ECOMM-Message\]/.test(r) ? 'eComm' : null;
  e.Layer = { eComm: 1, Enterprise: 2, WS: 3, Host: 4 }[e.LayerName];
  // 2. JSON
  const blob = e.Layer <= 2 ? (r.match(/\{[\s\S]*/) || [])[0] : undefined;
  let json = null;
  if (blob !== undefined) { try { json = JSON.parse(blob); e.JsonOK = 1; } catch { e.JsonOK = 0; } }
  const jx = p => norm(json ? get(json, p) : null);
  Object.assign(e, { sidJson: jx('header.sessionId'), TxnJson: jx('header.transactionRef'), EndpointJson: jx('header.apiName'),
    HttpStatus: jx('header.httpStatus'), RespCode: jx('data.responseCode'), ErrCode: jx('data.errorCode'), ErrDesc: jx('data.errorDescription') });
  e.sidRex = blob ? (blob.match(/"sessionId"\s*:\s*"([^"]+)"/) || [])[1] : undefined;
  // 3. direction
  const L = e.LayerName;
  e.Direction =
    L === 'eComm' ? (/- Request -/.test(r) ? 'Request' : /- Response -/.test(r) ? 'Response' : null)
    : L === 'Enterprise' ? (/\[Request\]/.test(r) ? 'Request' : /\[Response\]/.test(r) ? 'Response' : null)
    : L === 'WS' ? (/request:/i.test(r) ? 'Request' : /(RESPONSE from Enterprise|Response:)/i.test(r) ? 'Response' : null)
    : L === 'Host' ? (/Request Message/i.test(r) ? 'Request' : /Response Message/i.test(r) ? 'Response' : null) : null;
  // 4. keys
  const sidEcommText = (r.match(/\[ECOMM-Message\]\[\/sessionId\]\s*:\s*([0-9a-fA-F-]{36})/) || [])[1];
  const sidEntText = (r.match(/\[Enterprise-HostMessage\]\['sessionIdentity'\]\s*:\s*([0-9a-fA-F-]{36})/) || [])[1];
  const sidWS = (r.match(/\["?\s*WS:"?\s*([0-9a-fA-F-]{36})\s*\]/) || [])[1];
  const sidEcomm = L === 'eComm' ? e.sidJson ?? e.sidRex ?? sidEcommText : undefined;
  const sidEnt = L === 'Enterprise' ? e.sidJson ?? e.sidRex ?? sidEntText : undefined;
  e.sessionId = sidEcomm ?? sidEnt ?? sidWS ?? null;
  const txnText = (r.match(/(?:transactionReferenceNumber|transactionRef)\s*:\s*([^"\s,;}]+)/) || [])[1];
  e.transactionRef = e.TxnJson ?? txnText ?? null;
  const hostRef = (r.match(/<RqUID>([^<]+)<\/RqUID>/) || [])[1];
  e.LinkKey = e.transactionRef ?? hostRef ?? null;
  if (e.LinkKey && /^(n\/?a|null|none|-|0+)$/i.test(e.LinkKey)) e.LinkKey = null;
  // 5. endpoint, URL, service codes
  const epText = (r.match(/([^\[\]\+\s"{}:,]+(?:Request|Response))\b/i) || [])[1];
  e.Endpoint = e.EndpointJson ?? epText ?? null;
  e.EnterpriseEndpoint = (r.match(/([^\]]+)\]/) || [])[1];
  e.URL = (r.match(/URL\?:\s+\S+:\s*(\/\S+)/) || [])[1];
  e.SvcCode = [...r.matchAll(/<(?:\w+:)?SvcCode\b[^>]*>([^<]+)<\/(?:\w+:)?SvcCode>/g)].map(m => m[1]);
  // 6. status
  e.WsStatus = (r.match(/(?:RESPONSE from Enterprise|Response:).*\bstatus:\s*(\d{3})/) || [])[1] ?? null;
  e.HostStatus = [...r.matchAll(/<StatusCode>([^<]+)<\/StatusCode>/g)].map(m => m[1]);
  e.HostBad = e.HostStatus.filter(v => !HOST_OK.includes(v.trim().toUpperCase()));
}
events = events.filter(e => e.LayerName && e.Direction && (e.LayerName !== 'Host' || e.SvcCode.length));

// 4. linking: only through a LinkKey that belongs to exactly one session
const byLink = new Map();
for (const e of events) if (e.LinkKey && e.sessionId) {
  if (!byLink.has(e.LinkKey)) byLink.set(e.LinkKey, new Set());
  byLink.get(e.LinkKey).add(e.sessionId);
}
for (const e of events) {
  const sids = e.LinkKey ? byLink.get(e.LinkKey) : null;
  const via = sids && sids.size === 1 ? [...sids][0] : null;
  e.LinkedBy = e.sessionId ? 'sessionId' : via ? 'LinkKey' : sids && sids.size > 1 ? 'ambiguous' : 'none';
  e.sessionId = e.sessionId ?? via ?? 'unlinked:' + crypto.createHash('md5').update(e.raw).digest('hex').slice(0, 12);
}

// 6. HopStatus
for (const e of events) {
  e.HopStatus =
    e.Direction === 'Request' ? 'N/A'
    : e.JsonOK === 0 ? 'UNKNOWN'
    : e.HttpStatus != null && !HTTP_OK.includes(e.HttpStatus) ? 'FAILED'
    : e.ErrCode != null && !CODE_OK.includes(e.ErrCode) ? 'FAILED'
    : e.ErrDesc != null ? 'FAILED'
    : FAIL.test(e.raw) ? 'FAILED'
    : e.HostBad.length ? 'FAILED'
    : e.RespCode != null ? (CODE_OK.includes(e.RespCode) ? 'SUCCESS' : 'FAILED')
    : e.HostStatus.length ? 'SUCCESS'
    : e.WsStatus != null ? ([...HTTP_OK, ...CODE_OK].includes(e.WsStatus) ? 'SUCCESS' : 'FAILED')
    : e.HttpStatus != null ? 'SUCCESS'
    : 'UNKNOWN';
  e.RespCode = e.RespCode ?? e.WsStatus ?? (e.HostStatus.length ? e.HostStatus.join(',') : null);
}

// 7. order, pairing, elapsed, missing responses
for (const e of events) e.SortKey = e.Direction === 'Request' ? e.Layer : -e.Layer;
events.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0) || a.time - b.time || a.SortKey - b.SortKey);
const stepOf = new Map(), lastWs = new Map(), lastReq = new Map(), counts = new Map();
for (const e of events) {
  e.Step = (stepOf.get(e.sessionId) || 0) + 1; stepOf.set(e.sessionId, e.Step);
  if (e.LayerName === 'WS' && e.URL) lastWs.set(e.sessionId, e.URL);
  const pairs = [];
  for (let i = 0; i < e.SvcCode.length; i += 2) pairs.push(`${e.SvcCode[i]} ~ ${e.SvcCode[i + 1] ?? e.SvcCode[i]}`);
  e.HostServices = e.LayerName === 'Host' ? pairs.join(' | ') : '';
  e.API = { eComm: e.Endpoint, Enterprise: e.Endpoint, WS: e.URL ?? lastWs.get(e.sessionId) ?? e.EnterpriseEndpoint ?? 'N/A',
    Host: e.SvcCode[0] ?? e.EnterpriseEndpoint }[e.LayerName];
  e.PairKey = e.LayerName === 'Host' ? e.SvcCode[0] ?? e.EnterpriseEndpoint ?? '' : String(e.API).replace(/(Request|Response)$/i, '');
  const key = `${e.sessionId}|${e.Layer}|${e.PairKey}`;
  if (e.Direction === 'Request') lastReq.set(key, e.time);
  e.ElapsedMs = e.Direction === 'Response' && lastReq.has(key) ? e.time - lastReq.get(key) : '';
  const c = counts.get(key) || { req: 0, resp: 0 };
  c[e.Direction === 'Request' ? 'req' : 'resp']++;
  counts.set(key, c);
}
for (const e of events) {
  const c = counts.get(`${e.sessionId}|${e.Layer}|${e.PairKey}`);
  e.RespMissing = e.Direction === 'Request' && c.resp < c.req ? 1 : 0;
}

// 8. SessionStatus and FirstFailedHop
const bySession = new Map();
for (const e of events) (bySession.get(e.sessionId) || bySession.set(e.sessionId, []).get(e.sessionId)).push(e);
const sessionResult = new Map();
for (const [sid, evs] of bySession) {
  const entry = Math.min(...evs.map(e => e.Layer));
  const entryResults = evs.filter(e => e.Layer === entry && e.Direction === 'Response').map(e => e.HopStatus);
  const failed = evs.filter(e => e.HopStatus === 'FAILED');
  const unknown = evs.filter(e => e.HopStatus === 'UNKNOWN').length;
  const missing = evs.reduce((n, e) => n + e.RespMissing, 0);
  const failKeys = failed.map(e => `${(e.time / 1000).toFixed(3)}|${9 - e.Layer}|${e.LayerName}: ${e.API ?? 'N/A'}`).sort();
  const status =
    sid.startsWith('unlinked:') ? 'UNKNOWN'
    : entryResults.includes('FAILED') ? 'FAILED'
    : failed.length && entryResults.includes('SUCCESS') ? 'PARTIAL'
    : failed.length ? 'FAILED'
    : unknown || missing || !entryResults.length ? 'UNKNOWN'
    : 'SUCCESS';
  sessionResult.set(sid, { status, firstFailedHop: failKeys.length ? failKeys[0].split('|')[2] : '' });
}

// ---- compare with expected ----
const expHops = readCsv('expected-hops.csv');
const expSessions = readCsv('expected-sessions.csv');
const got = new Map(events.map(e => [`${e.sessionId}|${e.Step}`, e]));
let problems = 0;
const rows = [];
for (const s of expSessions) {
  const mine = expHops.filter(h => h.sessionId === s.sessionId);
  const issues = [];
  for (const h of mine) {
    const e = got.get(`${h.sessionId}|${h.step}`);
    if (!e) { issues.push(`step ${h.step} missing`); continue; }
    const cmp = { layer: e.LayerName, direction: e.Direction, api: e.API, hopStatus: e.HopStatus,
      elapsedMs: String(e.ElapsedMs), hostServices: e.HostServices };
    for (const [k, v] of Object.entries(cmp)) if (String(v ?? '') !== h[k]) issues.push(`step ${h.step} ${k}: expected "${h[k]}", got "${v}"`);
  }
  const extra = (bySession.get(s.sessionId) || []).length - mine.length;
  if (extra > 0) issues.push(`${extra} unexpected extra rows`);
  const r = sessionResult.get(s.sessionId) || { status: '(none)', firstFailedHop: '' };
  if (r.status !== s.sessionStatus) issues.push(`SessionStatus: expected ${s.sessionStatus}, got ${r.status}`);
  if (r.firstFailedHop !== s.firstFailedHop) issues.push(`FirstFailedHop: expected "${s.firstFailedHop}", got "${r.firstFailedHop}"`);
  problems += issues.length;
  rows.push([s.scenario, s.sessionId.slice(-3), s.sessionStatus, r.status, s.firstFailedHop || '-', r.firstFailedHop || '-',
    `${mine.length}`, issues.length ? 'FAIL' : 'PASS']);
  for (const i of issues) rows.push(['', '', '', '', '', '', '', '  ' + i]);
}
const unlinked = events.filter(e => e.sessionId.startsWith('unlinked:')).length;
const head = ['Scenario', 'Sid', 'Expected', 'Got', 'Expected FirstFailedHop', 'Got FirstFailedHop', 'Rows', 'Result'];
const w = head.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
const line = r => r.map((c, i) => String(c).padEnd(w[i])).join('  ');
console.log(line(head));
rows.forEach(r => console.log(line(r)));
console.log(`\n${events.length} rows after filtering, ${unlinked} unlinked, ${problems} mismatch(es).`);
process.exitCode = problems ? 1 : 0;

// --export <file.csv>: write the result in the column layout of the final SPL's table command,
// as a stand-in for a Splunk export.
const exportAt = process.argv.indexOf('--export');
if (exportAt > 0) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const fmt = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`; };
  const cell = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  const cols = ['Step', 'EventTime', 'sessionId', 'Flow', 'HostServices', 'Params', 'ElapsedMs', 'RespCode', 'ErrCode', 'ErrDesc', 'HopStatus', 'SessionStatus', 'FirstFailedHop'];
  const lines = events.map(e => {
    const indent = e.Layer === 1 ? '' : '-'.repeat(4 * e.Layer - 6) + '› ';
    const s = sessionResult.get(e.sessionId);
    return [e.Step, fmt(e.time), e.sessionId, `${indent}${e.LayerName}: ${e.API ?? 'N/A'} [${e.Direction === 'Request' ? '?' : '!'}]`,
      e.HostServices, e.transactionRef ? `TxnRefNo: ${e.transactionRef}` : '', e.ElapsedMs, e.RespCode, e.ErrCode, e.ErrDesc,
      e.HopStatus, s.status, s.firstFailedHop].map(cell).join(',');
  });
  fs.writeFileSync(process.argv[exportAt + 1], [cols.join(','), ...lines].join('\n') + '\n');
}
