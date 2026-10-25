const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSS } = require('./load');

const SS = loadSS();
// Objects from the sandbox have a different Array/Object prototype; compare plain copies.
const plain = v => JSON.parse(JSON.stringify(v));

test('default scenario produces the expected flow with no config issues', () => {
  const cfg = SS.defaultConfig();
  const events = SS.generate(cfg);
  const sim = SS.simulate(cfg, events);

  assert.deepEqual(plain(sim.errors), []);
  assert.deepEqual(plain(SS.configIssues(cfg)), []);
  assert.equal(sim.debug.filter(d => d.mismatch).length, 0, 'every mock line handled as written');
  assert.equal(sim.rows.length, 20);
  assert.equal(events.length - sim.rows.length, cfg.settings.noiseLines, 'only noise is filtered out');

  const flows = sim.rows.map(r => r.flow);
  assert.equal(flows[0], 'eComm: /api/v1/auth/login [?]');
  assert.equal(flows[1], '--> Enterprise: CustomerLogin [?]');
  assert.equal(flows[2], '-----> Host: CL01.A01 [?]');
  assert.ok(flows.includes('-----> Host: FT01.A01,A02 [!]'), 'main.sub1,sub2 service codes');
  assert.ok(flows.includes('-----> WS: https://enterprise-sit.internal/ws/accountInquiry [!]'), 'WS response inherits URL');
});

test('responses carry elapsed time and steps count per session', () => {
  const cfg = SS.defaultConfig();
  cfg.settings.sessions = 3;
  cfg.settings.sessionGapMs = 200;
  const sim = SS.simulate(cfg, SS.generate(cfg));
  for (const r of sim.rows) {
    if (r.flow.endsWith('[!]')) assert.ok(r.elapsed >= 0, `elapsed on ${r.flow}`);
    else assert.equal(r.elapsed, null);
  }
  const sessions = new Set(sim.rows.map(r => r.sessionId));
  assert.equal(sessions.size, 3);
  for (const sid of sessions) {
    const steps = sim.rows.filter(r => r.sessionId === sid).map(r => r.step);
    assert.deepEqual(plain(steps), plain(steps.map((_, i) => i + 1)));
  }
});

test('same seed gives identical logs; a new seed changes them', () => {
  const cfg = SS.defaultConfig();
  const a = SS.generate(cfg).map(e => e.raw);
  const b = SS.generate(cfg).map(e => e.raw);
  assert.deepEqual(a, b);
  cfg.settings.seed = 42;
  assert.notDeepEqual(SS.generate(cfg).map(e => e.raw), a);
});

test('a broken regex is reported by the self-test', () => {
  const cfg = SS.defaultConfig();
  cfg.layers.find(l => l.id === 'ws').requestRegex = 'NO-SUCH-TEXT';
  const sim = SS.simulate(cfg, SS.generate(cfg));
  const bad = sim.debug.filter(d => d.mismatch);
  assert.equal(bad.length, 2);
  assert.match(bad[0].mismatch, /Expected WS/);
});

test('an invalid regex is surfaced as an error instead of throwing', () => {
  const cfg = SS.defaultConfig();
  cfg.layers[0].apiRegex = '(?<value>[unclosed';
  const sim = SS.simulate(cfg, SS.generate(cfg));
  assert.equal(sim.errors.length, 1);
});

test('added parameters flow through mock logs, SPL and the Params column', () => {
  const cfg = SS.defaultConfig();
  cfg.params.push({ ...SS.newParam(cfg), name: 'amount', label: 'Amt', layers: ['ecomm'], on: 'request', gen: 'number', genArg: '10-500:2' });
  const events = SS.generate(cfg);
  assert.ok(events.some(e => /amount="\d+\.\d{2}"/.test(e.raw)));

  const spl = SS.buildSpl(cfg);
  assert.ok(spl.includes('(?<amount>'));
  assert.ok(spl.includes('"Amt=".amount'));

  const sim = SS.simulate(cfg, events);
  assert.ok(sim.rows.some(r => /Amt=\d+\.\d{2}/.test(r.params)));
});

test('removed parameters disappear everywhere', () => {
  const cfg = SS.defaultConfig();
  cfg.params = cfg.params.filter(p => p.name !== 'transactionRef');
  assert.ok(!SS.generate(cfg).some(e => e.raw.includes('transactionRef')));
  assert.ok(!SS.buildSpl(cfg).includes('transactionRef'));
});

test('reserved and duplicate parameter names are rejected', () => {
  const cfg = SS.defaultConfig();
  cfg.params.push({ ...SS.newParam(cfg), name: 'API' });
  cfg.params.push({ ...SS.newParam(cfg), name: 'httpStatus' });
  const issues = SS.configIssues(cfg).join('\n');
  assert.match(issues, /"API" is reserved/);
  assert.match(issues, /Duplicate field name "httpStatus"/);
  assert.ok(!SS.activeParams(cfg).some(p => p.name === 'API'));
});

test('pasted logs: timestamps with comma or dot milliseconds', () => {
  const cfg = SS.defaultConfig();
  const sid = '25afb1c5-ac47-4646-b96c-36f77f8d7cb1';
  const text = [
    `2026-10-25 09:00:00,5 x [ECOMM-Message] sessionId ${sid} Request endpoint="/a"`,
    `2026-10-25 09:00:01.200 x [ECOMM-Message] sessionId ${sid} Response endpoint="/a"`,
  ].join('\n');
  const sim = SS.simulate(cfg, SS.parsePasted(text, cfg));
  assert.equal(sim.rows.length, 2);
  assert.equal(sim.rows[0].eventTime, '2026-10-25 09:00:00.500');
  assert.equal(sim.rows[1].elapsed, 700);
});

test('SPL and test harness have the expected shape', () => {
  const cfg = SS.defaultConfig();
  const spl = SS.buildSpl(cfg);
  assert.ok(spl.startsWith('(source='));
  assert.ok(spl.includes('`SEARCH_SESSION_ID`'));
  assert.ok(spl.trim().endsWith('| table Step EventTime sessionId Flow Params ElapsedMs'));

  const events = SS.generate(cfg);
  const harness = SS.buildSpl(cfg, { events });
  assert.ok(harness.startsWith('| makeresults'));
  assert.ok(!harness.includes('`SEARCH_SESSION_ID`'));
  assert.equal((harness.match(/~\|~/g) || []).length, events.length + 2, 'one row per event plus the split()');

  cfg.settings.splComments = false;
  assert.ok(!SS.buildSpl(cfg).includes('```'));
});

test('quotes and backslashes in log lines are escaped in the harness', () => {
  const cfg = SS.defaultConfig();
  const harness = SS.buildSpl(cfg, { events: [{ time: 0, raw: 'a "quoted" C:\\path' }] });
  assert.ok(harness.includes('"0.000~|~a \\"quoted\\" C:\\\\path"'));
});

test('imported configs are normalized and keep user changes', () => {
  const cfg = SS.normalizeConfig({ settings: { sessions: 7 }, params: [{ name: 'x', layers: ['ecomm'] }] });
  assert.equal(cfg.settings.sessions, 7);
  assert.equal(cfg.layers.length, 4);
  assert.equal(cfg.params[0].name, 'x');
  assert.equal(cfg.params[0].gen, 'pattern');
});
