'use strict';
// Phase 7: processing rule analysis across sessions, called by traceline-feedback.js after alignment.
// Everything is counted from the export rows and their matched raw log lines. Each rule states how
// many sessions support it; interpreting the rules (what a code means, what decides a route) is left
// to the reader. Writes rules.md, decision-flow.puml and summary.md.
const fs = require('fs');
const path = require('path');

const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const esc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head, rows) => (rows.length
  ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.map(esc).join(' | ')} |`)].join('\n')
  : '_None observed._');
const confidence = n => (n >= 3 ? 'high' : n === 2 ? 'medium' : 'low (single sample)');
const leaves = (o, p = '', out = new Map()) => {
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) leaves(v, p ? `${p}.${k}` : k, out);
  else if (o != null && p) out.set(p, String(o));
  return out;
};
const add = (map, k, init) => (map.has(k) ? map.get(k) : map.set(k, init()).get(k));

module.exports = function analyseRules({ cfg, sessions, sessionCalls, logUsable, downstreamOf, shortSid, fmt, OUT }) {
  const et = r => (r.t ? fmt(r.t.ms) : r.EventTime); // readable EventTime, also when Excel stored it as a date number
  const sids = [...sessions.keys()].sort();
  if (sids.length < 2) {
    fs.writeFileSync(path.join(OUT, 'rules.md'), '# Processing rules\n\nSkipped: only one session in the export. Rules are not derived from a single session unless explicitly requested.\n');
    return;
  }

  // ---------- call tree per session ----------
  const nodes = [], bySession = new Map();
  for (const sid of sids) {
    const { pairs } = sessionCalls.get(sid);
    const ns = sessions.get(sid).filter(r => r.direction === 'Request' && r.layer).map(r => ({ sid, r, resp: pairs.get(r) || null, children: [] }));
    const byRow = new Map(ns.map(n => [n.r, n]));
    for (const n of ns) { n.parent = byRow.get(n.r.parent) || null; if (n.parent) n.parent.children.push(n); }
    bySession.set(sid, ns);
    nodes.push(...ns);
  }
  const ds = n => (n.r.layer === 'WS' ? downstreamOf(n.r.api) : null);
  const svc = n => n.r.HostServices || n.r.api;
  const label = n => (n.r.layer === 'Host' ? `EAI ${svc(n)}` : n.r.layer === 'WS' ? `${ds(n) || 'WS'} ${n.r.api}` : `${n.r.layer} ${n.r.api}`);
  const key = n => (n.r.layer === 'WS' && ds(n) ? `${ds(n)} ${n.r.api}` : `${n.r.layer} ${n.r.api}`);
  const desc = n => n.children.flatMap(c => [c, ...desc(c)]);
  const status = n => (n.resp ? n.resp.HopStatus || 'UNKNOWN' : 'NO RESPONSE');
  const tStart = n => n.r.t?.ms;
  const tEnd = n => n.resp?.t?.ms;
  const elapsed = n => (n.resp && n.resp.ElapsedMs !== '' && !Number.isNaN(+n.resp.ElapsedMs) ? +n.resp.ElapsedMs
    : tEnd(n) != null && tStart(n) != null ? tEnd(n) - tStart(n) : null);
  const isSuccessCode = c => [...cfg.successCodes, ...cfg.httpSuccess, ...cfg.hostSuccess].includes(String(c).trim().toUpperCase());

  function action(n) {
    if (n.r.layer === 'eComm') {
      const k = n.children.filter(c => c.r.layer === 'Enterprise');
      return !k.length ? 'internal process' : k.length === 1 ? `call 1 Enterprise API: ${k[0].r.api}` : `call ${k.length} Enterprise APIs: ${k.map(c => c.r.api).join(' → ')}`;
    }
    const parts = desc(n).map(c => (c.r.layer === 'Host' ? `call EAI ${svc(c)}` : c.r.layer === 'WS' ? (ds(c) ? `call downstream ${ds(c)} ${c.r.api}` : `via WS ${c.r.api}`) : `call ${label(c)}`));
    return parts.length ? parts.join('; ') : 'internal process';
  }

  // ---------- coverage ----------
  const spans = sids.map(sid => { const t = sessions.get(sid).map(r => r.t?.ms).filter(x => x != null); return { sid, from: Math.min(...t), to: Math.max(...t) }; });
  const SCENARIOS = [
    ['A', 'eComm internal processing only', ns => ns.some(n => n.r.layer === 'eComm' && !n.children.length && n.resp)],
    ['B', 'eComm → one Enterprise API, Enterprise internal', ns => ns.some(n => n.r.layer === 'eComm' && n.children.filter(c => c.r.layer === 'Enterprise').length === 1 && n.children.every(c => !c.children.length))],
    ['C', 'eComm → several Enterprise APIs', ns => ns.some(n => n.r.layer === 'eComm' && n.children.filter(c => c.r.layer === 'Enterprise').length >= 2)],
    ['D', 'EAI service with one sub-service', ns => ns.some(n => n.r.layer === 'Host' && !String(svc(n)).includes('|'))],
    ['E', 'EAI service with several sub-services', ns => ns.some(n => n.r.layer === 'Host' && String(svc(n)).includes('|'))],
    ['F', 'EAI plus direct downstream (OPI, WAM, CUS…)', ns => ns.some(n => ds(n)) && ns.some(n => n.r.layer === 'Host')],
    ['G1', 'Timeout or missing response', ns => ns.some(n => status(n) === 'NO RESPONSE')],
    ['G2', 'EAI returns an error', ns => ns.some(n => n.r.layer === 'Host' && status(n) === 'FAILED')],
    ['G3', 'Enterprise HTTP 200 with business error', ns => ns.some(n => n.r.layer === 'Enterprise' && status(n) === 'FAILED' && n.resp.log && cfg.httpSuccess.includes(String(n.resp.log.httpStatus)))],
    ['G4', 'eComm non-success code with description', ns => ns.some(n => n.r.layer === 'eComm' && status(n) === 'FAILED' && n.resp.ErrDesc)],
    ['H', 'Sessions interleaved in time', (ns, sid) => { const s = spans.find(x => x.sid === sid); return spans.some(o => o.sid !== sid && o.from < s.to && s.from < o.to); }],
    ['I', 'One Enterprise call succeeds, another fails', ns => ns.some(n => { const st = n.children.filter(c => c.r.layer === 'Enterprise').map(status); return st.includes('SUCCESS') && st.includes('FAILED'); })],
  ];
  const coverage = SCENARIOS.map(([id, name, test]) => ({ id, name, sids: sids.filter(sid => test(bySession.get(sid), sid)) }));
  const apiCombos = new Set(nodes.map(key));
  const svcCombos = new Set(nodes.filter(n => n.r.layer === 'Host').map(svc));

  // ---------- 1. routing ----------
  const groups = new Map();
  for (const n of nodes) if (['eComm', 'Enterprise'].includes(n.r.layer)) add(groups, key(n), () => ({ layer: n.r.layer, api: n.r.api, inst: [] })).inst.push({ n, action: action(n) });
  const ID_PATHS = new Set([cfg.json.session, cfg.json.txnRef, '_mock']);
  function condition(inst, act) {
    const withJson = inst.filter(i => i.n.r.log && i.n.r.log.json);
    const mine = withJson.filter(i => i.action === act), rest = withJson.filter(i => i.action !== act);
    if (!mine.length || !rest.length) return null;
    const L = new Map(withJson.map(i => [i, leaves(i.n.r.log.json)]));
    const found = [];
    for (const [p, v] of L.get(mine[0])) {
      if (ID_PATHS.has(p)) continue;
      const vals = withJson.map(i => L.get(i).get(p)).filter(x => x != null);
      if (vals.length > 2 && new Set(vals).size === vals.length) continue; // different in every call: an ID, not a condition
      if (mine.every(i => L.get(i).get(p) === v) && rest.every(i => L.get(i).get(p) !== v)) found.push(`${p} = ${v}`);
    }
    return found.length ? found.slice(0, 3).join(' AND ') : null;
  }
  const routing = [], buckets = { confirmed: [], single: [], inferred: [], contradicted: [] };
  const order = { eComm: 1, Enterprise: 2 };
  for (const [k, g] of [...groups].sort((a, b) => order[a[1].layer] - order[b[1].layer] || a[0].localeCompare(b[0]))) {
    const acts = new Map();
    for (const i of g.inst) add(acts, i.action, () => new Set()).add(i.n.sid);
    g.acts = acts;
    for (const [act, s] of acts) {
      const cond = acts.size === 1 ? 'always (every observed call)' : condition(g.inst, act);
      const condText = cond ?? 'unknown: no request field separates the variants';
      routing.push([k, condText, act, s.size, confidence(s.size)]);
      const rule = `${k}: ${acts.size > 1 ? `when ${condText}, ` : ''}${act} (${s.size} session${s.size === 1 ? '' : 's'})`;
      if (acts.size > 1 && !cond) buckets.contradicted.push(`${rule}. Same caller, different actions, and no request field explains it.`);
      else if (s.size >= 2) buckets.confirmed.push(rule);
      else buckets.single.push(rule);
      if (act === 'internal process') buckets.inferred.push(`${k}: "internal process" means no downstream call was logged; the processing itself is not visible.`);
    }
  }

  // ---------- 2. EAI and downstream mapping ----------
  const eai = new Map();
  for (const n of nodes.filter(x => x.r.layer === 'Enterprise')) {
    for (const c of desc(n)) {
      if (c.r.layer !== 'Host' && !ds(c)) continue;
      const host = c.r.layer === 'Host';
      const e = add(eai, `${n.r.api}|${host ? svc(c) : ''}|${host ? '' : `${ds(c)} ${c.r.api}`}`, () => ({ ent: n.r.api, host, svc: host ? svc(c) : '—', sys: host ? cfg.svcSystems[c.r.api] || null : `${ds(c)} (${c.r.api})`, dir: new Set(), sids: new Set() }));
      e.dir.add(c.resp ? 'request + response' : 'request only');
      e.sids.add(n.sid);
    }
  }
  const eaiRows = [...eai.values()].map(e => [e.ent, e.svc, e.sys || 'not logged', [...e.dir].join(' / '), `${e.sids.size} session(s)`,
    e.host ? (e.sys ? '' : '⚑ SvcCode with no downstream log (system behind EAI not logged or not mapped)') : '⚑ downstream log with no SvcCode (direct call, not via EAI)']);

  // ---------- 3. sequence and dependency ----------
  const seq = new Map();
  for (const n of nodes) {
    const parentKey = key(n);
    const s = add(seq, parentKey, () => ({ calls: 0, kids: new Map(), sequential: 0, overlapping: 0, undetermined: 0, example: null }));
    s.calls++;
    for (const l of new Set(n.children.map(label))) s.kids.set(l, (s.kids.get(l) || 0) + 1);
    for (let i = 1; i < n.children.length; i++) {
      const a = n.children[i - 1], b = n.children[i];
      const rel = tEnd(a) == null ? 'undetermined' : tStart(b) >= tEnd(a) ? 'sequential' : 'overlapping';
      s[rel]++;
      if (!s.example || rel === 'overlapping') {
        s.example = `${label(a)}: request ${et(a.r)}, response ${a.resp ? et(a.resp) : 'none'}${elapsed(a) != null ? ` (ElapsedMs ${elapsed(a)})` : ''}; next ${label(b)} request ${et(b.r)}`
          + (tEnd(a) != null ? ` → gap ${tStart(b) - tEnd(a)} ms` : '');
      }
    }
  }
  const seqRows = [];
  for (const [k, s] of seq) {
    const conditional = [...s.kids].filter(([, c]) => c < s.calls).map(([l, c]) => `${l} in ${c} of ${s.calls}`);
    if (!s.sequential && !s.overlapping && !s.undetermined && !conditional.length) continue;
    const verdict = s.overlapping ? 'overlapping' : s.sequential ? 'sequential' : s.undetermined ? 'undetermined' : 'one call each time';
    seqRows.push([k, s.calls, verdict, `${s.sequential} / ${s.overlapping} / ${s.undetermined}`, conditional.join('; ') || '—', s.example || '—']);
  }

  // ---------- 4. failure handling ----------
  const badCode = n => String(n.resp.RespCode || '').split(',').map(c => c.trim()).find(c => c && !isSuccessCode(c));
  const badHttp = n => { const h = n.resp && n.resp.log && n.resp.log.httpStatus; return h && !cfg.httpSuccess.includes(String(h)) ? `HTTP ${h}` : null; };
  const codeOf = n => (status(n) === 'NO RESPONSE' ? 'no response' : n.resp.ErrCode || badCode(n) || badHttp(n) || n.resp.HopStatus);
  const signal = n => {
    if (status(n) === 'NO RESPONSE') {
      const p = n.parent && n.parent.resp && n.parent.resp.log;
      const timeout = p && cfg.failPattern ? (p.raw.match(new RegExp(`(?:\\S+\\s){0,2}(?:${cfg.failPattern})(?:\\s\\S+){0,3}`, 'i')) || [])[0] : null;
      return `no response logged${timeout ? `; caller reported "${timeout.trim()}"` : ''}`;
    }
    const r = n.resp, l = r.log;
    return [r.ErrCode && `ErrCode ${r.ErrCode}`, r.RespCode && `RespCode ${r.RespCode}`, r.ErrDesc && `"${r.ErrDesc}"`,
      l && l.httpStatus && `HTTP ${l.httpStatus}`].filter(Boolean).join(', ') || r.HopStatus;
  };
  // child = the nearest failed hop below the caller (hops that reported SUCCESS in between are skipped).
  const classify = (child, parent) => {
    const ps = status(parent);
    if (ps === 'SUCCESS') return parent.parent ? 'reported SUCCESS despite the failure below' : 'absorbed: the caller still succeeded';
    if (ps === 'NO RESPONSE') return 'caller did not respond either';
    const cc = codeOf(child), pc = codeOf(parent), digits = s => String(s).replace(/\D/g, '');
    if (cc === 'no response') return `timeout surfaced as ${pc}`;
    if (pc === cc) return 'same code passed up';
    if (/^5\d\d$/.test(pc) || ['FAILED', 'UNKNOWN'].includes(pc)) return `generic ${pc}`;
    if (digits(cc) && digits(cc) === digits(pc)) return `wrapped: same number, new prefix (${cc} → ${pc})`;
    return `different code (${cc} → ${pc})`;
  };
  const failRows = [], chains = [], retries = [];
  for (const sid of sids) {
    const ns = bySession.get(sid);
    const bad = ns.filter(n => status(n) !== 'SUCCESS').map(n => ({ n, t: status(n) === 'NO RESPONSE' ? tStart(n) : tEnd(n) }))
      .sort((a, b) => a.t - b.t || ({ Host: 4, WS: 3, Enterprise: 2, eComm: 1 }[b.n.r.layer] - { Host: 4, WS: 3, Enterprise: 2, eComm: 1 }[a.n.r.layer]));
    for (const n of ns) {
      const seen = new Map();
      for (const c of n.children) {
        if (seen.has(key(c)) && status(seen.get(key(c))) !== 'SUCCESS') retries.push(`Session \`${shortSid(sid)}\`: ${label(c)} called again (step ${c.r.Step}) after ${status(seen.get(key(c)))} at step ${seen.get(key(c)).r.Step}`);
        seen.set(key(c), c);
      }
    }
    // A silent hop is not the failure point if something it called was silent too: the deepest silent hop is.
    const silentBelow = n => desc(n).some(d => status(d) === 'NO RESPONSE');
    const points = bad.filter(b => !(status(b.n) === 'NO RESPONSE' && silentBelow(b.n)));
    if (!points.length) continue;
    const fp = points[0].n, ft = points[0].t;
    const siblings = fp.parent ? fp.parent.children : ns.filter(n => !n.parent);
    const later = siblings.filter(s => s !== fp && tStart(s) > ft);
    const retry = later.find(s => key(s) === key(fp)), fallback = later.find(s => key(s) !== key(fp));
    const root = ns.find(n => !n.parent && n.r.layer === 'eComm') || ns[0];
    const final = root.resp ? `${root.resp.RespCode || ''} ${status(root)}${root.resp.ErrDesc ? ` "${root.resp.ErrDesc}"` : ''}`.trim() : 'no response';
    failRows.push([shortSid(sid), `${label(fp)} (step ${fp.r.Step})`, signal(fp), retry ? `yes: step ${retry.r.Step}` : 'no', fallback ? `next call: ${label(fallback)} (step ${fallback.r.Step})` : 'no', final]);
    const parts = [];
    let lastFail = null;
    for (let x = fp; x; x = x.parent) {
      parts.push(`${label(x)}: **${codeOf(x)}**${lastFail ? ` _(${classify(lastFail, x)})_` : ''}`);
      if (status(x) !== 'SUCCESS') lastFail = x;
    }
    chains.push({ sid, text: parts.join(' → ') });
  }

  // ---------- 5. data propagation ----------
  const sidLayers = new Map();
  for (const e of logUsable) {
    const s = add(sidLayers, e.layer, () => ({ direct: 0, link: 0, none: 0 }));
    if (e.linkedBy === 'sessionId') s.direct++; else if (e.linkedBy === 'LinkKey') s.link++; else s.none++;
  }
  const refEdges = new Map();
  for (const n of nodes) for (const c of n.children) {
    const edge = `${n.r.layer} → ${ds(c) || c.r.layer}`;
    const pl = n.r.log, cl = c.r.log;
    const pr = pl && (pl.txnRef ?? pl.hostRef), cr = cl && (cl.txnRef ?? cl.hostRef);
    const rel = !pl || !cl ? 'not checked: no raw log line' : cr == null ? 'missing in callee' : pr == null ? 'missing in caller'
      : cr === pr ? (cl.txnRef ? 'same value' : `same value, renamed to the Host link tag (${cfg.hostLinkRegex.replace(/\(.*\)/, '…')})`) : 'new value generated';
    add(add(refEdges, edge, () => new Map()), rel, () => new Set()).add(n.sid);
  }
  const fieldProp = new Map();
  for (const n of nodes.filter(x => x.r.layer === 'eComm' && x.r.log && x.r.log.json)) {
    for (const [p, v] of leaves(n.r.log.json)) {
      if (ID_PATHS.has(p) || p === cfg.json.endpoint || v.length < 3) continue;
      for (const c of desc(n)) {
        if (!c.r.log) continue;
        const hit = [...leaves(c.r.log.json || {})].find(([, cv]) => cv === v);
        const how = hit ? (hit[0] === p ? 'same name' : `renamed to ${hit[0]}`) : c.r.log.raw.includes(v) ? 'carried in text' : 'not passed on';
        add(add(fieldProp, `${p}|${ds(c) || c.r.layer}`, () => new Map()), how, () => new Set()).add(n.sid);
      }
    }
  }

  // ---------- 6. latency ----------
  const lat = new Map();
  for (const n of nodes) { const e = elapsed(n); if (e != null) add(lat, key(n), () => []).push({ e, n }); }
  const latRows = [], outliers = [];
  for (const [k, list] of [...lat].sort()) {
    const v = list.map(x => x.e), m = median(v);
    const out = list.length >= 3 ? list.filter(x => x.e > 3 * m && x.e - m > 100) : [];
    for (const o of out) outliers.push(`${k} in session \`${shortSid(o.n.sid)}\`: ${o.e} ms vs median ${m} ms. ${status(o.n) !== 'SUCCESS' ? `**Correlates with a failure** (${status(o.n)}).` : 'No failure on this hop.'}`);
    latRows.push([k, list.length, Math.min(...v), m, Math.max(...v), list.length < 3 ? 'n < 3: no outlier test' : out.length ? `${out.length} outlier(s)` : 'none']);
  }

  // ---------- 7. success and failure patterns ----------
  const rate = new Map();
  for (const n of nodes) {
    const r = add(rate, key(n), () => ({ resp: 0, failed: 0, noResp: 0, unknown: 0 }));
    if (!n.resp) r.noResp++; else { r.resp++; if (status(n) === 'FAILED') r.failed++; if (status(n) === 'UNKNOWN') r.unknown++; }
  }
  const rateRows = [...rate].sort().map(([k, r]) => [k, r.resp, r.failed, r.resp ? `${Math.round((100 * r.failed) / r.resp)}%` : '—', r.noResp, r.unknown]);
  const codes = new Map();
  const LORDER = { eComm: 1, Enterprise: 2, WS: 3, Host: 4 };
  for (const n of nodes.filter(x => x.resp)) {
    const vals = [...(n.resp.ErrCode ? [['ErrCode', n.resp.ErrCode]] : []), ...String(n.resp.RespCode || '').split(',').filter(c => c && !isSuccessCode(c)).map(c => ['RespCode', c.trim()]),
      ...(badHttp(n) ? [['HTTP status (log)', badHttp(n).slice(5)]] : [])];
    for (const [kind, c] of vals) {
      const e = add(codes, `${kind}|${c}`, () => ({ kind, code: c, layers: new Set(), deepest: 0, n: 0, descs: new Map(), labels: new Set() }));
      e.layers.add(n.r.layer); e.deepest = Math.max(e.deepest, LORDER[n.r.layer]); e.n++;
      if (n.resp.ErrDesc) e.descs.set(n.resp.ErrDesc, (e.descs.get(n.resp.ErrDesc) || 0) + 1);
      e.labels.add(`${label(n)}\\n${c}${n.resp.ErrDesc ? ` ${n.resp.ErrDesc}` : ''}`);
    }
  }
  const codeRows = [...codes.values()].sort((a, b) => b.deepest - a.deepest || a.code.localeCompare(b.code)).map(e => {
    const top = [...e.descs].sort((a, b) => b[1] - a[1])[0];
    const HTTP = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 408: 'Request Timeout', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };
    const meaning = top ? `"${top[0]}" (from ErrDesc)` : /^\d{3}$/.test(e.code) && HTTP[e.code] && e.kind !== 'ErrCode' ? `${HTTP[e.code]} (standard HTTP meaning, if this is an HTTP status)` : 'not inferable: no description';
    return [e.code, e.kind, [...e.layers].join(', '), Object.keys(LORDER).find(l => LORDER[l] === e.deepest), e.n, meaning];
  });
  const labelRows = [...codes.values()].flatMap(e => [...e.labels].map(l => [e.code, `\`${l}\``]));

  // ---------- 8. confidence and gaps ----------
  buckets.inferred.push(
    'WS is drawn as Enterprise calling its own web service (Phase 0 Q8 not yet confirmed).',
    'Systems behind EAI (BWC, ICH, …) are not visible in the logs; SvcCode → system mapping comes from config, if given.',
    'Downstream system names come from WS URL prefixes in the config.');
  const fieldsSeen = [...fieldProp.keys()].length;
  for (const [edge, rels] of refEdges) {
    const counted = [...rels].filter(([rel]) => !rel.startsWith('not checked'));
    if (counted.length > 1) buckets.contradicted.push(`transactionRef on ${edge}: ${counted.map(([rel, s]) => `${rel} in ${s.size}`).join(', ')}`);
    else if (counted.length === 1) (counted[0][1].size >= 2 ? buckets.confirmed : buckets.single).push(`transactionRef on ${edge}: ${counted[0][0]} (${counted[0][1].size} session(s))`);
  }
  const gaps = [];
  for (const c of coverage.filter(x => !x.sids.length)) gaps.push(`Scenario ${c.id} (${c.name}) not observed: include at least two sessions showing it.`);
  for (const r of routing.filter(x => x[3] === 1)) gaps.push(`${r[0]} → ${r[2]}: seen once; one more session would confirm it.`);
  for (const r of buckets.contradicted.filter(x => x.includes('no request field'))) gaps.push(`${r.split(':')[0]}: the request fields logged don't explain the different routes. Add the deciding field (product, channel, customer segment…) to the log or the export.`);
  if (eaiRows.some(r => r[2] === 'not logged')) gaps.push('SvcCode → backend system (BWC, ICH, …): give the mapping in the config (`svcSystems`), or include the backend logs.');
  if (latRows.some(r => r[1] < 3)) gaps.push(`Latency baselines with fewer than 3 samples (${latRows.filter(r => r[1] < 3).length} endpoint(s)): more sessions per endpoint are needed before calling anything an outlier.`);
  if (!fieldsSeen) gaps.push('No eComm request JSON was matched, so field propagation could not be checked: include the raw request lines.');

  const narrow = sids.length < 5 || !routing.some(r => r[3] >= 2);
  const dates = spans.flatMap(s => [s.from, s.to]).filter(Number.isFinite);
  const day = ms => new Date(ms).toISOString().slice(0, 10);

  // ---------- rules.md ----------
  const md = [];
  md.push('# Processing rules', '');
  if (narrow) md.push('> **Hypotheses only.** Coverage is too narrow for rule conclusions (fewer than 5 sessions, or no behaviour seen in more than one session). Every "rule" below is a hypothesis to test.', '');
  md.push('## Coverage', '');
  md.push(`- **Sessions:** ${sids.length}, from ${day(Math.min(...dates))} to ${day(Math.max(...dates))}.`);
  md.push(`- **Distinct layer + API combinations:** ${apiCombos.size}. **Distinct EAI SvcCode combinations:** ${svcCombos.size}${svcCombos.size ? ` (${[...svcCombos].join('; ')})` : ''}.`, '');
  md.push(table(['Phase 5 scenario', 'Covered by', 'Sessions'], coverage.map(c => [`${c.id}: ${c.name}`, c.sids.map(shortSid).join(', ') || '**missing**', c.sids.length])), '');

  md.push('## 1. Routing rules', '', 'Condition comes from the caller\'s request JSON: a field whose value is the same in every call that took this route and different in all the others. Fields that differ in every call (IDs) are ignored.', '');
  md.push(table(['Caller', 'Condition', 'Observed action', 'Evidence sessions', 'Confidence'], routing), '');
  md.push('## 2. EAI and downstream mapping', '');
  md.push(table(['Enterprise endpoint', 'EAI SvcCode', 'Downstream system', 'Direction', 'Evidence', 'Flag'], eaiRows), '');
  md.push('## 3. Sequence and dependency', '', 'A pair of calls is **sequential** when the next request is logged at or after the previous response, and **overlapping** only when it is logged before that response. Calls that merely sit close together in time are not counted as parallel. **Undetermined** means the previous call has no response to compare with. A child that appears in only some calls of the same caller is **conditional**.', '');
  md.push(table(['Caller', 'Calls', 'Verdict', 'Pairs seq / overlap / undetermined', 'Conditional children', 'Example (EventTime, ElapsedMs)'], seqRows), '');
  md.push('## 4. Failure handling', '', 'Failure point = the earliest hop that failed or never got a response (a missing response is placed at its request time, so a timeout shows up at the hop that went silent).', '');
  md.push(table(['Session', 'Failure point', 'Error signal', 'Retry observed', 'Fallback observed', 'Final caller response'], failRows), '');
  md.push('## 5. Data propagation', '', '**sessionId in the raw log, by layer:**', '');
  md.push(table(['Layer', 'Carries sessionId', 'Linked through LinkKey', 'Not linked'], [...sidLayers].map(([l, s]) => [l, s.direct, s.link, s.none])), '');
  md.push('**transactionRef from caller to callee:**', '');
  md.push(table(['Edge', 'Observed', 'Sessions'], [...refEdges].flatMap(([edge, rels]) => [...rels].map(([rel, s]) => [edge, rel, s.size]))), '');
  md.push('**eComm request fields, followed down the call tree:**', '');
  md.push(table(['Field', 'Into layer', 'Observed', 'Sessions'], [...fieldProp].flatMap(([k, hows]) => [...hows].map(([how, s]) => [k.split('|')[0], k.split('|')[1], how, s.size]))), '');
  md.push('## 6. Latency baseline (ElapsedMs)', '');
  md.push(table(['Endpoint', 'n', 'Min', 'Median', 'Max', 'Outliers'], latRows), '');
  md.push(outliers.length ? outliers.map(o => `- ${o}`).join('\n') : '_No outliers (rule: more than 3 × the median and over 100 ms above it, with at least 3 samples)._', '');
  md.push('## 7. Success and failure patterns', '', '**Failure rate** = FAILED responses ÷ all responses. Requests that never got a response are counted separately.', '');
  md.push(table(['Endpoint', 'Responses', 'FAILED', 'Failure rate', 'No response', 'UNKNOWN'], rateRows), '');
  md.push('**Error code taxonomy** (deepest layer first, which is usually where the code originates):', '');
  md.push(table(['Code', 'Field', 'Layers', 'Deepest layer', 'Count', 'Meaning'], codeRows), '');
  md.push('**Failure propagation** (from the failure point up to the app):', '');
  md.push(chains.length ? chains.map(c => `- \`${shortSid(c.sid)}\`: ${c.text}`).join('\n') : '_No failed sessions._', '');
  md.push('**Retries:**', '', retries.length ? retries.map(r => `- ${r}`).join('\n') : '_No endpoint was called again after a failure in the same caller._', '');
  md.push('**PlantUML labels for each error** (use in the sequence diagram notes):', '');
  md.push(table(['Code', 'Label'], labelRows), '');
  md.push('## 8. Rule confidence and gaps', '');
  for (const [k, title] of [['confirmed', 'Confirmed by several sessions'], ['single', 'Single-sample observations'], ['inferred', 'Inferred but unverified'], ['contradicted', 'Contradicted or unexplained']]) {
    md.push(`**${title}:**`, '', buckets[k].length ? [...new Set(buckets[k])].map(b => `- ${b}`).join('\n') : '_None._', '');
  }
  md.push('**What would close the gaps:**', '', gaps.length ? [...new Set(gaps)].map(g => `- ${g}`).join('\n') : '_None._', '');
  fs.writeFileSync(path.join(OUT, 'rules.md'), md.join('\n'));

  // ---------- decision-flow.puml ----------
  const clean = s => String(s).replace(/;/g, ',').replace(/[()]/g, m => (m === '(' ? '[' : ']')).replace(/\s\|\s/g, ', ');
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  // Failure note for a set of calls: all calls of an Enterprise API, or the eComm calls of one variant.
  const failNote = (calls, scope) => {
    const failed = calls.filter(n => status(n) === 'FAILED').length, silent = calls.filter(n => status(n) === 'NO RESPONSE').length;
    if (!failed && !silent) return [];
    const cs = [...new Set(calls.filter(n => status(n) !== 'SUCCESS').map(codeOf))].join(', ');
    return ['note right', `  observed in ${scope}: ${failed} FAILED, ${silent} no response, of ${plural(calls.length, 'call')}`, `  codes: ${clean(cs)}`, 'end note'];
  };
  const P = ['@startuml', `title Observed decision flow · ${sids.length} sessions${narrow ? '\\nHYPOTHESES: coverage too narrow for rule conclusions' : ''}`, 'start', 'switch ( App calls eComm API )'];
  for (const [k, g] of [...groups].filter(([, x]) => x.layer === 'eComm')) {
    P.push(`case ( ${clean(g.api)} )`);
    const variants = [...g.acts];
    variants.forEach(([act, s], i) => {
      if (variants.length > 1) {
        const cond = condition(g.inst, act);
        P.push(`${i ? 'elseif' : 'if'} (${cond ? `${clean(cond)}?` : `variant ${i + 1}?`}) then (${cond ? 'observed field' : 'inferred: condition unknown'} · ${s.size} session${s.size === 1 ? '' : 's'})`);
      }
      const inst = g.inst.find(x => x.action === act).n;
      const kids = inst.children.filter(c => c.r.layer === 'Enterprise');
      if (!kids.length) P.push(`#lightgrey:eComm processes internally\\n<i>inferred: no Enterprise call logged · ${plural(s.size, 'session')}</i>;`);
      for (const c of kids) {
        const eg = groups.get(key(c));
        const eActs = [...eg.acts.keys()];
        const what = eActs.length === 1 ? eActs[0] : 'varies by call: see the routing table';
        const inferred = what === 'internal process';
        P.push(`${inferred ? '#lightgrey' : '#palegreen'}:Enterprise ${clean(c.r.api)}\\n${clean(what).replace(/, /g, '\\n')}\\n<i>${inferred ? 'inferred: no downstream call logged' : 'observed'} · ${plural(new Set(eg.inst.map(x => x.n.sid)).size, 'session')}</i>;`,
          ...failNote(eg.inst.map(x => x.n), 'all calls of this API'));
      }
      const mine = g.inst.filter(x => x.action === act).map(x => x.n);
      P.push(`#palegreen:eComm responds to App\\n<i>observed · success ${mine.filter(n => status(n) === 'SUCCESS').length} of ${mine.length}</i>;`, ...failNote(mine, 'this variant'));
    });
    if (variants.length > 1) P.push('endif');
  }
  P.push('endswitch', 'stop', 'legend right', '  green = observed in the export and raw log', '  grey = inferred, not directly logged', '  notes = observed failures', 'endlegend', '@enduml');
  fs.writeFileSync(path.join(OUT, 'decision-flow.puml'), P.join('\n') + '\n');

  // ---------- summary.md ----------
  const plain = a => a.replace(/^call 1 Enterprise API: (.*)$/, 'calls the Enterprise API $1')
    .replace(/^call (\d+) Enterprise APIs: (.*)$/, 'calls $1 Enterprise APIs in turn ($2)')
    .replace(/^internal process$/, 'handles it itself, with no further calls')
    .replace(/via WS ([^;]+)/g, 'goes through its web service $1').replace(/call EAI ([^;]+)/g, 'calls host service $1')
    .replace(/call downstream (\w+) ([^;]+)/g, 'calls $1 ($2)').replace(/; /g, ', then ');
  const S = ['# Processing rules: summary', ''];
  S.push(`**Based on** ${sids.length} sessions (${day(Math.min(...dates))} to ${day(Math.max(...dates))}). ${narrow ? '**These are first hypotheses, not confirmed rules:** too few sessions show each behaviour more than once.' : 'Rules marked "seen once" still need confirming.'}`, '');
  S.push('## How each request is handled', '');
  for (const [k, g] of groups) {
    const parts = [...g.acts].map(([act, s]) => `${plain(act)} (seen in ${s.size} session${s.size === 1 ? '' : 's'})`);
    S.push(`- **${g.api}** (${g.layer}) ${parts.length === 1 ? parts[0] : `varies: ${parts.join('; or ')}. What decides this is ${routing.some(r => r[0] === k && !r[1].startsWith('unknown')) ? 'shown in the routing table' : 'not yet known'}`}.`);
  }
  S.push('', '## Where it fails', '');
  const failing = rateRows.filter(r => r[2] || r[4]).sort((a, b) => b[2] + b[4] - (a[2] + a[4]));
  S.push(failing.length ? failing.slice(0, 6).map(r => `- **${r[0]}** failed ${r[2]} of ${plural(r[1], 'response')}${r[4] ? `, and gave no response ${r[4] === 1 ? 'once' : `${r[4]} times`}` : ''}.`).join('\n') : '- No failures observed.');
  if (chains.length) S.push('', 'How errors travel back to the app:', '', ...chains.slice(0, 5).map(c => `- ${c.text.replace(/\*\*/g, '').replace(/_/g, '')}`));
  S.push('', '## How long it takes', '');
  S.push(...latRows.filter(r => r[0].startsWith('eComm')).map(r => `- **${r[0].replace('eComm ', '')}:** ${r[1] === 1 ? `${r[3]} ms (one call)` : `typically ${r[3]} ms (range ${r[2]}–${r[4]} ms, ${r[1]} calls)`}.`));
  if (outliers.length) S.push(`- Unusually slow: ${plural(outliers.length, 'hop')}; see the latency section of rules.md.`);
  const seenOnce = gaps.filter(g => g.includes('seen once'));
  const structural = [...new Set(gaps.filter(g => !g.includes('seen once')))];
  S.push('', '## What we can\'t tell yet', '', ...structural.slice(0, 6).map(g => `- ${g}`),
    ...(seenOnce.length ? [`- ${plural(seenOnce.length, 'behaviour')} ${seenOnce.length === 1 ? 'was' : 'were'} seen in only one session; rules.md lists them.`] : []),
    ...(!gaps.length ? ['- Nothing major.'] : []), '');
  fs.writeFileSync(path.join(OUT, 'summary.md'), S.join('\n'));
};
