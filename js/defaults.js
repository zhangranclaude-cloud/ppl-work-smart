(function (SS) {
  'use strict';

  SS.CONFIG_VERSION = 1;

  const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

  // Which layer a scenario node may call into.
  SS.CHILDREN = { ecomm: ['enterprise'], enterprise: ['ws', 'host'], ws: [], host: [] };

  SS.RESERVED = [
    'LayerName', 'Layer', 'Direction', 'sessionId', 'API', 'PairKey', 'Params', 'SortKey', 'reqTime',
    'lastReqTime', 'ElapsedMs', 'HostServices', 'DirectionSymbol', 'Indent', 'Flow', 'Step', 'EventTime', 'sidAny', 'row',
    'source', 'sourcetype', 'host', 'index', 'linecount', 'punct', 'splunk_server',
  ];

  SS.newParam = function (cfg) {
    let n = 1;
    while (cfg && cfg.params.some(p => p.name === 'param' + n)) n++;
    return {
      name: 'param' + n, label: 'Param' + n, logKey: '', layers: ['ecomm'], on: 'both',
      gen: 'pattern', genArg: '######', scope: 'call', regex: '',
    };
  };

  SS.newNode = function (layer) {
    const base = { layer, ms: '20-80', noResponse: false, children: [] };
    if (layer === 'ecomm') return { ...base, api: '/api/v1/new/endpoint', ms: '10-40' };
    if (layer === 'enterprise') return { ...base, api: 'NewEnterpriseApi', ms: '10-30' };
    if (layer === 'ws') return { ...base, api: 'https://enterprise-sit.internal/ws/newService', ms: '60-150' };
    return { ...base, main: 'SV01', subs: 'S01', ms: '120-260' };
  };

  const node = (layer, props, children = []) => ({ ...SS.newNode(layer), ...props, children });

  SS.newScenario = (name, calls) => ({ name, enabled: true, sessions: 1, calls: calls || [SS.newNode('ecomm')] });

  const WS = 'https://enterprise-sit.internal/ws/';
  const login = () => node('ecomm', { api: '/api/v1/auth/login', ms: '15-40' }, [
    node('enterprise', { api: 'CustomerLogin', ms: '10-30' }, [
      node('host', { main: 'CL01', subs: 'A01', ms: '120-250' }),
    ]),
  ]);

  // Built-in journeys, together covering every shape of flow the query has to handle.
  SS.defaultScenarios = () => [
    SS.newScenario('Login, eligibility and fund transfer', [
      login(),
      node('ecomm', { api: '/api/v1/rules/eligibility', ms: '5-15' }),
      node('ecomm', { api: '/api/v1/payment/transfer', ms: '20-60' }, [
        node('enterprise', { api: 'AccountInquiry', ms: '10-30' }, [
          node('ws', { api: WS + 'accountInquiry', ms: '80-160' }),
        ]),
        node('enterprise', { api: 'FundTransfer', ms: '15-40' }, [
          node('ws', { api: WS + 'limitCheck', ms: '60-120' }),
          node('host', { main: 'FT01', subs: 'A01,A02', ms: '150-300' }),
        ]),
      ]),
    ]),
    SS.newScenario('Bill payment', [
      login(),
      node('ecomm', { api: '/api/v1/bills/pay', ms: '20-50' }, [
        node('enterprise', { api: 'BillerInquiry', ms: '10-25' }, [
          node('ws', { api: WS + 'billerLookup', ms: '70-140' }),
        ]),
        node('enterprise', { api: 'BillPayment', ms: '15-35' }, [
          node('host', { main: 'BP01', subs: 'A01,A02,A03', ms: '180-320' }),
        ]),
      ]),
    ]),
    SS.newScenario('Account summary (several Host services)', [
      login(),
      node('ecomm', { api: '/api/v1/accounts/summary', ms: '15-40' }, [
        node('enterprise', { api: 'AccountSummary', ms: '10-30' }, [
          node('ws', { api: WS + 'customerProfile', ms: '50-110' }),
          node('host', { main: 'AS01', subs: 'A01', ms: '100-200' }),
          node('host', { main: 'AS02', subs: 'B01,B02', ms: '110-220' }),
        ]),
      ]),
    ]),
    SS.newScenario('Rules only (no Enterprise call)', [
      node('ecomm', { api: '/api/v1/rules/eligibility', ms: '5-15' }),
      node('ecomm', { api: '/api/v1/offers/personalised', ms: '8-25' }),
    ]),
    SS.newScenario('Profile update (Enterprise, no Host)', [
      login(),
      node('ecomm', { api: '/api/v1/profile/update', ms: '15-35' }, [
        node('enterprise', { api: 'UpdateProfile', ms: '20-45' }),
      ]),
    ]),
    SS.newScenario('Fund transfer with Host timeout', [
      login(),
      node('ecomm', { api: '/api/v1/payment/transfer', ms: '20-60' }, [
        node('enterprise', { api: 'FundTransfer', ms: '15-40' }, [
          node('host', { main: 'FT01', subs: 'A01,A02', ms: '150-300', noResponse: true }),
        ]),
      ]),
    ]),
  ];

  function today10am() {
    const d = new Date();
    return `${d.getFullYear()}-${SS.pad(d.getMonth() + 1)}-${SS.pad(d.getDate())}T10:00:00`;
  }

  SS.defaultConfig = () => ({
    version: SS.CONFIG_VERSION,
    settings: {
      sessionGapMs: 400,
      startTime: today10am(),
      noiseLines: 4,
      seed: 20261025,
      sessionFilter: '`SEARCH_SESSION_ID`',
      requestSymbol: '?',
      responseSymbol: '!',
      genericSessionRegex: `(?<value>${UUID})`,
      timeRegex: String.raw`^(?<value>\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:[.,]\d{1,6})?)?)`,
      splComments: true,
    },

    // Order matters: an event belongs to the FIRST layer whose classify regex matches.
    layers: [
      {
        id: 'ecomm', label: 'eComm', depth: 1,
        source: 'source="/var/log/pods/sit-01-online-*.log"',
        terms: '"[ECOMM-Message]"',
        mockFile: 'sit-01-online-6f7c9d-x2k4p.log',
        classify: String.raw`\[ECOMM-Message\]`,
        sessionRegex: String.raw`\[ECOMM-Message\]\s+sessionId\s+(?<value>[0-9a-fA-F-]{36})`,
        requestRegex: String.raw`\bRequest\b`,
        responseRegex: String.raw`\bResponse\b`,
        apiRegex: String.raw`(?i)\bendpoint"?\s*[:=]\s*"?(?<value>[^",\s]+)`,
        apiMode: 'single', inheritApi: false, requireApi: false, paramStyle: 'kv',
        reqTemplate: '{ts} INFO  [http-nio-8080-exec-3] c.b.ecomm.MessageLogger : [ECOMM-Message] sessionId {sessionId} Request endpoint="{api}" {params}',
        respTemplate: '{ts} INFO  [http-nio-8080-exec-3] c.b.ecomm.MessageLogger : [ECOMM-Message] sessionId {sessionId} Response endpoint="{api}" {params}',
      },
      {
        id: 'enterprise', label: 'Enterprise', depth: 2,
        source: 'source="/var/log/pods/sit-01-online-*.log"',
        terms: '"[Enterprise-HostMessage]"',
        mockFile: 'sit-01-online-6f7c9d-x2k4p.log',
        classify: String.raw`\[Enterprise-HostMessage\]`,
        sessionRegex: String.raw`\[Enterprise-HostMessage\]\s+sessionIdentity\s+(?<value>[0-9a-fA-F-]{36})`,
        requestRegex: String.raw`\bRequest\b`,
        responseRegex: String.raw`\bResponse\b`,
        apiRegex: String.raw`(?i)\bendpoint"?\s*[:=]\s*"?(?<value>[^",\s]+)`,
        apiMode: 'single', inheritApi: false, requireApi: false, paramStyle: 'kv',
        reqTemplate: '{ts} INFO  [enterprise-worker-2] c.b.ent.HostMessageLogger : [Enterprise-HostMessage] sessionIdentity {sessionId} Request endpoint="{api}" {params}',
        respTemplate: '{ts} INFO  [enterprise-worker-2] c.b.ent.HostMessageLogger : [Enterprise-HostMessage] sessionIdentity {sessionId} Response endpoint="{api}" {params}',
      },
      {
        id: 'host', label: 'Host', depth: 3,
        source: '(source="/var/log/pods/microservice-sit-01-ms-*.log" OR source="/var/log/pods/microservice-sit-01_rewards*.log")',
        terms: '"<EAI>" "<SvcCode>" ("Request Message" OR "Response Message")',
        mockFile: 'microservice-sit-01-ms-account-5c8d7f-q9w2e.log',
        classify: '<SvcCode>',
        sessionRegex: String.raw`(?i)sessionId\s*[:=>]\s*"?(?<value>[0-9a-fA-F-]{36})`,
        requestRegex: '(?i)request message',
        responseRegex: '(?i)response message',
        apiRegex: '<SvcCode>(?<value>[^<]+)</SvcCode>',
        apiMode: 'svccode', inheritApi: false, requireApi: true, paramStyle: 'xml',
        reqTemplate: '{ts} INFO  [mq-listener-1] c.b.ms.MQClient : sessionId={sessionId} Request Message <EAI><Header>{svcCodes}</Header><Body>{params}</Body></EAI>',
        respTemplate: '{ts} INFO  [mq-listener-1] c.b.ms.MQClient : sessionId={sessionId} Response Message <EAI><Header>{svcCodes}<RespCode>00</RespCode></Header><Body>{params}</Body></EAI>',
      },
      {
        id: 'ws', label: 'WS', depth: 3,
        source: '(source="/var/log/pods/microservice-sit-01-ms-*.log" OR source="/var/log/pods/microservice-sit-01_rewards*.log")',
        terms: '"*WSAppLog*" ("request:" OR "RESPONSE from Enterprise" OR "Response:")',
        mockFile: 'microservice-sit-01-ms-account-5c8d7f-q9w2e.log',
        classify: 'WSAppLog',
        sessionRegex: String.raw`(?i)sessionId\s*[:=]\s*"?(?<value>[0-9a-fA-F-]{36})`,
        requestRegex: '(?i)request:',
        responseRegex: '(?i)response from enterprise|response:',
        apiRegex: String.raw`(?i)\bURL\s*[:=]?\s*(?<value>[^\s",]+)`,
        apiMode: 'single', inheritApi: true, requireApi: false, paramStyle: 'kv',
        reqTemplate: '{ts} INFO  [ws-client-4] c.b.ms.WSAppLog : sessionId={sessionId} request: URL={api} {params}',
        respTemplate: '{ts} INFO  [ws-client-4] c.b.ms.WSAppLog : sessionId={sessionId} RESPONSE from Enterprise status=200 {params}',
      },
    ],

    params: [
      { name: 'transactionRef', label: 'TxnRefNo', logKey: 'transactionRef', layers: ['ecomm', 'enterprise'], on: 'both', gen: 'pattern', genArg: 'TX##########', scope: 'flow', regex: '' },
      { name: 'httpStatus', label: 'HTTP', logKey: 'httpStatus', layers: ['ecomm'], on: 'response', gen: 'list', genArg: '200', scope: 'event', regex: '' },
      { name: 'accountNo', label: 'AcctNo', logKey: 'AccountNo', layers: ['host'], on: 'request', gen: 'pattern', genArg: '##########', scope: 'session', regex: '' },
    ],

    scenarios: SS.defaultScenarios(),
  });

  // Fill in anything missing from an imported / older saved config.
  SS.normalizeConfig = function (c) {
    const d = SS.defaultConfig();
    const layers = d.layers.map(dl => ({ ...dl, ...((c.layers || []).find(x => x && x.id === dl.id) || {}), id: dl.id }));
    const fixNode = n => ({
      ...SS.newNode(n.layer in SS.CHILDREN ? n.layer : 'ecomm'), ...n,
      children: Array.isArray(n.children) ? n.children.map(fixNode) : [],
    });
    const fixScenario = (s, i) => ({
      ...SS.newScenario(`Scenario ${i + 1}`, []), ...s,
      calls: Array.isArray(s.calls) ? s.calls.map(fixNode) : [],
    });

    let scenarios;
    if (Array.isArray(c.scenarios)) {
      scenarios = c.scenarios.map(fixScenario);
    } else if (Array.isArray(c.scenario)) {
      // Older configs had one call tree plus settings.sessions: keep it first, then add the built-ins.
      const mine = { ...SS.newScenario('My scenario', c.scenario.map(fixNode)), sessions: Number(c.settings && c.settings.sessions) || 1 };
      const sameAsDefault = JSON.stringify(mine.calls) === JSON.stringify(d.scenarios[0].calls);
      scenarios = sameAsDefault ? d.scenarios : [mine, ...d.scenarios];
    } else {
      scenarios = d.scenarios;
    }

    const settings = { ...d.settings, ...(c.settings || {}) };
    delete settings.sessions;
    return {
      version: SS.CONFIG_VERSION,
      settings,
      layers,
      params: Array.isArray(c.params)
        ? c.params.map(p => ({ ...SS.newParam(), ...p, layers: Array.isArray(p.layers) ? p.layers : [] }))
        : d.params,
      scenarios,
    };
  };

  SS.autoParamRegex = p =>
    String.raw`(?i)\b` + SS.escapeRegex(p.logKey || p.name) + String.raw`"?\s*[:=>]\s*"?(?<value>[^",\s<]+)`;

  SS.paramRegex = p => (p.regex && p.regex.trim()) || SS.autoParamRegex(p);

  SS.paramNameError = function (name, cfg) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name || '')) return 'Field name must start with a letter and use only letters, digits and _';
    if (SS.RESERVED.includes(name) || /^(sid|api|inh|last|pi|hp)_/.test(name)) return `"${name}" is reserved by the query`;
    if (cfg.params.filter(p => p.name === name).length > 1) return `Duplicate field name "${name}"`;
    return null;
  };

  SS.activeParams = cfg => cfg.params.filter(p => !SS.paramNameError(p.name, cfg) && p.layers.length > 0);

  SS.configIssues = function (cfg) {
    const out = [];
    const labels = cfg.layers.map(l => (l.label || '').trim());
    cfg.layers.forEach((l, i) => {
      const n = labels[i] || l.id;
      if (!labels[i]) out.push(`Layer "${l.id}" needs a display name`);
      else if (labels.indexOf(labels[i]) !== i) out.push(`Layer name "${labels[i]}" is used twice`);
      if (!Number.isInteger(Number(l.depth)) || l.depth < 1 || l.depth > 6) out.push(`Layer ${n}: depth must be 1–6`);
      if (!l.classify) out.push(`Layer ${n}: classify regex is empty, so no event can match it`);
      if (l.sessionRegex && !SS.hasValueGroup(l.sessionRegex)) out.push(`Layer ${n}: session regex needs a (?<value>…) group`);
      if (l.apiRegex && !SS.hasValueGroup(l.apiRegex)) out.push(`Layer ${n}: API regex needs a (?<value>…) group`);
    });
    if (SS.sessionPlan && !SS.sessionPlan(cfg).length) out.push('Scenarios: nothing to generate. Enable a scenario that has calls and at least 1 session.');
    if (!SS.hasValueGroup(cfg.settings.genericSessionRegex)) out.push('Settings: generic session regex needs a (?<value>…) group');
    cfg.params.forEach(p => {
      const e = SS.paramNameError(p.name, cfg);
      if (e) out.push(`Parameter "${p.name}": ${e} (ignored)`);
      else if (!p.layers.length) out.push(`Parameter "${p.name}" has no layers selected (ignored)`);
      if (p.regex && p.regex.trim() && !SS.hasValueGroup(p.regex)) out.push(`Parameter "${p.name}": override regex needs a (?<value>…) group`);
    });
    return out;
  };
})(window.SS);
