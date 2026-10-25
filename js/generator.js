(function (SS) {
  'use strict';

  // Unrelated or incomplete lines that the query must ignore.
  const NOISE = [
    { layer: 'ecomm', tpl: '{ts} INFO  [main] c.b.health.LivenessProbe : liveness probe OK' },
    { layer: 'ecomm', tpl: '{ts} INFO  [http-nio-8080-exec-9] c.b.ecomm.MessageLogger : [ECOMM-Message] sessionId {sessionId} heartbeat received' },
    { layer: 'enterprise', tpl: '{ts} DEBUG [enterprise-worker-1] c.b.ent.ConfigLoader : reloaded routing table (42 routes)' },
    { layer: 'ws', tpl: '{ts} WARN  [ws-client-2] c.b.ms.WSAppLog : sessionId={sessionId} connection pool warm-up retry 1/3' },
    { layer: 'host', tpl: '{ts} DEBUG [mq-listener-2] c.b.ms.MQClient : queue depth=3 for EAI.REQ.QUEUE' },
  ];

  const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function genValue(p, ctx) {
    const R = ctx.R;
    switch (p.gen) {
      case 'fixed': return String(p.genArg ?? '');
      case 'list': {
        const l = SS.splitList(p.genArg);
        return l.length ? R.pick(l) : '';
      }
      case 'uuid': return R.uuid();
      case 'number': {
        const m = String(p.genArg ?? '').match(/^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(?::\s*(\d+))?\s*$/);
        if (!m) return '0';
        const a = Number(m[1]), b = Number(m[2]);
        return (a + R.next() * (b - a)).toFixed(m[3] ? Number(m[3]) : 0);
      }
      case 'seq': {
        ctx.seq[p.name] = (ctx.seq[p.name] || 0) + 1;
        return String(p.genArg ?? '') + SS.pad(ctx.seq[p.name], 4);
      }
      default: // pattern
        return String(p.genArg ?? '').replace(/[#@*]/g, c =>
          c === '#' ? String(R.int(0, 9)) : c === '@' ? String.fromCharCode(65 + R.int(0, 25)) : ALNUM[R.int(0, 35)]);
    }
  }

  function render(tpl, map) {
    return String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m)).replace(/[ \t]+$/, '');
  }

  function makeEvent(layer, node, dir, t, ctx, call) {
    const parts = [];
    for (const p of ctx.params) {
      if (!p.layers.includes(layer.id)) continue;
      if (p.on !== 'both' && p.on !== dir.toLowerCase()) continue;
      const store = { session: ctx.session.store, flow: ctx.flow, call }[p.scope];
      let v;
      if (store) {
        if (!(p.name in store)) store[p.name] = genValue(p, ctx);
        v = store[p.name];
      } else {
        v = genValue(p, ctx);
      }
      const key = p.logKey || p.name;
      parts.push(layer.paramStyle === 'xml' ? `<${key}>${v}</${key}>` : `${key}="${v}"`);
    }
    const codes = [node.main, ...SS.splitList(node.subs)].filter(Boolean);
    const map = {
      ts: SS.formatTs(t),
      sessionId: ctx.session.sid,
      api: layer.apiMode === 'svccode' ? (codes[0] || '') : (node.api || ''),
      direction: dir,
      svcCodes: codes.map(c => `<SvcCode>${c}</SvcCode>`).join(''),
      main: node.main || '',
      subs: node.subs || '',
      params: parts.join(layer.paramStyle === 'xml' ? '' : ' '),
    };
    return {
      time: t,
      raw: render(dir === 'Request' ? layer.reqTemplate : layer.respTemplate, map),
      file: layer.mockFile,
      layerId: layer.id,
      layerIdx: layer.idx,
      sessionId: ctx.session.sid,
    };
  }

  // Request at t, children in sequence, own processing time, then the response.
  function emitNode(node, t, ctx) {
    const layer = ctx.layers[node.layer];
    if (!layer) return t;
    const call = {};
    ctx.events.push(makeEvent(layer, node, 'Request', t, ctx, call));
    let cur = t + ctx.R.int(1, 6);
    for (const child of node.children || []) cur = emitNode(child, cur, ctx) + ctx.R.int(1, 6);
    const [a, b] = SS.parseRange(node.ms, [10, 50]);
    cur += ctx.R.int(a, b);
    if (!node.noResponse) ctx.events.push(makeEvent(layer, node, 'Response', cur, ctx, call));
    return cur;
  }

  SS.generate = function (cfg) {
    const s = cfg.settings;
    const R = SS.makeRandom(Number(s.seed) || 1);
    const layers = {};
    cfg.layers.forEach((l, i) => { layers[l.id] = { ...l, idx: i }; });
    const params = SS.activeParams(cfg);
    const events = [];
    const seq = {};
    const sessions = Math.min(200, Math.max(1, Math.floor(Number(s.sessions) || 1)));
    const gap = Math.max(0, Number(s.sessionGapMs) || 0);
    let start = SS.parseTs(s.startTime);
    if (isNaN(start)) start = SS.parseTs(SS.defaultConfig().settings.startTime);

    const sids = [];
    for (let i = 0; i < sessions; i++) {
      const ctx = { R, layers, params, events, seq, flow: {}, session: { sid: R.uuid(), store: {} } };
      sids.push(ctx.session.sid);
      let t = start + i * gap + R.int(0, 40);
      for (const root of cfg.scenario) {
        ctx.flow = {};
        t = emitNode(root, t, ctx) + R.int(30, 150);
      }
    }

    const noise = NOISE.filter(n => layers[n.layer]);
    const count = Math.min(500, Math.max(0, Math.floor(Number(s.noiseLines) || 0)));
    if (events.length && noise.length) {
      const lo = Math.min(...events.map(e => e.time));
      const hi = Math.max(...events.map(e => e.time));
      for (let i = 0; i < count; i++) {
        const n = noise[i % noise.length];
        const t = R.int(lo, hi);
        events.push({
          time: t,
          raw: render(n.tpl, { ts: SS.formatTs(t), sessionId: R.pick(sids) }),
          file: layers[n.layer].mockFile,
          layerId: null,
          layerIdx: -1,
          sessionId: null,
        });
      }
    }

    return events.map((e, i) => ({ ...e, seq: i })).sort((a, b) => a.time - b.time || a.seq - b.seq);
  };

  SS.parsePasted = function (text, cfg) {
    let re = null;
    try { re = SS.toJsRegex(cfg.settings.timeRegex); } catch (e) { re = null; }
    const out = [];
    let last = null;
    for (const line of String(text ?? '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let t = NaN;
      if (re) {
        const m = re.exec(line);
        const v = m && m.groups && m.groups.value;
        if (v) t = SS.parseTs(v);
      }
      if (isNaN(t)) t = last !== null ? last + 1 : Date.now();
      last = t;
      out.push({ time: t, raw: line });
    }
    return out;
  };
})(window.SS);
