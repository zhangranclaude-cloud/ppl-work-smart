(function (SS) {
  'use strict';

  const KEYS = { cfg: 'ppl-work-smart.config', ui: 'ppl-work-smart.ui', paste: 'ppl-work-smart.pasted' };
  // Read data saved under the project's previous name until it is saved under the new one.
  const LEGACY = { [KEYS.cfg]: 'smart-splunk.config', [KEYS.ui]: 'smart-splunk.ui', [KEYS.paste]: 'smart-splunk.pasted' };
  const store = {
    get(k) {
      try { return localStorage.getItem(k) ?? (LEGACY[k] ? localStorage.getItem(LEGACY[k]) : null); } catch (e) { return null; }
    },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable: keep working in memory */ } },
    json(k) { try { const v = this.get(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  };

  let cfg = loadConfig();
  const ui = Object.assign(
    { cfgTab: 'scenario', outTab: 'result', source: 'mock', session: '', logFile: '', onlyIssues: false },
    store.json(KEYS.ui) || {});
  let pasted = store.get(KEYS.paste) || '';
  const state = { mock: [], input: [], sim: null, genError: null };
  let timer = null;

  const GEN = [['pattern', 'Pattern'], ['list', 'Random from list'], ['fixed', 'Fixed value'],
    ['number', 'Random number'], ['uuid', 'UUID'], ['seq', 'Sequence']];
  const GEN_HINT = {
    pattern: '# = digit, @ = letter A–Z, * = letter or digit, anything else is literal. e.g. TX##########',
    list: 'Comma-separated, picked at random. e.g. 200,200,200,500',
    fixed: 'Always this exact value',
    number: 'min-max, optionally :decimals. e.g. 10-5000:2',
    uuid: 'Random UUID (value box ignored)',
    seq: 'Prefix followed by a 4-digit counter. e.g. REQ → REQ0001',
  };
  const SCOPE = [['event', 'New value on every log line'], ['call', 'Same for request + response of a call'],
    ['flow', 'Same across one eComm call and its children'], ['session', 'Same for the whole session']];
  const ADD_LABEL = { ecomm: 'eComm API', enterprise: 'Enterprise API', ws: 'WS call', host: 'Host service' };

  function loadConfig() {
    const c = store.json(KEYS.cfg);
    try { return c ? SS.normalizeConfig(c) : SS.defaultConfig(); } catch (e) { return SS.defaultConfig(); }
  }

  // ---------- DOM helpers ----------
  const $ = s => document.querySelector(s);

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function changed() {
    store.set(KEYS.cfg, JSON.stringify(cfg));
    schedule(200);
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(runAll, ms); }
  function saveUi() { store.set(KEYS.ui, JSON.stringify(ui)); }
  function rerenderConfig() { renderConfig(); changed(); }

  function fText(label, obj, key, o = {}) {
    const el = h(o.multiline ? 'textarea' : 'input', {
      class: 'inp' + (o.mono ? ' mono' : ''),
      type: o.multiline ? null : (o.type || 'text'),
      step: o.step, min: o.min, rows: o.rows, placeholder: o.placeholder,
      spellcheck: 'false', autocomplete: 'off',
      oninput: e => {
        const v = e.target.value;
        obj[key] = o.type === 'number' ? (v === '' ? '' : Number(v)) : v;
        if (o.after) o.after();
        changed();
      },
      onchange: o.commit || null,
    });
    el.value = obj[key] ?? '';
    return h('label', { class: 'fld' + (o.wide ? ' wide' : '') },
      h('span', { class: 'lbl' }, label), el, o.hint ? h('span', { class: 'hint' }, o.hint) : null);
  }

  function fCheck(label, obj, key, after) {
    return h('label', { class: 'chk' },
      h('input', { type: 'checkbox', checked: !!obj[key], onchange: e => { obj[key] = e.target.checked; if (after) after(); changed(); } }),
      h('span', {}, label));
  }

  function fSelect(label, obj, key, options, after) {
    const sel = h('select', {
      class: 'inp',
      onchange: e => { obj[key] = e.target.value; if (after) after(); changed(); },
    }, options.map(([v, t]) => h('option', { value: v }, t)));
    sel.value = obj[key];
    return h('label', { class: 'fld' }, h('span', { class: 'lbl' }, label), sel);
  }

  function iconBtn(text, title, disabled, fn) {
    return h('button', { class: 'icon', title, 'aria-label': title, disabled: disabled || null, onclick: fn }, text);
  }

  function btn(text, fn, cls = '') { return h('button', { class: 'btn ' + cls, onclick: fn }, text); }

  function layerIdx(id) { return cfg.layers.findIndex(l => l.id === id); }
  function colorClass(idx) { return idx < 0 ? 'cn' : 'c' + (idx % 6); }
  function badge(id) {
    const i = layerIdx(id);
    return h('span', { class: 'badge ' + colorClass(i) }, i >= 0 ? cfg.layers[i].label : id);
  }

  function tabBar(tabs, active, pick) {
    return h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([id, t, count]) =>
      h('button', { class: 'tab' + (id === active ? ' active' : ''), role: 'tab', 'aria-selected': id === active ? 'true' : 'false', onclick: () => pick(id) },
        t, count != null ? h('span', { class: 'count' }, count) : null)));
  }

  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = h('textarea', {});
      ta.style.position = 'fixed'; // set via CSSOM: the CSP blocks inline style attributes
      ta.style.opacity = '0';
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    if (button) {
      const old = button.textContent;
      button.textContent = 'Copied ✓';
      setTimeout(() => { button.textContent = old; }, 1200);
    }
  }

  function download(name, text, type = 'text/plain') {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function withScroll(root, fn) {
    const body = root.querySelector('.panel-body');
    const top = body ? body.scrollTop : 0;
    fn();
    const nb = root.querySelector('.panel-body');
    if (nb) nb.scrollTop = top;
  }

  // ---------- Config panel ----------
  const CFG_TABS = [['scenario', 'Scenario'], ['params', 'Parameters'], ['layers', 'Log Layers'], ['settings', 'Settings'], ['input', 'Input Logs']];

  function renderConfig() {
    const root = $('#cfg');
    const views = { scenario: renderScenario, params: renderParams, layers: renderLayers, settings: renderSettings, input: renderInput };
    withScroll(root, () => root.replaceChildren(
      tabBar(CFG_TABS, ui.cfgTab, id => { ui.cfgTab = id; saveUi(); renderConfig(); }),
      h('div', { class: 'panel-body' }, (views[ui.cfgTab] || renderScenario)())));
  }

  function renderScenario() {
    const s = cfg.settings;
    const list = cfg.scenarios;
    if (!(ui.scenarioIdx >= 0 && ui.scenarioIdx < list.length)) ui.scenarioIdx = 0;
    const cur = list[ui.scenarioIdx];
    const total = SS.sessionPlan(cfg).length;
    const select = i => { ui.scenarioIdx = i; saveUi(); renderConfig(); };
    return h('div', {},
      h('div', { class: 'grid2' },
        fText('Gap between sessions (ms)', s, 'sessionGapMs', { type: 'number', min: 0, hint: 'Smaller than a session’s duration → sessions overlap' }),
        fText('Start time', s, 'startTime', { type: 'datetime-local', step: 1 }),
        fText('Noise lines', s, 'noiseLines', { type: 'number', min: 0, hint: 'Unrelated lines the query must ignore' }),
        h('div', { class: 'row end' },
          fText('Random seed', s, 'seed', { type: 'number' }),
          iconBtn('🎲', 'New random seed', false, () => { s.seed = Math.floor(Math.random() * 1e9); rerenderConfig(); }))),
      h('h3', {}, 'Scenarios'),
      h('p', { class: 'muted' }, `Every ticked scenario adds its sessions to the mock logs, mixed together in time order: ${total} session${total === 1 ? '' : 's'} in total. Click a scenario to edit its call flow.`),
      h('div', { class: 'scen-list' }, list.map((sc, i) => scenarioRow(sc, i, list, select))),
      h('div', { class: 'addrow' },
        btn('+ New scenario', () => { list.push(SS.newScenario(`Scenario ${list.length + 1}`)); select(list.length - 1); changed(); }, 'small'),
        btn('Restore built-in scenarios', () => {
          const have = new Set(list.map(x => x.name));
          const missing = SS.defaultScenarios().filter(x => !have.has(x.name));
          if (!missing.length) { alert('All built-in scenarios are already in the list.'); return; }
          list.push(...missing);
          rerenderConfig();
        }, 'small')),
      cur ? h('div', { class: 'scen-editor' },
        h('h3', {}, 'Call flow'),
        fText('Scenario name', cur, 'name', { commit: renderConfig }),
        h('p', { class: 'muted' }, 'Calls run top to bottom. Each call logs a request, runs its children in order, then logs its response.'),
        nodeList(cur.calls, ['ecomm']))
        : h('div', { class: 'empty' }, 'No scenarios yet. Add one to generate mock logs.'));
  }

  function scenarioRow(sc, i, list, select) {
    const move = j => { [list[i], list[j]] = [list[j], list[i]]; ui.scenarioIdx = j; saveUi(); rerenderConfig(); };
    const calls = countCalls(sc.calls);
    const sessions = h('input', {
      class: 'inp sessions', type: 'number', min: 0, max: 200, title: 'Sessions', 'aria-label': `Sessions for ${sc.name}`,
      oninput: e => { sc.sessions = e.target.value === '' ? 0 : Number(e.target.value); changed(); },
    });
    sessions.value = sc.sessions;
    return h('div', { class: 'scen' + (i === ui.scenarioIdx ? ' selected' : '') },
      h('input', {
        type: 'checkbox', title: 'Include in mock logs', 'aria-label': `Include ${sc.name}`, checked: sc.enabled !== false,
        onchange: e => { sc.enabled = e.target.checked; changed(); },
      }),
      h('button', { class: 'scen-name', onclick: () => select(i), title: 'Edit call flow' },
        h('span', {}, sc.name || '(unnamed)'), h('span', { class: 'muted small' }, `${calls} call${calls === 1 ? '' : 's'}`)),
      sessions, h('span', { class: 'muted small' }, 'sessions'),
      iconBtn('↑', 'Move up', i === 0, () => move(i - 1)),
      iconBtn('↓', 'Move down', i === list.length - 1, () => move(i + 1)),
      iconBtn('⧉', 'Duplicate', false, () => {
        list.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(sc)), name: sc.name + ' (copy)' });
        select(i + 1);
        changed();
      }),
      iconBtn('✕', 'Remove', false, () => {
        if (calls && !confirm(`Remove the scenario "${sc.name}"?`)) return;
        list.splice(i, 1);
        if (ui.scenarioIdx >= list.length) ui.scenarioIdx = list.length - 1;
        saveUi();
        rerenderConfig();
      }));
  }

  function countCalls(nodes) {
    return (nodes || []).reduce((n, x) => n + 1 + countCalls(x.children), 0);
  }

  // Session id -> scenario name, known only for generated logs.
  function scenarioNames() {
    const m = {};
    if (ui.source !== 'pasted') for (const e of state.mock) if (e.sessionId && e.scenario) m[e.sessionId] = e.scenario;
    return m;
  }

  function sessionOption(sid, names) {
    return h('option', { value: sid }, names[sid] ? `${names[sid]} · ${sid.slice(0, 8)}` : sid);
  }

  function nodeList(arr, childLayers) {
    return h('div', { class: 'nodes' },
      arr.map((n, i) => nodeCard(n, arr, i)),
      h('div', { class: 'addrow' }, childLayers.map(id =>
        btn('+ ' + ADD_LABEL[id], () => { arr.push(SS.newNode(id)); rerenderConfig(); }, 'small'))));
  }

  function nodeCard(n, arr, i) {
    const kids = SS.CHILDREN[n.layer] || [];
    const fields = n.layer === 'host'
      ? [fText('Main SvcCode', n, 'main', { mono: true }), fText('Sub SvcCodes (comma-separated)', n, 'subs', { mono: true })]
      : [fText(n.layer === 'ws' ? 'Web service URL' : 'API / endpoint', n, 'api', { mono: true, wide: true })];
    const move = (j) => { [arr[i], arr[j]] = [arr[j], arr[i]]; rerenderConfig(); };
    return h('div', { class: 'node ' + colorClass(layerIdx(n.layer)) },
      h('div', { class: 'node-head' }, badge(n.layer), h('span', { class: 'spacer' }),
        iconBtn('↑', 'Move up', i === 0, () => move(i - 1)),
        iconBtn('↓', 'Move down', i === arr.length - 1, () => move(i + 1)),
        iconBtn('✕', 'Remove', false, () => { arr.splice(i, 1); rerenderConfig(); })),
      h('div', { class: 'grid2' }, fields,
        fText(kids.length ? 'Own processing time (ms, min-max)' : 'Latency (ms, min-max)', n, 'ms', { placeholder: '20-80' })),
      fCheck('No response logged (simulate a timeout)', n, 'noResponse'),
      kids.length ? h('div', { class: 'children' }, nodeList(n.children = n.children || [], kids)) : null);
  }

  function renderParams() {
    return h('div', {},
      h('p', { class: 'muted' }, 'Each parameter is written into the mock logs, pulled out by its own rex in the SPL, and shown in the Params column. Add or remove them and everything updates.'),
      cfg.params.map(paramCard),
      btn('+ Add parameter', () => { cfg.params.push(SS.newParam(cfg)); rerenderConfig(); }));
  }

  function paramCard(p, i) {
    const err = h('div', { class: 'err' }, SS.paramNameError(p.name, cfg) || '');
    const title = h('strong', { class: 'mono' }, p.name || '(unnamed)');
    const updName = () => { err.textContent = SS.paramNameError(p.name, cfg) || ''; title.textContent = p.name || '(unnamed)'; };
    return h('div', { class: 'card' },
      h('div', { class: 'node-head' }, title, h('span', { class: 'spacer' }),
        iconBtn('✕', 'Remove parameter', false, () => { cfg.params.splice(i, 1); rerenderConfig(); })),
      h('div', { class: 'grid2' },
        fText('Splunk field name', p, 'name', { mono: true, after: updName, commit: renderConfig }),
        fText('Label in Params column', p, 'label'),
        fText('Key as written in the log', p, 'logKey', { mono: true, placeholder: p.name, commit: renderConfig }),
        fSelect('Write on', p, 'on', [['both', 'Request + response'], ['request', 'Request only'], ['response', 'Response only']])),
      err,
      h('div', { class: 'fld' }, h('span', { class: 'lbl' }, 'Layers'),
        h('div', { class: 'chips' }, cfg.layers.map(l => h('label', { class: 'chk' },
          h('input', {
            type: 'checkbox', checked: p.layers.includes(l.id),
            onchange: e => {
              p.layers = e.target.checked ? [...new Set([...p.layers, l.id])] : p.layers.filter(x => x !== l.id);
              changed();
            },
          }), badge(l.id))))),
      h('div', { class: 'grid2' },
        fSelect('Mock value', p, 'gen', GEN, renderConfig),
        fText('Generator input', p, 'genArg', { mono: true, hint: GEN_HINT[p.gen] })),
      fSelect('Value reuse', p, 'scope', SCOPE),
      fText('Extraction regex (empty = automatic)', p, 'regex', {
        mono: true, placeholder: SS.autoParamRegex(p),
        hint: 'Capture with (?<value>…). The automatic regex handles key="v", key=v, "key":"v" and <Key>v</Key>.',
      }));
  }

  function renderLayers() {
    return h('div', {},
      h('p', { class: 'muted' }, 'One card per log type. Layers are checked top to bottom and an event goes to the first one whose classify regex matches. Regexes are PCRE-style as in Splunk; capture the value with (?<value>…).'),
      cfg.layers.map((l, i) => h('details', { class: 'card', open: i === 0 ? true : null },
        h('summary', {}, badge(l.id), h('span', { class: 'muted' }, ` depth ${l.depth} · ${l.apiMode === 'svccode' ? 'service codes' : 'single API'}`)),
        h('div', { class: 'grid2' },
          fText('Display name', l, 'label', { commit: renderConfig }),
          fText('Depth (indent level)', l, 'depth', { type: 'number', min: 1 })),
        h('h4', {}, 'Splunk base search'),
        fText('Source clause', l, 'source', { mono: true }),
        fText('Search terms', l, 'terms', { mono: true }),
        h('h4', {}, 'Extraction'),
        fText('Classify: the event belongs here when _raw matches', l, 'classify', { mono: true }),
        fText('Session ID', l, 'sessionRegex', { mono: true, hint: 'If this misses, the generic UUID regex in Settings is used.' }),
        h('div', { class: 'grid2' },
          fText('Request when _raw matches', l, 'requestRegex', { mono: true }),
          fText('Response when _raw matches', l, 'responseRegex', { mono: true })),
        fText('API / endpoint', l, 'apiRegex', { mono: true }),
        h('div', { class: 'grid2' },
          fSelect('API mode', l, 'apiMode', [['single', 'Single value'], ['svccode', 'All matches: main.sub1,sub2']], renderConfig),
          fSelect('Params format in mock log', l, 'paramStyle', [['kv', 'key="value"'], ['xml', '<Key>value</Key>']])),
        fCheck('A response without an API reuses the last request’s API in the session', l, 'inheritApi'),
        fCheck('Drop events where the API isn’t found (otherwise shows N/A)', l, 'requireApi'),
        h('h4', {}, 'Mock log'),
        h('p', { class: 'hint' }, 'Placeholders: {ts} {sessionId} {api} {direction} {svcCodes} {main} {subs} {params}'),
        fText('Request template', l, 'reqTemplate', { mono: true, multiline: true, rows: 3 }),
        fText('Response template', l, 'respTemplate', { mono: true, multiline: true, rows: 3 }),
        fText('Mock file name', l, 'mockFile', { mono: true }))));
  }

  function renderSettings() {
    const s = cfg.settings;
    return h('div', {},
      fText('Session filter (added to the base search)', s, 'sessionFilter', { mono: true, hint: 'A macro, token or search term, e.g. `SEARCH_SESSION_ID` or "$session_id$"' }),
      h('div', { class: 'grid2' },
        fText('Request symbol', s, 'requestSymbol', { mono: true }),
        fText('Response symbol', s, 'responseSymbol', { mono: true })),
      fText('Generic session ID regex (fallback)', s, 'genericSessionRegex', { mono: true }),
      fText('Timestamp regex for pasted logs', s, 'timeRegex', { mono: true }),
      fCheck('Add ``` step comments ``` to the SPL (needs Splunk 8.0+)', s, 'splComments'),
      h('h3', {}, 'Config'),
      h('p', { class: 'muted' }, 'Your config saves in this browser automatically. Export it to share it or keep a copy.'),
      h('div', { class: 'row' },
        btn('Export config', () => download('ppl-work-smart-config.json', JSON.stringify(cfg, null, 2), 'application/json')),
        btn('Import config', () => $('#import').click()),
        btn('Reset to defaults', () => {
          if (!confirm('Replace the current config with the defaults?')) return;
          cfg = SS.defaultConfig();
          rerenderConfig();
        }, 'danger')));
  }

  function renderInput() {
    const opt = (v, t) => h('label', { class: 'radio' },
      h('input', { type: 'radio', name: 'src', checked: ui.source === v, onchange: () => { ui.source = v; saveUi(); runAll(); } }), t);
    return h('div', {},
      h('p', { class: 'muted' }, 'Choose which logs go into the Flow Result, Extraction Debug and Splunk Test Harness tabs.'),
      h('div', { class: 'seg' }, opt('mock', 'Generated mock logs'), opt('pasted', 'Pasted logs')),
      h('div', { class: 'row' },
        btn('Copy mock logs into the box', () => {
          pasted = state.mock.map(e => e.raw).join('\n');
          store.set(KEYS.paste, pasted);
          ui.source = 'pasted';
          saveUi();
          renderConfig();
          runAll();
        }, 'small'),
        btn('Clear', () => { pasted = ''; store.set(KEYS.paste, ''); renderConfig(); runAll(); }, 'small')),
      h('textarea', {
        class: 'inp mono paste', rows: 22, spellcheck: 'false',
        placeholder: 'Paste real log lines here, one event per line…',
        value: pasted,
        oninput: e => { pasted = e.target.value; store.set(KEYS.paste, pasted); if (ui.source === 'pasted') schedule(300); },
      }),
      h('p', { class: 'hint' }, 'Timestamps are read with the regex in Settings. Put each event on one line; join multi-line XML first.'));
  }

  // ---------- Output panel ----------
  function runAll() {
    state.genError = null;
    try { state.mock = SS.generate(cfg); } catch (e) { state.mock = []; state.genError = 'Mock generation failed: ' + e.message; }
    state.input = ui.source === 'pasted' ? SS.parsePasted(pasted, cfg) : state.mock;
    state.sim = SS.simulate(cfg, state.input);
    renderOutput();
  }

  function renderOutput() {
    const root = $('#out');
    const sim = state.sim;
    const issues = [state.genError, ...sim.errors, ...SS.configIssues(cfg)].filter(Boolean);
    const problems = sim.debug.filter(d => d.mismatch).length;
    const tabs = [
      ['result', 'Flow Result', sim.rows.length],
      ['diagram', 'Sequence Diagram'],
      ['debug', 'Extraction Debug', problems || null],
      ['logs', 'Mock Logs', state.mock.length],
      ['spl', 'Splunk Query'],
      ['harness', 'Splunk Test Harness'],
    ];
    const views = { result: viewResult, diagram: viewDiagram, debug: viewDebug, logs: viewLogs, spl: viewSpl, harness: viewHarness };
    withScroll(root, () => root.replaceChildren(
      tabBar(tabs, ui.outTab, id => { ui.outTab = id; saveUi(); renderOutput(); }),
      ...(issues.length ? [h('div', { class: 'banner' }, h('strong', {}, 'Check your config'), h('ul', {}, issues.map(x => h('li', {}, x))))] : []),
      h('div', { class: 'panel-body' }, (views[ui.outTab] || viewResult)())));
  }

  function selfTestChip() {
    if (ui.source === 'pasted') return h('span', { class: 'chip' }, 'Pasted logs: no expected result to compare');
    const bad = state.sim.debug.filter(d => d.mismatch).length;
    return bad
      ? h('button', { class: 'chip warn', onclick: () => { ui.outTab = 'debug'; ui.onlyIssues = true; saveUi(); renderOutput(); } }, `⚠ ${bad} line(s) not handled as expected`)
      : h('span', { class: 'chip ok' }, '✓ Every mock line handled as expected');
  }

  function viewResult() {
    const sim = state.sim;
    const sessions = [...new Set(sim.rows.map(r => r.sessionId).filter(Boolean))];
    if (ui.session && !sessions.includes(ui.session)) ui.session = '';
    const rows = ui.session ? sim.rows.filter(r => r.sessionId === ui.session) : sim.rows;
    const dropped = sim.debug.filter(d => d.status !== 'kept').length;
    const names = scenarioNames();
    const hasNames = Object.keys(names).length > 0;
    const sel = h('select', { class: 'inp compact', onchange: e => { ui.session = e.target.value; saveUi(); renderOutput(); } },
      h('option', { value: '' }, `All sessions (${sessions.length})`),
      sessions.map(s => sessionOption(s, names)));
    sel.value = ui.session;
    const header = ['Step', 'EventTime', ...(hasNames ? ['Scenario'] : []), 'sessionId', 'Flow', 'Params', 'ElapsedMs'];
    const csv = () => [header,
      ...rows.map(r => [r.step, r.eventTime, ...(hasNames ? [names[r.sessionId] || ''] : []), r.sessionId, r.flow, r.params, r.elapsed])]
      .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const copyBtn = btn('Copy CSV', () => copyText(csv(), copyBtn), 'small');
    return h('div', {},
      h('div', { class: 'toolbar' },
        h('span', { class: 'chip' }, `${ui.source === 'pasted' ? 'Pasted' : 'Mock'} input: ${state.input.length} lines`),
        h('span', { class: 'chip' }, `${dropped} filtered out`),
        selfTestChip(),
        h('span', { class: 'spacer' }), sel, copyBtn,
        btn('Download CSV', () => download('ppl-work-smart-flow.csv', csv(), 'text/csv'), 'small')),
      rows.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
          h('thead', {}, h('tr', {}, header.map(t => h('th', {}, t)))),
          h('tbody', {}, rows.map(r => h('tr', { class: colorClass(r.layerIdx) },
            h('td', { class: 'num' }, r.step ?? ''),
            h('td', { class: 'mono nowrap' }, r.eventTime),
            hasNames ? h('td', { class: 'small nowrap' }, names[r.sessionId] || '') : null,
            h('td', { class: 'mono small', title: r.sessionId || '' }, r.sessionId ? r.sessionId.slice(0, 8) + '…' : ''),
            h('td', { class: 'mono flow nowrap' }, r.flow),
            h('td', { class: 'mono small' }, r.params),
            h('td', { class: 'num' }, r.elapsed ?? ''))))))
        : h('div', { class: 'empty' }, emptyReason()));
  }

  // Say why the Flow Result is empty, most likely cause first.
  function emptyReason() {
    if (state.genError) return `${state.genError}. Reload the page with Ctrl+F5; if it persists, use Settings → Reset to defaults.`;
    if (ui.source === 'pasted' && !state.input.length) {
      return h('span', {}, 'Input Logs is set to “Pasted logs” but the box is empty. ',
        btn('Use generated mock logs', () => { ui.source = 'mock'; saveUi(); renderConfig(); runAll(); }, 'small'));
    }
    if (ui.source !== 'pasted' && !SS.sessionPlan(cfg).length) {
      return 'No scenario is generating sessions. On the Scenario tab, tick at least one scenario that has calls and 1 or more sessions.';
    }
    if (ui.session) return 'Nothing for the selected session. Pick “All sessions” above.';
    return 'Every input line was filtered out. Check Extraction Debug to see which regex missed.';
  }

  function viewDiagram() {
    const rows = state.sim.rows;
    const sessions = SS.diagramSessions(rows);
    if (!sessions.includes(ui.diagramSession)) ui.diagramSession = sessions[0] || '';
    ui.puml = Object.assign({ caller: 'App', params: true, time: false, elapsed: true, autonumber: true }, ui.puml || {});
    const opts = ui.puml;
    const names = scenarioNames();
    const puml = SS.buildPlantUml(cfg, rows, { ...opts, sessionId: ui.diagramSession, label: names[ui.diagramSession] });
    const rerender = () => { saveUi(); renderOutput(); };

    const sel = h('select', { class: 'inp compact', onchange: e => { ui.diagramSession = e.target.value; rerender(); } },
      sessions.map(s => sessionOption(s, names)));
    sel.value = ui.diagramSession;
    const opt = (key, label) => h('label', { class: 'chk' },
      h('input', { type: 'checkbox', checked: !!opts[key], onchange: e => { opts[key] = e.target.checked; rerender(); } }), h('span', {}, label));
    const caller = h('input', {
      class: 'inp compact', 'aria-label': 'Caller name', placeholder: 'App',
      onchange: e => { opts.caller = e.target.value; rerender(); },
    });
    caller.value = opts.caller;
    const copyBtn = btn('Copy PlantUML', () => copyText(puml, copyBtn), 'small primary');
    const file = 'ppl-work-smart-sequence' + (ui.diagramSession ? '-' + ui.diagramSession.slice(0, 8) : '') + '.puml';

    return h('div', {},
      h('div', { class: 'toolbar' },
        h('span', { class: 'lbl' }, 'Session'), sel,
        h('span', { class: 'lbl' }, 'Caller'), caller,
        h('span', { class: 'spacer' }), copyBtn,
        btn('Download .puml', () => download(file, puml + '\n'), 'small')),
      h('div', { class: 'toolbar' },
        opt('params', 'Params on arrows'), opt('elapsed', 'Elapsed time on responses'),
        opt('time', 'Timestamps'), opt('autonumber', 'Number the steps')),
      h('p', { class: 'muted' }, 'Built from the Flow Result, one session per diagram. Render it with the PlantUML extension in VS Code or IntelliJ, or with plantuml.jar. Nothing is sent to a PlantUML server.'),
      h('h4', {}, 'PlantUML code'),
      h('pre', { class: 'code puml' }, puml),
      diagramPreview(puml, ui.diagramSession));
  }

  // Canvas text measurement so the SVG layout fits labels exactly.
  let measureCtx = null;
  function measure(s) {
    if (!measureCtx) {
      measureCtx = document.createElement('canvas').getContext('2d');
      if (measureCtx) measureCtx.font = SS.SEQ_FONT;
    }
    return measureCtx ? measureCtx.measureText(String(s)).width : String(s).length * 6.8;
  }

  function diagramPreview(puml, sid) {
    const layout = SS.layoutSequence(SS.parsePlantUml(puml), measure);
    const svgBtn = btn('Download .svg', () => download(
      'ppl-work-smart-sequence' + (sid ? '-' + sid.slice(0, 8) : '') + '.svg',
      SS.sequenceSvgString(layout), 'image/svg+xml'), 'small');
    return h('div', {},
      h('div', { class: 'toolbar preview-head' },
        h('h4', {}, 'Diagram'),
        h('span', { class: 'muted small' }, 'Drawn in your browser from the code above. Rendering can differ slightly from PlantUML’s own output.'),
        h('span', { class: 'spacer' }), svgBtn),
      h('div', { class: 'seq-wrap' }, svgElement(layout)));
  }

  function svgElement(layout) {
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      return e;
    };
    const svg = el('svg', {
      class: 'seq-svg', width: layout.width, height: layout.height,
      viewBox: `0 0 ${layout.width} ${layout.height}`, role: 'img', 'aria-label': 'Sequence diagram',
    });
    for (const s of layout.shapes) {
      if (s.t === 'line') svg.append(el('line', { class: s.c, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 }));
      else if (s.t === 'rect') svg.append(el('rect', { class: s.c, x: s.x, y: s.y, width: s.w, height: s.h, rx: s.rx || 0 }));
      else if (s.t === 'circle') svg.append(el('circle', { class: s.c, cx: s.cx, cy: s.cy, r: s.r }));
      else if (s.t === 'poly') svg.append(el('polygon', { class: s.c, points: s.pts.map(p => p.join(',')).join(' ') }));
      else if (s.t === 'text') {
        const t = el('text', { class: s.c, x: s.x, y: s.y, 'text-anchor': s.a });
        t.textContent = s.s;
        svg.append(t);
      }
    }
    return svg;
  }

  function viewDebug() {
    const sim = state.sim;
    const truth = ui.source !== 'pasted';
    let list = sim.debug;
    if (ui.onlyIssues) list = list.filter(d => d.mismatch || (!truth && d.status !== 'kept'));
    const shown = list.slice(0, 1500);
    return h('div', {},
      h('div', { class: 'toolbar' },
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: ui.onlyIssues, onchange: e => { ui.onlyIssues = e.target.checked; saveUi(); renderOutput(); } }),
          h('span', {}, truth ? 'Only lines not handled as expected' : 'Only filtered-out lines')),
        selfTestChip()),
      h('p', { class: 'muted' }, 'What each step of the query extracts from every input line. Use it to fix regexes against your real log format.'),
      shown.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid debug' },
        h('thead', {}, h('tr', {}, ['#', 'Time', truth ? 'Written as' : null, 'Classified', 'Dir', 'sessionId', 'API', 'Extracted params', 'Result'].filter(Boolean).map(t => h('th', {}, t)))),
        h('tbody', {}, shown.map(d => [
          h('tr', { class: (d.mismatch ? 'bad ' : '') + colorClass(d.layerIdx) },
            h('td', { class: 'num' }, d.idx),
            h('td', { class: 'mono nowrap small' }, SS.formatTs(d.time).slice(11)),
            truth ? h('td', {}, d.expectedId ? badge(d.expectedId) : h('span', { class: 'badge cn' }, 'noise')) : null,
            h('td', {}, d.layerId ? badge(d.layerId) : h('span', { class: 'muted' }, '—')),
            h('td', {}, d.direction || h('span', { class: 'muted' }, '—')),
            h('td', { class: 'mono small', title: d.sessionId || '' }, d.sessionId ? d.sessionId.slice(0, 8) + '…' : h('span', { class: 'muted' }, '—')),
            h('td', { class: 'mono small' }, d.api || h('span', { class: 'muted' }, '—')),
            h('td', { class: 'mono small' }, Object.entries(d.params).map(([k, v]) => `${k}=${v}`).join('  ') || h('span', { class: 'muted' }, '—')),
            h('td', { class: 'small' }, d.mismatch ? h('span', { class: 'bad-text' }, d.mismatch)
              : d.status === 'kept' ? h('span', { class: 'ok-text' }, 'kept') : h('span', { class: 'muted' }, 'filtered: ' + d.reason))),
          h('tr', { class: 'rawrow' }, h('td', { colspan: truth ? 9 : 8, class: 'mono raw' }, d.raw)),
        ])))) : h('div', { class: 'empty' }, 'Nothing to show.'),
      list.length > shown.length ? h('p', { class: 'muted' }, `Showing the first ${shown.length} of ${list.length} lines.`) : null);
  }

  function viewLogs() {
    const files = [...new Set(state.mock.map(e => e.file))];
    const scenarios = [...new Set(state.mock.map(e => e.scenario).filter(Boolean))];
    if (ui.logFile && !files.includes(ui.logFile)) ui.logFile = '';
    if (ui.logScenario && !scenarios.includes(ui.logScenario)) ui.logScenario = '';
    const events = state.mock.filter(e => (!ui.logFile || e.file === ui.logFile) && (!ui.logScenario || e.scenario === ui.logScenario));
    const text = events.map(e => e.raw).join('\n');
    const sel = h('select', { class: 'inp compact', 'aria-label': 'Log file', onchange: e => { ui.logFile = e.target.value; saveUi(); renderOutput(); } },
      h('option', { value: '' }, 'All files, merged by time'), files.map(f => h('option', { value: f }, f)));
    sel.value = ui.logFile;
    const scenSel = h('select', { class: 'inp compact', 'aria-label': 'Scenario', onchange: e => { ui.logScenario = e.target.value; saveUi(); renderOutput(); } },
      h('option', { value: '' }, `All scenarios (${scenarios.length}) + noise`), scenarios.map(s => h('option', { value: s }, s)));
    scenSel.value = ui.logScenario || '';
    const copyBtn = btn('Copy', () => copyText(text, copyBtn), 'small');
    return h('div', {},
      h('div', { class: 'toolbar' }, sel, scenSel, h('span', { class: 'spacer' }), copyBtn,
        btn('Download', () => download(ui.logFile || 'ppl-work-smart-mock.log', text + '\n'), 'small'),
        btn('Download each file', () => files.forEach(f => download(f, state.mock.filter(e => e.file === f).map(e => e.raw).join('\n') + '\n')), 'small')),
      h('div', { class: 'legend' }, cfg.layers.map(l => badge(l.id)), h('span', { class: 'badge cn' }, 'noise')),
      h('pre', { class: 'logs' }, events.map(e => h('div', { class: 'ln ' + colorClass(e.layerIdx) }, e.raw))));
  }

  function viewSpl() {
    const spl = SS.buildSpl(cfg);
    const copyBtn = btn('Copy SPL', () => copyText(spl, copyBtn), 'small primary');
    return h('div', {},
      h('div', { class: 'toolbar' },
        h('span', { class: 'muted' }, 'Built from Log Layers, Parameters and Settings. Run it on your real indexes.'),
        h('span', { class: 'spacer' }), copyBtn,
        btn('Download .spl', () => download('ppl-work-smart-flow.spl', spl + '\n'), 'small')),
      h('pre', { class: 'code' }, spl));
  }

  function viewHarness() {
    const spl = SS.buildSpl(cfg, { events: state.input });
    const copyBtn = btn('Copy harness', () => copyText(spl, copyBtn), 'small primary');
    return h('div', {},
      h('div', { class: 'toolbar' },
        h('span', { class: 'muted' }, `The same query, with your ${ui.source === 'pasted' ? 'pasted' : 'mock'} lines (${state.input.length}) built in through makeresults. Paste it into Splunk Search; nothing needs to be indexed. Splunk's output should match the Flow Result tab.`),
        h('span', { class: 'spacer' }), copyBtn),
      state.input.length > 400 ? h('div', { class: 'banner' }, 'That’s a lot of lines for one search string. Lower Sessions or Noise lines if Splunk rejects it.') : null,
      h('pre', { class: 'code' }, spl));
  }

  // ---------- Boot ----------
  $('#import').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      cfg = SS.normalizeConfig(JSON.parse(await f.text()));
      rerenderConfig();
    } catch (err) {
      alert('Could not import that file: ' + err.message);
    }
  });

  renderConfig();
  runAll();
})(window.SS);
