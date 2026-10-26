// Runs the same pipeline as the generated SPL (spl.js) in the browser, step for step,
// so regexes and flow logic can be checked against mock or pasted logs without Splunk.
(function (SS) {
  'use strict';

  function firstVal(re, raw) {
    if (!re) return null;
    const m = re.exec(raw);
    return m && m.groups && m.groups.value !== undefined ? m.groups.value : null;
  }

  function allVals(re, raw) {
    if (!re) return [];
    const out = [];
    for (const m of raw.matchAll(re)) if (m.groups && m.groups.value !== undefined) out.push(m.groups.value);
    return out;
  }

  SS.compile = function (cfg) {
    const errors = [];
    const comp = (pat, where, global) => {
      if (!pat) return null;
      try { return SS.toJsRegex(pat, global); } catch (e) { errors.push(`${where}: ${e.message}`); return null; }
    };
    const layers = cfg.layers.map((l, idx) => ({
      l, idx,
      classify: comp(l.classify, `Layer ${l.label} classify regex`),
      sid: comp(l.sessionRegex, `Layer ${l.label} session regex`),
      req: comp(l.requestRegex, `Layer ${l.label} request regex`),
      resp: comp(l.responseRegex, `Layer ${l.label} response regex`),
      api: comp(l.apiRegex, `Layer ${l.label} API regex`, l.apiMode === 'svccode'),
    }));
    const params = SS.activeParams(cfg).map(p => ({ p, re: comp(SS.paramRegex(p), `Parameter ${p.name} regex`) }));
    const generic = comp(cfg.settings.genericSessionRegex, 'Generic session regex');
    return { errors, layers, params, generic };
  };

  SS.simulate = function (cfg, events) {
    const C = SS.compile(cfg);
    const s = cfg.settings;
    const debug = [];
    const kept = [];

    // 1-2. Classify, extract, keep events with a direction.
    events.forEach((ev, i) => {
      const d = {
        idx: i + 1, time: ev.time, raw: ev.raw, layer: null, layerId: null, layerIdx: -1,
        direction: null, sessionId: null, api: null, params: {}, status: 'kept', reason: '',
        hasTruth: 'layerId' in ev, expectedId: ev.layerId ?? null, expectedIdx: ev.layerIdx ?? -1,
      };
      debug.push(d);
      for (const P of C.params) {
        const v = firstVal(P.re, ev.raw);
        if (v !== null) d.params[P.p.name] = v;
      }
      const L = C.layers.find(x => x.classify && x.classify.test(ev.raw));
      if (!L) { d.status = 'dropped'; d.reason = 'No layer classify regex matched'; return; }
      d.layer = L.l.label; d.layerId = L.l.id; d.layerIdx = L.idx;
      d.sessionId = firstVal(L.sid, ev.raw) ?? firstVal(C.generic, ev.raw);
      d.direction = L.req && L.req.test(ev.raw) ? 'Request' : L.resp && L.resp.test(ev.raw) ? 'Response' : null;
      d.apiValues = L.l.apiMode === 'svccode' ? allVals(L.api, ev.raw) : [firstVal(L.api, ev.raw)].filter(v => v !== null);
      if (!d.direction) { d.status = 'dropped'; d.reason = 'Neither request nor response regex matched'; return; }
      kept.push({ d, L, time: ev.time, sortKey: d.direction === 'Request' ? L.l.depth : -L.l.depth });
    });

    // 3. Parent request before child; child response before parent.
    kept.sort((a, b) => a.time - b.time || a.sortKey - b.sortKey);

    // 4. Inherit API (streamstats last(...) by sessionId), build API, drop when required and missing.
    const inheritLayers = cfg.layers.filter(l => l.inheritApi);
    const lastInh = {};
    const rows = [];
    for (const r of kept) {
      const l = r.L.l, d = r.d, vals = d.apiValues;
      let inherited = null;
      for (const il of inheritLayers) {
        if (d.sessionId == null) continue;
        const k = il.id + '|' + d.sessionId;
        if (l.id === il.id && vals.length) lastInh[k] = vals[0];
        if (il.id === l.id) inherited = lastInh[k] ?? null;
      }
      let api;
      if (l.apiMode === 'svccode') api = vals.length ? vals[0] : null;
      else api = vals[0] ?? (l.inheritApi ? inherited : null);
      if (api === null && !l.requireApi) api = 'N/A';
      if (api === null) { d.status = 'dropped'; d.reason = 'API not found and the layer requires it'; continue; }
      d.api = api;
      const pairKey = l.apiMode === 'svccode' ? (vals[0] ?? null) : api;

      // 5. Params stamped on the line.
      const plist = [];
      for (const P of C.params) {
        if (!P.p.layers.includes(l.id)) continue;
        const v = d.params[P.p.name];
        if (v != null && v.trim().length > 0) plist.push(`${P.p.label || P.p.name}: ${v}`);
      }
      const hostServices = l.apiMode === 'svccode' && vals.length ? SS.hostPairs(vals) : null;
      rows.push({ r, api, pairKey, hostServices, params: plist.join('; ') });
    }

    // 6-7. Elapsed per call, step numbers, flow text.
    const lastReq = {}, steps = {};
    const out = rows.map(o => {
      const { d, L } = o.r;
      const sid = d.sessionId;
      let elapsed = null;
      if (sid != null && o.pairKey != null) {
        const k = `${sid}|${L.l.label}|${o.pairKey}`;
        if (d.direction === 'Request') lastReq[k] = o.r.time;
        else if (lastReq[k] !== undefined) elapsed = Math.round(o.r.time - lastReq[k]);
      }
      const sym = d.direction === 'Request' ? s.requestSymbol : s.responseSymbol;
      return {
        step: sid != null ? (steps[sid] = (steps[sid] || 0) + 1) : null,
        eventTime: SS.formatTs(o.r.time),
        sessionId: sid,
        flow: `${SS.indent(L.l.depth)}${L.l.label}: ${o.api} [${sym}]`,
        hostServices: o.hostServices,
        params: o.params,
        elapsed,
        layerIdx: L.idx,
        depth: L.l.depth,
        // Structured fields for consumers such as the sequence diagram.
        layerId: L.l.id,
        layerLabel: L.l.label,
        api: o.api,
        direction: d.direction,
        pairKey: o.pairKey,
      };
    });

    // Self-test: for mock logs we know which layer each line was written for.
    for (const d of debug) {
      if (!d.hasTruth) continue;
      if (d.expectedId === null) d.mismatch = d.status === 'kept' ? 'Noise line was kept' : '';
      else if (d.status !== 'kept') d.mismatch = `Expected ${layerLabel(cfg, d.expectedId)} but ${d.reason.toLowerCase()}`;
      else if (d.layerId !== d.expectedId) d.mismatch = `Expected ${layerLabel(cfg, d.expectedId)}, classified as ${d.layer}`;
      else d.mismatch = '';
    }

    return { errors: C.errors, rows: out, debug };
  };

  function layerLabel(cfg, id) {
    const l = cfg.layers.find(x => x.id === id);
    return l ? l.label : id;
  }
})(window.SS);
