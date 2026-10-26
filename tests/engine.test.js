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
  assert.equal(flows[1], '--› Enterprise: CustomerLogin [?]');
  assert.equal(flows[2], '------› Host: CL01 [?]');
  assert.ok(flows.includes('------› Host: FT01 [!]'), 'Host API is the service code');
  assert.ok(sim.rows.some(r => r.hostServices === 'FT01 ~ A01 | FT01 ~ A02'), 'SvcCodes paired as main ~ sub');
  assert.ok(flows.includes('------› WS: https://enterprise-sit.internal/ws/accountInquiry [!]'), 'WS response inherits URL');
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
  assert.ok(spl.includes('"Amt: ".amount'));

  const sim = SS.simulate(cfg, events);
  assert.ok(sim.rows.some(r => /Amt: \d+\.\d{2}/.test(r.params)));
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
  assert.ok(spl.trim().endsWith('| table Step EventTime sessionId Flow HostServices Params ElapsedMs'));

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
  assert.ok(puml.includes('Caller -> L_ecomm : /api/v1/auth/login [?]\\nTxnRefNo: '));
  assert.ok(puml.includes('L_ecomm -> L_enterprise : CustomerLogin [?]'));
  assert.ok(puml.includes('L_enterprise -> L_host : CL01 [?]\\nCL01 ~ A01\\nAcctNo: '));
  assert.match(puml, /L_host --> L_enterprise : CL01 \[!\] \(\d+ ms\)\\nCL01 ~ A01/);
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
  assert.ok(puml.includes('note over L_host : no response logged for FT01'));
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
  assert.ok(flows.includes('--› Enterprise: UpdateProfile [!]'));
  assert.ok(flows.includes('------› Host: AS01 [?]') && flows.includes('------› Host: AS02 [?]'));
  assert.ok(flows.includes('------› Host: BP01 [!]'));
  assert.ok(sim.rows.some(r => r.hostServices === 'BP01 ~ A01 | BP01 ~ A02 | BP01 ~ A03'));
  assert.ok(sim.rows.some(r => r.hostServices === 'AS02 ~ B01 | AS02 ~ B02'));

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

test('local renderer parses the generated PlantUML', () => {
  const cfg = base();
  const puml = SS.buildPlantUml(cfg, SS.simulate(cfg, SS.generate(cfg)).rows);
  const d = SS.parsePlantUml(puml);
  assert.match(d.title, /^Transaction flow - session /);
  assert.ok(d.autonumber && d.responseBelow);
  assert.deepEqual(plain(d.participants.map(p => [p.alias, p.label, p.kind])), [
    ['Caller', 'App', 'actor'], ['L_ecomm', 'eComm', 'participant'], ['L_enterprise', 'Enterprise', 'participant'],
    ['L_host', 'Host', 'participant'], ['L_ws', 'WS', 'participant'],
  ]);
  const msgs = d.items.filter(i => i.type === 'msg');
  assert.equal(msgs.length, 20);
  assert.deepEqual(plain(msgs[0]), { type: 'msg', from: 'Caller', to: 'L_ecomm', dashed: false, text: ['/api/v1/auth/login [?]', msgs[0].text[1]] });
  assert.match(msgs[0].text[1], /^TxnRefNo: TX\d{10}$/);
  assert.equal(d.items.filter(i => i.type === 'activate').length, d.items.filter(i => i.type === 'deactivate').length);
});

test('local renderer lays out every message top to bottom without overlaps', () => {
  const cfg = SS.defaultConfig();
  const sim = SS.simulate(cfg, SS.generate(cfg));
  for (const sid of SS.diagramSessions(sim.rows)) {
    const d = SS.parsePlantUml(SS.buildPlantUml(cfg, sim.rows, { sessionId: sid }));
    const L = SS.layoutSequence(d);
    const arrows = L.shapes.filter(s => s.t === 'line' && /seq-msg/.test(s.c));
    assert.equal(arrows.length, d.items.filter(i => i.type === 'msg').length);
    for (let i = 1; i < arrows.length; i++) assert.ok(arrows[i].y1 > arrows[i - 1].y1, 'arrows move down');
    for (const s of L.shapes) {
      const xs = s.t === 'poly' ? s.pts.map(p => p[0]) : [s.x ?? s.x1 ?? s.cx, s.x2 ?? s.x ?? s.cx];
      for (const x of xs) assert.ok(x >= 0 && x <= L.width, 'inside the canvas');
    }
    assert.equal(L.shapes.filter(s => s.c === 'seq-act').length, d.items.filter(i => i.type === 'activate').length);
  }
});

test('timeout notes render and the SVG export is well-formed and escaped', () => {
  const cfg = base();
  cfg.scenarios[0].calls[2].children[1].children[1].noResponse = true;
  cfg.scenarios[0].calls[0].api = '/api/<login>&"x"';
  const puml = SS.buildPlantUml(cfg, SS.simulate(cfg, SS.generate(cfg)).rows);
  const L = SS.layoutSequence(SS.parsePlantUml(puml));
  assert.ok(L.shapes.some(s => s.c === 'seq-note'));
  const svg = SS.sequenceSvgString(L);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && svg.endsWith('</svg>'));
  assert.ok(svg.includes('no response logged for FT01'));
  assert.ok(svg.includes('/api/&lt;login&gt;&amp;'));
  assert.ok(!/<script|on\w+=/i.test(svg));
});

test('WS can be drawn as internal processing of the Enterprise API', () => {
  const cfg = base();
  const rows = SS.simulate(cfg, SS.generate(cfg)).rows;
  const puml = SS.buildPlantUml(cfg, rows, { internal: ['ws'] });
  const lines = puml.split('\n');

  assert.ok(!puml.includes('participant "WS"'), 'no WS participant');
  assert.ok(!/\bL_ws\b/.test(puml), 'nothing drawn on a WS lifeline');
  assert.ok(lines.includes('L_enterprise -> L_enterprise : WS: https://enterprise-sit.internal/ws/accountInquiry [?]'));
  assert.ok(lines.some(l => /^L_enterprise --> L_enterprise : WS: https:\/\/enterprise-sit\.internal\/ws\/limitCheck \[!\] \(\d+ ms\)$/.test(l)));
  assert.ok(lines.some(l => /^L_enterprise -> L_host : FT01 \[\?\]/.test(l)),
    'Host is still called from Enterprise after the internal WS step');
  assert.equal(lines.filter(l => l.startsWith('activate ')).length, lines.filter(l => l.startsWith('deactivate ')).length);

  // Default output is unchanged: WS keeps its own participant.
  assert.ok(SS.buildPlantUml(cfg, rows).includes('participant "WS" as L_ws'));
});

test('renderer draws self-calls as loops inside the canvas', () => {
  const cfg = SS.defaultConfig();
  const sim = SS.simulate(cfg, SS.generate(cfg));
  for (const sid of SS.diagramSessions(sim.rows)) {
    const d = SS.parsePlantUml(SS.buildPlantUml(cfg, sim.rows, { sessionId: sid, internal: ['ws'] }));
    const selfCalls = d.items.filter(i => i.type === 'msg' && i.from === i.to).length;
    const L = SS.layoutSequence(d);
    const msgLines = L.shapes.filter(s => s.t === 'line' && /seq-msg/.test(s.c)).length;
    assert.equal(msgLines, d.items.filter(i => i.type === 'msg').length + selfCalls * 2, 'three segments per self-call');
    for (const s of L.shapes) {
      const xs = s.t === 'poly' ? s.pts.map(p => p[0]) : [s.x ?? s.x1 ?? s.cx, s.x2 ?? s.x ?? s.cx];
      for (const x of xs) assert.ok(x >= 0 && x <= L.width, 'inside the canvas');
    }
  }
});

test('processing rules: one row per API/URL with diagram step numbers', () => {
  const cfg = base();
  const rows = SS.simulate(cfg, SS.generate(cfg)).rows;
  const res = SS.processingSteps(cfg, rows);
  assert.equal(res.sessionId, SS.diagramSessions(rows)[0]);

  assert.deepEqual(plain(res.items.map(i => [i.steps, i.prefix + i.layerLabel + ' ' + i.api])), [
    ['1 → 6', 'eComm /api/v1/auth/login'],
    ['2 → 5', '└─ Enterprise CustomerLogin'],
    ['7 → 8', 'eComm /api/v1/rules/eligibility'],
    ['9 → 20', 'eComm /api/v1/payment/transfer'],
    ['10 → 13', '├─ Enterprise AccountInquiry'],
    ['11 → 12', '│  └─ WS https://enterprise-sit.internal/ws/accountInquiry'],
    ['14 → 19', '└─ Enterprise FundTransfer'],
    ['15 → 16', '   └─ WS https://enterprise-sit.internal/ws/limitCheck'],
  ]);
  assert.ok(!res.items.some(i => i.layerId === 'host'), 'Host calls are not rows of their own');

  const rule = api => res.items.find(i => i.api === api).rules;
  assert.ok(rule('/api/v1/rules/eligibility').includes('Processing rule only: no downstream call.'));
  assert.ok(rule('/api/v1/auth/login').includes('Entry API, called by App.'));
  assert.ok(rule('/api/v1/payment/transfer').includes(
    'Calls, in order: Enterprise AccountInquiry (step 10) → Enterprise FundTransfer (step 14).'));

  const ft = rule('FundTransfer');
  assert.ok(ft.includes('Called by eComm /api/v1/payment/transfer.'));
  assert.ok(ft.includes('Calls, in order: WS https://enterprise-sit.internal/ws/limitCheck (internal, step 15) → Host FT01 (step 17).'));
  assert.ok(ft.some(l => /^Host call: service code FT01, services FT01 ~ A01 \| FT01 ~ A02; steps 17 → 18, \d+ ms; request AcctNo: \d{10}\.$/.test(l)));
  assert.ok(ft.some(l => /^Responded at step 19 after \d+ ms\.$/.test(l)));
  assert.ok(rule('https://enterprise-sit.internal/ws/limitCheck')[0].startsWith('Internal processing step of Enterprise FundTransfer'));
});

test('processing rule steps match the sequence diagram numbering', () => {
  const cfg = SS.defaultConfig();
  const rows = SS.simulate(cfg, SS.generate(cfg)).rows;
  for (const sid of SS.diagramSessions(rows)) {
    const res = SS.processingSteps(cfg, rows, { sessionId: sid });
    const msgs = SS.parsePlantUml(SS.buildPlantUml(cfg, rows, { sessionId: sid })).items.filter(i => i.type === 'msg');
    const sessionRows = rows.filter(r => r.sessionId === sid);
    assert.equal(msgs.length, sessionRows.length, 'one diagram arrow per flow row');
    for (const it of res.items) {
      const req = sessionRows[it.reqStep - 1];
      assert.equal(req.direction, 'Request');
      assert.equal(req.api, it.api, `step ${it.reqStep} is the request of ${it.api}`);
      if (it.respStep) assert.equal(sessionRows[it.respStep - 1].direction, 'Response');
    }
  }
});

test('processing rules flag missing responses and the WS option', () => {
  const cfg = SS.defaultConfig();
  const events = SS.generate(cfg);
  const rows = SS.simulate(cfg, events).rows;
  const sid = events.find(e => e.scenario === 'Fund transfer with Host timeout').sessionId;
  const res = SS.processingSteps(cfg, rows, { sessionId: sid });
  const ft = res.items.find(i => i.api === 'FundTransfer').rules;
  assert.ok(ft.some(l => /^Host call: service code FT01, services FT01 ~ A01 \| FT01 ~ A02; step \d+, no response logged \(possible timeout\)/.test(l)));

  const base1 = SS.diagramSessions(rows)[0];
  const ext = SS.processingSteps(cfg, rows, { sessionId: base1, wsInternal: false, caller: 'Mobile' });
  assert.ok(ext.items.find(i => i.api.endsWith('/limitCheck')).rules[0] === 'Called by Enterprise FundTransfer.');
  assert.ok(ext.items[0].rules[0] === 'Entry API, called by Mobile.');
});

test('processing rules work on pasted logs and export as a 3-column Markdown table', () => {
  const cfg = SS.defaultConfig();
  const sid = '25afb1c5-ac47-4646-b96c-36f77f8d7cb1';
  const text = [
    `2026-10-25 09:00:00.000 x [ECOMM-Message] sessionId ${sid} Request endpoint="/a"`,
    `2026-10-25 09:00:00.010 x [Enterprise-HostMessage] sessionIdentity ${sid} Request endpoint="E1"`,
    `2026-10-25 09:00:00.050 x [Enterprise-HostMessage] sessionIdentity ${sid} Response endpoint="E1"`,
    `2026-10-25 09:00:00.060 x [ECOMM-Message] sessionId ${sid} Response endpoint="/a"`,
    `2026-10-25 09:00:01.000 x [ECOMM-Message] sessionId ${sid} Request endpoint="/b|x"`,
    `2026-10-25 09:00:01.005 x [ECOMM-Message] sessionId ${sid} Response endpoint="/b|x"`,
    `2026-10-25 09:00:02.000 x [Enterprise-HostMessage] sessionIdentity ${sid} Response endpoint="E9"`,
  ].join('\n');
  const res = SS.processingSteps(cfg, SS.simulate(cfg, SS.parsePasted(text, cfg)).rows);
  assert.deepEqual(plain(res.items.map(i => i.steps)), ['1 → 4', '2 → 3', '5 → 6']);
  assert.ok(res.items[0].rules.includes('Responded at step 4 after 60 ms.'));
  assert.deepEqual(plain(res.orphans), [{ step: 7, layerLabel: 'Enterprise', api: 'E9' }]);

  const md = SS.processingStepsMarkdown(res);
  assert.ok(md.includes('| Step | Item | Processing rule |'));
  assert.ok(md.includes('| 1 → 4 | eComm `/a` | Entry API, called by App.<br>Calls, in order: Enterprise E1 (step 2).<br>'));
  assert.ok(md.includes('`/b\\|x`'), 'pipes escaped');
  assert.match(md, /Responses without a logged request: step 7 Enterprise E9\./);
});
