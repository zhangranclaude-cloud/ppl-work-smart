'use strict';
// Phase 5 mock logs: writes fake, desensitized log lines for scenarios A–I, the expected result of
// each scenario, and a makeresults search that runs queries/traceline.final.spl on the mock events.
// Run: node mock/phase5/generate.js
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const MOCK = 'FAKE-DESENSITIZED';
const BASE_PATH = '/var/log/pods/';
const SRC = {
  online: 'sit-01-online-fake01.log',
  ms: 'microservice-sit-01-ms-fake01.log',
  bfs: 'microservice-sit-01_bfs-fake01.log',
};

// Placeholder values used for the mock run only. They describe the mock format, not your real logs.
const MOCK_PLACEHOLDERS = {
  BASE_PATH,
  JSON_BLOB_REGEX: '(?s)(?<JsonBlob>\\{.*)',
  JSON_SESSION_PATH: 'header.sessionId',
  JSON_SESSION_KEY: 'sessionId',
  JSON_TXNREF_PATH: 'header.transactionRef',
  JSON_ENDPOINT_PATH: 'header.apiName',
  JSON_HTTPSTATUS_PATH: 'header.httpStatus',
  JSON_RESPCODE_PATH: 'data.responseCode',
  JSON_ERRCODE_PATH: 'data.errorCode',
  JSON_ERRDESC_PATH: 'data.errorDescription',
  HTTP_SUCCESS_LIST: '"200"',
  SUCCESS_CODE_LIST: '"0000","00000"',
  HOST_LINK_REGEX: '<RqUID>(?<hostRef>[^<]+)</RqUID>',
  HOST_STATUS_REGEX: '<StatusCode>(?<HostStatus>[^<]+)</StatusCode>',
  HOST_SUCCESS_VALUES: '"0"',
  WS_STATUS_REGEX: '(?:RESPONSE from Enterprise|Response:).*\\bstatus:\\s*(?<WsStatus>\\d{3})',
  FAIL_PATTERN: '(?i)\\b(exception|timed? ?out)\\b',
};

const events = [];
const hops = [];
const sessions = [];

const pad = (n, w = 2) => String(n).padStart(w, '0');
function ts(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}

class Session {
  constructor(n, scenario, startMs) {
    this.n = n;
    this.scenario = scenario;
    this.sid = `fa4e0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    this.t = startMs;
    this.step = 0;
    this.refSeq = 0;
  }
  ref() { return `FAKE-TXN-${pad(this.n)}-${++this.refSeq}`; }
  wait(ms) { this.t += ms; }
  emit(source, raw, row) {
    events.push({ t: this.t, source: BASE_PATH + source, raw });
    hops.push({ scenario: this.scenario, sessionId: this.sid, step: ++this.step, eventTime: ts(this.t),
      hostServices: '', elapsedMs: '', ...row });
    this.wait(this.sameMs ? 0 : 1); // keeps timestamps strictly increasing, except in the same-millisecond scenario
  }

  ecomm(api, resp, children = () => {}) {
    const header = { sessionId: this.sid, transactionRef: this.ref(), apiName: api, channel: 'MB' };
    const tReq = this.t;
    this.emit(SRC.online,
      `${ts(this.t)} INFO [ECOMM-Message][/sessionId] : ${this.sid} ${api}Request - Request - ` +
      JSON.stringify({ _mock: MOCK, header, data: { customerId: `FAKE-CUST-${pad(this.n, 4)}` } }),
      { layer: 'eComm', direction: 'Request', api, hopStatus: 'N/A' });
    this.wait(this.sameMs ? 0 : 5);
    children();
    if (!resp) return;
    this.wait(resp.proc ?? 8);
    this.emit(SRC.online,
      `${ts(this.t)} INFO [ECOMM-Message][/sessionId] : ${this.sid} ${api}Response - Response - ` +
      JSON.stringify({ _mock: MOCK, header: { ...header, httpStatus: resp.http ?? 200 }, data: resp.data }),
      { layer: 'eComm', direction: 'Response', api, hopStatus: resp.expect, elapsedMs: this.t - tReq });
  }

  ent(api, resp, children = () => {}) {
    const header = { sessionId: this.sid, transactionRef: this.ref(), apiName: api };
    const tReq = this.t;
    this.emit(SRC.online,
      `${ts(this.t)} INFO [Enterprise-HostMessage]['sessionIdentity'] : ${this.sid} ${api}Request [Request] ` +
      JSON.stringify({ _mock: MOCK, header, data: { accountNo: `FAKE-ACCT-${pad(this.n, 4)}` } }),
      { layer: 'Enterprise', direction: 'Request', api, hopStatus: 'N/A' });
    this.wait(this.sameMs ? 0 : 4);
    children(header.transactionRef);
    if (!resp) return;
    this.wait(resp.proc ?? 30);
    this.emit(SRC.online,
      `${ts(this.t)} INFO [Enterprise-HostMessage]['sessionIdentity'] : ${this.sid} ${api}Response [Response] ` +
      JSON.stringify({ _mock: MOCK, header: { ...header, httpStatus: resp.http ?? 200 }, data: resp.data }),
      { layer: 'Enterprise', direction: 'Response', api, hopStatus: resp.expect, elapsedMs: this.t - tReq });
  }

  ws(url, ref, resp, children = () => {}, { source = SRC.ms, method = 'POST', marker = 'RESPONSE from Enterprise' } = {}) {
    const tReq = this.t;
    this.emit(source,
      `${ts(this.t)} INFO WSAppLog ["WS:" ${this.sid}] request: URL?: ${method}: ${url} "transactionRef : ${ref}"`,
      { layer: 'WS', direction: 'Request', api: url, hopStatus: 'N/A' });
    this.wait(3);
    children();
    if (!resp) return;
    this.wait(resp.proc ?? 10);
    this.emit(source,
      `${ts(this.t)} INFO WSAppLog ["WS:" ${this.sid}] ${marker} URL?: ${method}: ${url} "transactionRef : ${ref}" ` +
      `status: ${resp.status}${resp.note ? ' ' + resp.note : ''}`,
      { layer: 'WS', direction: 'Response', api: url, hopStatus: resp.expect, elapsedMs: this.t - tReq });
  }

  host(ref, pairs, resp, { source = SRC.ms } = {}) {
    const codes = ([m, s]) => `<SvcCode>${m}</SvcCode><SvcCode>${s}</SvcCode>`;
    const hostServices = pairs.map(([m, s]) => `${m} ~ ${s}`).join(' | ');
    const api = pairs[0][0];
    const tReq = this.t;
    this.emit(source,
      `${ts(this.t)} INFO [EAI-Gateway] Request Message <EAI><RqUID>${ref}</RqUID><SvcRq>${pairs.map(codes).join('')}</SvcRq></EAI>`,
      { layer: 'Host', direction: 'Request', api, hopStatus: 'N/A', hostServices });
    if (!resp) return;
    this.wait(resp.latency);
    const body = pairs.map((p, i) => `<SvcRs>${codes(p)}<StatusCode>${resp.statuses[i]}</StatusCode></SvcRs>`).join('');
    this.emit(source,
      `${ts(this.t)} INFO [EAI-Gateway] Response Message <EAI><RqUID>${ref}</RqUID>${body}</EAI>`,
      { layer: 'Host', direction: 'Response', api, hopStatus: resp.expect, elapsedMs: this.t - tReq, hostServices });
  }
}

const eOk = (proc = 8) => ({ data: { responseCode: '0000' }, proc, expect: 'SUCCESS' });
const nOk = (proc = 30) => ({ data: { responseCode: '00000' }, proc, expect: 'SUCCESS' });
const wOk = (proc = 10) => ({ status: 200, proc, expect: 'SUCCESS' });
const hOk = (n, latency = 180) => ({ statuses: Array(n).fill('0'), latency, expect: 'SUCCESS' });

let cursor = Date.UTC(2026, 9, 27, 1, 15, 2, 114);
function scenario(n, code, title, sessionStatus, firstFailedHop, build) {
  const s = new Session(n, code, cursor);
  build(s);
  sessions.push({ scenario: code, sessionId: s.sid, sessionStatus, firstFailedHop, title });
  cursor = s.t + 1500;
}

scenario(1, 'A', 'eComm internal processing only', 'SUCCESS', '', s =>
  s.ecomm('getProfile', eOk(12)));

scenario(2, 'B', 'eComm calls one Enterprise API; Enterprise processes internally (empty and null error fields)', 'SUCCESS', '', s =>
  s.ecomm('getAccountList', { data: { responseCode: '0000', errorCode: '', errorDescription: null }, proc: 9, expect: 'SUCCESS' }, () =>
    s.ent('AccountList', { data: { responseCode: '00000', errorCode: '', errorDescription: '' }, proc: 45, expect: 'SUCCESS' })));

scenario(3, 'C', 'eComm calls three Enterprise APIs in sequence', 'SUCCESS', '', s =>
  s.ecomm('getDashboard', eOk(10), () => {
    s.ent('CustomerProfile', nOk(38));
    s.wait(3);
    s.ent('AccountSummary', nOk(52));
    s.wait(3);
    s.ent('RewardsBalance', nOk(27));
  }));

scenario(4, 'D', 'Enterprise calls one EAI service with a single sub-service', 'SUCCESS', '', s =>
  s.ecomm('fundTransfer', eOk(), () =>
    s.ent('FundTransfer', nOk(12), ref =>
      s.ws('/ws/fund/transfer', ref, wOk(15), () =>
        s.host(ref, [['FT01', 'A01']], hOk(1, 186))))));

scenario(5, 'E', 'Enterprise calls one EAI service with three sub-services (WS on the bfs pod)', 'SUCCESS', '', s =>
  s.ecomm('getAccountDetails', eOk(), () =>
    s.ent('AccountInquiry', nOk(10), ref =>
      s.ws('/ws/account/inquiry', ref, wOk(12), () =>
        s.host(ref, [['ACCT', 'INQ01'], ['ACCT', 'BAL02'], ['ACCT', 'LMT03']], hOk(3, 243), { source: SRC.bfs }),
      { source: SRC.bfs }))));

scenario(6, 'F', 'Enterprise calls EAI plus OPI, WAM and CUS (downstream calls logged by WS)', 'SUCCESS', '', s =>
  s.ecomm('getCustomer360', eOk(), () =>
    s.ent('Customer360', nOk(11), ref =>
      s.ws('/ws/customer/360', ref, wOk(9), () => {
        s.host(ref, [['CIF1', 'PRF01']], hOk(1, 158));
        s.wait(2);
        s.ws('/opi/v2/customer/profile', ref, wOk(64), undefined, { method: 'GET', marker: 'Response:' });
        s.wait(2);
        s.ws('/wam/v1/limits', ref, wOk(41), undefined, { method: 'GET', marker: 'Response:' });
        s.wait(2);
        s.ws('/cus/v1/customer/segment', ref, wOk(29), undefined, { method: 'GET', marker: 'Response:' });
      }))));

scenario(7, 'G1', 'Downstream timeout: Host request gets no response; WS logs an explicit timeout', 'FAILED', 'WS: /ws/fund/transfer', s =>
  s.ecomm('fundTransfer', { data: { responseCode: '9001', errorDescription: 'Service temporarily unavailable' }, proc: 6, expect: 'FAILED' }, () =>
    s.ent('FundTransfer', { data: { errorCode: 'E9001', errorDescription: 'Downstream EAI timeout' }, proc: 9, expect: 'FAILED' }, ref =>
      s.ws('/ws/fund/transfer', ref, { status: 504, note: 'EAI timeout after 30000 ms', proc: 30000, expect: 'FAILED' }, () =>
        s.host(ref, [['FT01', 'A01']], null)))));

scenario(9, 'G2', 'EAI returns an error status for one sub-service pair', 'FAILED', 'Host: FT01', s =>
  s.ecomm('fundTransfer', { data: { responseCode: '1020', errorDescription: 'Transfer could not be completed' }, proc: 7, expect: 'FAILED' }, () =>
    s.ent('FundTransfer', { data: { errorCode: 'E1020', errorDescription: 'Debit leg failed at host' }, proc: 10, expect: 'FAILED' }, ref =>
      s.ws('/ws/fund/transfer', ref, wOk(14), () =>
        s.host(ref, [['FT01', 'A01'], ['FT01', 'A02']], { statuses: ['0', 'E102'], latency: 212, expect: 'FAILED' })))));

scenario(10, 'G3', 'Enterprise returns HTTP 200 with errorCode and errorDescription', 'FAILED', 'Enterprise: BillPayment', s =>
  s.ecomm('payBill', { data: { responseCode: '2001', errorDescription: 'Insufficient balance' }, proc: 6, expect: 'FAILED' }, () =>
    s.ent('BillPayment', { http: 200, data: { errorCode: 'E2001', errorDescription: 'Insufficient balance' }, proc: 33, expect: 'FAILED' })));

scenario(11, 'G4', 'eComm returns a non-success code with errorDescription', 'FAILED', 'eComm: validatePayee', s =>
  s.ecomm('validatePayee', { data: { responseCode: '1001', errorDescription: 'Invalid payee account' }, proc: 14, expect: 'FAILED' }));

// Extra coverage beyond the brief: each of these is caught by exactly one HopStatus rule.
scenario(16, 'G3b', 'Enterprise returns HTTP 200 with errorCode only (no description, no response code)', 'FAILED', 'Enterprise: CardActivation', s =>
  s.ecomm('activateCard', { data: { responseCode: '4005' }, proc: 7, expect: 'FAILED' }, () =>
    s.ent('CardActivation', { http: 200, data: { errorCode: 'E4005' }, proc: 29, expect: 'FAILED' })));

scenario(17, 'G5', 'Enterprise returns HTTP 503 with no business code', 'FAILED', 'Enterprise: LoanQuote', s =>
  s.ecomm('getLoanQuote', { data: { responseCode: '5003' }, proc: 6, expect: 'FAILED' }, () =>
    s.ent('LoanQuote', { http: 503, data: {}, proc: 15, expect: 'FAILED' })));

scenario(18, 'G6', 'eComm returns success code 0000 but also an errorDescription (FAILED by the current definition)', 'FAILED', 'eComm: getStatements', s =>
  s.ecomm('getStatements', { data: { responseCode: '0000', errorDescription: 'Older statements temporarily unavailable' }, proc: 21, expect: 'FAILED' }));

scenario(19, 'T', 'Parent and child logged in the same millisecond (tests request-down / response-up order at equal times)', 'SUCCESS', '', s => {
  s.sameMs = true;
  s.ecomm('getLimits', { data: { responseCode: '0000' }, proc: 0, expect: 'SUCCESS' }, () =>
    s.ent('LimitInquiry', { data: { responseCode: '00000' }, proc: 30, expect: 'SUCCESS' }));
});

// H: two sessions whose events interleave in time.
{
  const h1 = new Session(12, 'H', cursor);
  const h2 = new Session(13, 'H', cursor + 4);
  const flow = (s, hostMs) => s.ecomm('fundTransfer', eOk(), () =>
    s.ent('FundTransfer', nOk(12), ref =>
      s.ws('/ws/fund/transfer', ref, wOk(15), () =>
        s.host(ref, [['FT01', 'A01']], hOk(1, hostMs)))));
  flow(h1, 190);
  flow(h2, 175);
  sessions.push({ scenario: 'H', sessionId: h1.sid, sessionStatus: 'SUCCESS', firstFailedHop: '', title: 'Two sessions interleaved in time (session 1 of 2)' });
  sessions.push({ scenario: 'H', sessionId: h2.sid, sessionStatus: 'SUCCESS', firstFailedHop: '', title: 'Two sessions interleaved in time (session 2 of 2), starts 4 ms after session 1' });
  cursor = Math.max(h1.t, h2.t) + 1500;
}

scenario(14, 'I1', 'One Enterprise API succeeds, another fails, eComm still returns success', 'PARTIAL', 'Enterprise: RewardsBalance', s =>
  s.ecomm('getDashboard', eOk(9), () => {
    s.ent('AccountSummary', nOk(48));
    s.wait(3);
    s.ent('RewardsBalance', { data: { errorCode: 'E3001', errorDescription: 'Rewards service unavailable' }, proc: 22, expect: 'FAILED' });
  }));

scenario(15, 'I2', 'One Enterprise API succeeds, another fails, eComm returns an error', 'FAILED', 'Enterprise: RewardsBalance', s =>
  s.ecomm('getDashboard', { data: { responseCode: '3001', errorDescription: 'Dashboard partially unavailable' }, proc: 9, expect: 'FAILED' }, () => {
    s.ent('AccountSummary', nOk(51));
    s.wait(3);
    s.ent('RewardsBalance', { data: { errorCode: 'E3001', errorDescription: 'Rewards service unavailable' }, proc: 24, expect: 'FAILED' });
  }));

// G1b goes last: requests still in flight when the logs end, with no response at any layer.
scenario(8, 'G1b', 'Timeout with no response logged at any layer (still in flight at the end of the window)', 'UNKNOWN', '', s =>
  s.ecomm('fundTransfer', null, () =>
    s.ent('FundTransfer', null, ref =>
      s.ws('/ws/fund/transfer', ref, null, () =>
        s.host(ref, [['FT01', 'A01']], null)))));

// ---- write files ----

events.sort((a, b) => a.t - b.t);
const csvCell = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csv = (cols, rows) => [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c] ?? '')).join(','))].join('\n') + '\n';

fs.mkdirSync(path.join(OUT, 'logs'), { recursive: true });
for (const file of Object.values(SRC)) {
  const lines = events.filter(e => e.source === BASE_PATH + file).map(e => e.raw);
  fs.writeFileSync(path.join(OUT, 'logs', file), lines.join('\n') + '\n');
}

hops.sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.step - b.step);
fs.writeFileSync(path.join(OUT, 'expected-hops.csv'), csv(
  ['scenario', 'sessionId', 'step', 'eventTime', 'layer', 'direction', 'api', 'hostServices', 'elapsedMs', 'hopStatus'], hops));
sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
fs.writeFileSync(path.join(OUT, 'expected-sessions.csv'), csv(
  ['scenario', 'sessionId', 'sessionStatus', 'firstFailedHop', 'title'], sessions));

// Test search: the mock events built inline with makeresults, then the final SPL with mock placeholder values.
const finalSpl = fs.readFileSync(path.join(OUT, '..', '..', 'queries', 'traceline.final.spl'), 'utf8').split(/\r?\n/);
const first = finalSpl.findIndex(l => l.trim().startsWith('|'));
const base = finalSpl.slice(0, first)
  .filter(l => !/^\s*```.*```\s*$/.test(l) && !/^\s*index IN /.test(l) && l.trim())
  .join('\n');
const rest = finalSpl.slice(first)
  .filter(l => !l.includes('sessionId IN (<SESSION_ID>)') && l.trim() !== '<ONLY_FAILED>')
  .join('\n');
const fillPlaceholders = s => s.replace(/<([A-Z][A-Z0-9_]+)>/g, (m, k) => MOCK_PLACEHOLDERS[k] ?? m);
const esc = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const data = events.map(e => `    "${esc([(e.t / 1000).toFixed(3), e.source, e.raw].join('|~|'))}"`).join(',\n');
const query = `| search ${fillPlaceholders(base).trim()}\n${fillPlaceholders(rest)}`;
// A placeholder is <UPPER_SNAKE> that is not a regex named group (?<NAME>...) or the foreach token <<FIELD>>.
const left = query.replace(/<<FIELD>>/g, '').match(/(?<!\?)<[A-Z][A-Z0-9_]+>/g);
if (left) throw new Error('Unfilled placeholders: ' + [...new Set(left)].join(' '));
const spl = [
  '``` Traceline Phase 5 pre-validation: FAKE, DESENSITIZED mock events, then queries/traceline.final.spl ```',
  '``` Placeholders are filled with the MOCK format values from mock/phase5/generate.js, not real ones. ```',
  '| makeresults',
  `| eval data=mvappend(\n${data})`,
  '| mvexpand data',
  '| eval f=split(data, "|~|"), _time=tonumber(mvindex(f,0)), source=mvindex(f,1), _raw=mvindex(f,2)',
  '| fields - data f',
  query,
].join('\n') + '\n';
fs.writeFileSync(path.join(OUT, 'phase5-test.spl'), spl);

console.log(`${events.length} events, ${sessions.length} sessions, ${hops.filter(h => h.direction === 'Response').length} responses`);
