const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSS } = require('./load');

const SS = loadSS();
// Objects from the sandbox have a different Array/Object prototype; compare plain copies.
const plain = v => JSON.parse(JSON.stringify(v));
// Default config with only the first built-in scenario, so counts below are exact.
const base = () => {
  const cfg = SS.defaultConfig();
  cfg.scenarios.forEach((sc, i) => { sc.enabled = i === 0; });
  return cfg;
};

test('default scenario produces the expected flow with no config issues', () => {
  const cfg = base();
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
  const cfg = base();
  cfg.scenarios[0].sessions = 3;
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
  const cfg = base();
  const a = SS.generate(cfg).map(e => e.raw);
  const b = SS.generate(cfg).map(e => e.raw);
  assert.deepEqual(a, b);
  cfg.settings.seed = 42;
  assert.notDeepEqual(SS.generate(cfg).map(e => e.raw), a);
});

test('a broken regex is reported by the self-test', () => {
  const cfg = base();
  cfg.layers.find(l => l.id === 'ws').requestRegex = 'NO-SUCH-TEXT';
  const sim = SS.simulate(cfg, SS.generate(cfg));
  const bad = sim.debug.filter(d => d.mismatch);
  assert.equal(bad.length, 2);
  assert.match(bad[0].mismatch, /Expected WS/);
});

test('an invalid regex is surfaced as an error instead of throwing', () => {
  const cfg = base();
  cfg.layers[0].apiRegex = '(?<value>[unclosed';
  const sim = SS.simulate(cfg, SS.generate(cfg));
  assert.equal(sim.errors.length, 1);
});

test('added parameters flow through mock logs, SPL and the Params column', () => {
  const cfg = base();
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
  const cfg = base();
  cfg.params = cfg.params.filter(p => p.name !== 'transactionRef');
  assert.ok(!SS.generate(cfg).some(e => e.raw.includes('transactionRef')));
  assert.ok(!SS.buildSpl(cfg).includes('transactionRef'));
});

test('reserved and duplicate parameter names are rejected', () => {
  const cfg = base();
  cfg.params.push({ ...SS.newParam(cfg), name: 'API' });
  cfg.params.push({ ...SS.newParam(cfg), name: 'httpStatus' });
  const issues = SS.configIssues(cfg).join('\n');
  assert.match(issues, /"API" is reserved/);
  assert.match(issues, /Duplicate field name "httpStatus"/);
  assert.ok(!SS.activeParams(cfg).some(p => p.name === 'API'));
});

test('pasted logs: timestamps with comma or dot milliseconds', () => {
  const cfg = base();
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
  const cfg = base();
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
  const cfg = base();
  const harness = SS.buildSpl(cfg, { events: [{ time: 0, raw: 'a "quoted" C:\\path' }] });
  assert.ok(harness.includes('"0.000~|~a \\"quoted\\" C:\\\\path"'));
});

test('imported configs are normalized and keep user changes', () => {
  const cfg = SS.normalizeConfig({ settings: { noiseLines: 7 }, params: [{ name: 'x', layers: ['ecomm'] }] });
  assert.equal(cfg.settings.noiseLines, 7);
  assert.equal(cfg.scenarios.length, SS.defaultScenarios().length);
  assert.equal(cfg.layers.length, 4);
  assert.equal(cfg.params[0].name, 'x');
  assert.equal(cfg.params[0].gen, 'pattern');
});

test('PlantUML sequence diagram follows the call stack', () => {
  const cfg = base();
  const sim = SS.simulate(cfg, SS.generate(cfg));
  const puml = SS.buildPlantUml(cfg, sim.rows);
  const lines = puml.split('\n');

  assert.equal(lines[0], '@startuml');
  assert.equal(lines[lines.length - 1], '@enduml');
  assert.ok(puml.includes('actor "App" as Caller'));
  assert.ok(puml.includes('Caller -> L_ecomm : /api/v1/auth/login [?]\\nTxnRefNo='));
  assert.ok(puml.includes('L_ecomm -> L_enterprise : CustomerLogin [?]'));
  assert.ok(puml.includes('L_enterprise -> L_host : CL01.A01 [?]'));
  assert.match(puml, /L_host --> L_enterprise : CL01\.A01 \[!\] \(\d+ ms\)/);
  assert.match(puml, /L_ws --> L_enterprise : https:\/\/enterprise-sit\.internal\/ws\/limitCheck \[!\]/);
  assert.match(puml, /L_ecomm --> Caller : \/api\/v1\/payment\/transfer \[!\]/);

  const count = re => lines.filter(l => re.test(l)).length;
  assert.equal(count(/^activate /), count(/^deactivate /), 'activations balanced');
  assert.equal(count(/ -> /), 10);
  assert.equal(count(/ --> /), 10);
});

test('PlantUML marks calls that never got a response', () => {
  const cfg = base();
  cfg.scenarios[0].calls[2].children[1].children[1].noResponse = true; // FundTransfer -> Host FT01
  const sim = SS.simulate(cfg, SS.generate(cfg));
  const puml = SS.buildPlantUml(cfg, sim.rows);
  assert.ok(puml.includes('note over L_host : no response logged for FT01.A01,A02'));
  const lines = puml.split('\n');
  assert.equal(lines.filter(l => l.startsWith('activate ')).length, lines.filter(l => l.startsWith('deactivate ')).length);
});

test('PlantUML draws one chosen session and honours the options', () => {
  const cfg = base();
  cfg.scenarios[0].sessions = 2;
  cfg.settings.sessionGapMs = 100;
  const sim = SS.simulate(cfg, SS.generate(cfg));
  const sessions = SS.diagramSessions(sim.rows);
  assert.equal(sessions.length, 2);

  const puml = SS.buildPlantUml(cfg, sim.rows, { sessionId: sessions[1], params: false, elapsed: false, time: true, autonumber: false, caller: 'Mobile "App"' });
  assert.ok(puml.includes('session ' + sessions[1]));
  assert.ok(!puml.includes(sessions[0]));
  assert.ok(!puml.includes('TxnRefNo') && !puml.includes(' ms)') && !puml.includes('autonumber'));
  assert.match(puml, /Caller -> L_ecomm : \d{2}:\d{2}:\d{2}\.\d{3} {2}\/api\/v1\/auth\/login \[\?\]/);
  assert.ok(puml.includes(`actor "Mobile 'App'" as Caller`));
});

test('PlantUML with no rows still produces a valid diagram', () => {
  const puml = SS.buildPlantUml(SS.defaultConfig(), []);
  assert.ok(puml.startsWith('@startuml') && puml.endsWith('@enduml'));
  assert.ok(puml.includes('No flow rows to draw'));
});

test('every built-in scenario runs clean and lands in one mixed mock file', () => {
  const cfg = SS.defaultConfig();
  const events = SS.generate(cfg);
  const sim = SS.simulate(cfg, events);
  assert.deepEqual(plain(SS.configIssues(cfg)), []);
  assert.equal(sim.debug.filter(d => d.mismatch).length, 0);

  const names = SS.defaultScenarios().map(s => s.name);
  const seen = new Set(events.map(e => e.scenario).filter(Boolean));
  assert.deepEqual([...seen].sort(), [...names].sort(), 'every scenario present');
  assert.equal(new Set(sim.rows.map(r => r.sessionId)).size, names.length, 'one session each');
  assert.equal(events.length - sim.rows.length, cfg.settings.noiseLines, 'only noise filtered');

  // Sessions overlap in time, so the file genuinely mixes scenarios rather than concatenating them.
  const order = events.filter(e => e.scenario).map(e => e.scenario);
  const switches = order.filter((s, i) => i > 0 && s !== order[i - 1]).length;
  assert.ok(switches >= names.length - 1);
});

test('scenario shapes: rules only, Enterprise without Host, several Host services, timeout', () => {
  const cfg = SS.defaultConfig();
  const sim = SS.simulate(cfg, SS.generate(cfg));
  const flows = sim.rows.map(r => r.flow);
  assert.ok(flows.includes('eComm: /api/v1/offers/personalised [!]'));
  assert.ok(flows.includes('--> Enterprise: UpdateProfile [!]'));
  assert.ok(flows.includes('-----> Host: AS01.A01 [?]') && flows.includes('-----> Host: AS02.B01,B02 [?]'));
  assert.ok(flows.includes('-----> Host: BP01.A01,A02,A03 [!]'));

  const events = SS.generate(cfg);
  const timeout = events.filter(e => e.scenario === 'Fund transfer with Host timeout' && e.raw.includes('<SvcCode>FT01'));
  assert.equal(timeout.length, 1, 'request logged, response missing');
  assert.match(timeout[0].raw, /Request Message/);
});

test('sessions per scenario, disabling and round-robin order', () => {
  const cfg = SS.defaultConfig();
  cfg.scenarios.forEach((sc, i) => { sc.enabled = i < 2; });
  cfg.scenarios[0].sessions = 3;
  cfg.scenarios[1].sessions = 1;
  assert.deepEqual(plain(SS.sessionPlan(cfg).map(s => s.name)),
    [cfg.scenarios[0].name, cfg.scenarios[1].name, cfg.scenarios[0].name, cfg.scenarios[0].name]);

  const sim = SS.simulate(cfg, SS.generate(cfg));
  assert.equal(new Set(sim.rows.map(r => r.sessionId)).size, 4);

  cfg.scenarios.forEach(sc => { sc.enabled = false; });
  assert.equal(SS.generate(cfg).length, 0);
  assert.match(SS.configIssues(cfg).join('\n'), /nothing to generate/);
});

test('older single-scenario configs migrate into the scenario list', () => {
  const old = { settings: { sessions: 4 }, scenario: [{ layer: 'ecomm', api: '/legacy', children: [] }] };
  const cfg = SS.normalizeConfig(old);
  assert.equal(cfg.scenarios[0].name, 'My scenario');
  assert.equal(cfg.scenarios[0].sessions, 4);
  assert.equal(cfg.scenarios[0].calls[0].api, '/legacy');
  assert.equal(cfg.scenarios.length, 1 + SS.defaultScenarios().length);
  assert.equal(cfg.settings.sessions, undefined);

  const untouched = SS.normalizeConfig({ scenario: JSON.parse(JSON.stringify(SS.defaultScenarios()[0].calls)) });
  assert.equal(untouched.scenarios.length, SS.defaultScenarios().length, 'unchanged old default is not duplicated');
});

test('PlantUML title carries the scenario name', () => {
  const cfg = base();
  const sim = SS.simulate(cfg, SS.generate(cfg));
  assert.match(SS.buildPlantUml(cfg, sim.rows, { label: 'Bill payment' }), /^title Transaction flow - Bill payment - session /m);
});
