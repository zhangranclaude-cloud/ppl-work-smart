// Builds the SPL from the config. simulator.js mirrors every step here; change both together.
(function (SS) {
  'use strict';

  const DELIM = '~|~';
  const q = SS.splRegex;
  const lit = SS.splLiteral;

  SS.buildSpl = function (cfg, opts = {}) {
    const s = cfg.settings;
    const L = cfg.layers;
    const P = SS.activeParams(cfg);
    const o = [];
    const note = t => { if (s.splComments) o.push('``` ' + t + ' ```'); };
    const name = l => lit(l.label);

    if (opts.events) {
      o.push('| makeresults');
      note('0. Test data injected inline - no ingestion needed');
      o.push('| eval row=null()');
      for (let i = 0; i < opts.events.length; i += 20) {
        const chunk = opts.events.slice(i, i + 20).map(e => lit((e.time / 1000).toFixed(3) + DELIM + e.raw));
        o.push('| eval row=mvappend(row,\n    ' + chunk.join(',\n    ') + ')');
      }
      o.push('| mvexpand row');
      o.push(`| eval _time=tonumber(mvindex(split(row, "${DELIM}"), 0)), _raw=mvindex(split(row, "${DELIM}"), 1)`);
      o.push('| fields - row');
    } else {
      const groups = [];
      for (const l of L) {
        let g = groups.find(x => x.source === l.source);
        if (!g) groups.push(g = { source: l.source, terms: [] });
        if (l.terms && l.terms.trim()) g.terms.push(l.terms.trim());
      }
      const clauses = groups.map(g => {
        const t = g.terms.length > 1 ? '(' + g.terms.map(x => `(${x})`).join(' OR ') + ')' : (g.terms[0] || '');
        return '(' + [g.source, t].filter(Boolean).join(' ') + ')';
      });
      o.push(clauses.join('\nOR\n') + (s.sessionFilter && s.sessionFilter.trim() ? '\n' + s.sessionFilter.trim() : ''));
    }

    note('1. Classify each event into its layer (first match wins)');
    o.push('| eval LayerName=case(\n    ' + L.map(l => `match(_raw, ${q(l.classify)}), ${name(l)}`).join(',\n    ') + ')');
    o.push('| where isnotnull(LayerName)');
    o.push('| eval Layer=case(' + L.map(l => `LayerName=${name(l)}, ${Number(l.depth) || 1}`).join(', ') + ')');

    note('2. Extract fields');
    for (const l of L) if (l.sessionRegex) o.push(`| rex field=_raw ${q(SS.namedGroup(l.sessionRegex, 'sid_' + l.id))}`);
    o.push(`| rex field=_raw ${q(SS.namedGroup(s.genericSessionRegex, 'sidAny'))}`);
    for (const l of L) {
      if (!l.apiRegex) continue;
      o.push(`| rex field=_raw${l.apiMode === 'svccode' ? ' max_match=0' : ''} ${q(SS.namedGroup(l.apiRegex, 'api_' + l.id))}`);
    }
    for (const p of P) o.push(`| rex field=_raw ${q(SS.namedGroup(SS.paramRegex(p), p.name))}`);

    o.push('| eval sessionId=case(\n    ' + L.map(l =>
      `LayerName=${name(l)}, ${l.sessionRegex ? `coalesce(sid_${l.id}, sidAny)` : 'sidAny'}`).join(',\n    ') + ')');
    o.push('| eval Direction=case(\n    ' + L.map(l => {
      const req = l.requestRegex ? `match(_raw, ${q(l.requestRegex)})` : 'false()';
      const resp = l.responseRegex ? `match(_raw, ${q(l.responseRegex)})` : 'false()';
      return `LayerName=${name(l)}, case(${req}, "Request", ${resp}, "Response")`;
    }).join(',\n    ') + ')');
    o.push('| where isnotnull(Direction)');

    note('3. Order: parent request before child, child response before parent');
    o.push('| eval SortKey=if(Direction="Request", Layer, -Layer)');
    o.push('| sort 0 _time SortKey');

    note('4. Build the API name');
    for (const l of L.filter(x => x.inheritApi && x.apiRegex && x.apiMode !== 'svccode')) {
      o.push(`| eval inh_${l.id}=if(LayerName=${name(l)}, api_${l.id}, null())`);
      o.push(`| streamstats last(inh_${l.id}) as last_${l.id} by sessionId`);
    }
    o.push('| eval API=case(\n    ' + L.map(l => `LayerName=${name(l)}, ${apiExpr(l)}`).join(',\n    ') + ')');
    o.push('| where isnotnull(API)');
    const svc = L.filter(l => l.apiMode === 'svccode' && l.apiRegex);
    o.push(svc.length
      ? '| eval PairKey=case(' + svc.map(l => `LayerName=${name(l)}, mvindex(api_${l.id}, 0)`).join(', ') + ', true(), API)'
      : '| eval PairKey=API');

    note('5. Parameters stamped on the line');
    o.push('| eval Params=null()');
    for (const p of P) {
      const layerNames = L.filter(l => p.layers.includes(l.id)).map(name);
      if (!layerNames.length) continue;
      o.push(`| eval Params=mvappend(Params, if(in(LayerName, ${layerNames.join(', ')}) AND isnotnull(${p.name}) AND len(trim(${p.name}))>0, ${lit((p.label || p.name) + '=')}.${p.name}, null()))`);
    }
    o.push('| eval Params=mvjoin(Params, "; ")');

    note('6. Elapsed time per call (response minus its matching request)');
    o.push('| eval reqTime=if(Direction="Request", _time, null())');
    o.push('| streamstats last(reqTime) as lastReqTime by sessionId LayerName PairKey');
    o.push('| eval ElapsedMs=if(Direction="Response" AND isnotnull(lastReqTime), round((_time-lastReqTime)*1000, 0), null())');

    note('7. Render the flow');
    o.push(`| eval DirectionSymbol=if(Direction="Request", ${lit(s.requestSymbol)}, ${lit(s.responseSymbol)})`);
    const depths = [...new Set(L.map(l => Number(l.depth) || 1))].sort((a, b) => a - b);
    o.push('| eval Indent=case(' + depths.map(d => `Layer=${d}, ${lit(SS.indent(d))}`).join(', ') + ')');
    o.push('| eval Flow=Indent.LayerName.": ".API." [".DirectionSymbol."]"');
    o.push('| streamstats count as Step by sessionId');
    o.push('| eval EventTime=strftime(_time, "%Y-%m-%d %H:%M:%S.%3N")');
    o.push('| table Step EventTime sessionId Flow Params ElapsedMs');

    return o.join('\n');
  };

  function apiExpr(l) {
    const f = 'api_' + l.id;
    if (!l.apiRegex) return l.requireApi ? 'null()' : '"N/A"';
    if (l.apiMode === 'svccode') {
      const e = `if(mvcount(${f})>0, mvindex(${f}, 0).if(mvcount(${f})>1, ".".mvjoin(mvindex(${f}, 1, -1), ","), ""), null())`;
      return l.requireApi ? e : `coalesce(${e}, "N/A")`;
    }
    const parts = [f];
    if (l.inheritApi) parts.push('last_' + l.id);
    if (!l.requireApi) parts.push('"N/A"');
    return parts.length > 1 ? `coalesce(${parts.join(', ')})` : f;
  }
})(window.SS);
