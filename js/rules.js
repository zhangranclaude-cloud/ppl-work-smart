// Analyses Flow Result rows into processing rules: what each API does downstream,
// which call patterns occur, how long calls take, and where responses are missing.
(function (SS) {
  'use strict';

  const paramKeys = p => String(p || '').split(';').map(s => s.split('=')[0].trim()).filter(Boolean);

  // Rebuild each session's call tree from the flat, time-ordered rows.
  SS.buildCallTrees = function (rows) {
    const sessions = new Map();
    for (const r of rows) {
      if (!r.sessionId || !r.layerId) continue;
      if (!sessions.has(r.sessionId)) sessions.set(r.sessionId, { sessionId: r.sessionId, roots: [], orphans: [], stack: [] });
      const s = sessions.get(r.sessionId);
      if (r.direction === 'Request') {
        const node = {
          layerId: r.layerId, layerLabel: r.layerLabel, api: r.api, pairKey: r.pairKey, depth: r.depth,
          sessionId: r.sessionId, start: r.eventTime, params: new Set(paramKeys(r.params)),
          children: [], elapsed: null, responded: false, parent: s.stack[s.stack.length - 1] || null,
        };
        (node.parent ? node.parent.children : s.roots).push(node);
        s.stack.push(node);
        continue;
      }
      let idx = -1;
      for (let i = s.stack.length - 1; i >= 0; i--) {
        if (s.stack[i].layerId === r.layerId && s.stack[i].pairKey === r.pairKey) { idx = i; break; }
      }
      if (idx === -1) { s.orphans.push(r); continue; }
      const node = s.stack[idx];
      node.responded = true;
      node.elapsed = r.elapsed;
      paramKeys(r.params).forEach(k => node.params.add(k));
      s.stack.length = idx;
    }
    return [...sessions.values()].map(({ stack, ...rest }) => rest);
  };

  const nodeLabel = n => `${n.layerLabel} ${n.api}`;
  const signature = n => `${n.layerId}:${n.api}` + (n.children.length ? '(' + n.children.map(signature).join(',') + ')' : '');

  SS.elapsedStats = function (values) {
    const v = values.filter(x => typeof x === 'number').sort((a, b) => a - b);
    if (!v.length) return null;
    const pick = q => v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)];
    return { n: v.length, min: v[0], max: v[v.length - 1], avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length), p95: pick(0.95) };
  };

  // Indented tree text for a list of call nodes.
  SS.treeLines = function (nodes, prefix = '') {
    const out = [];
    nodes.forEach((n, i) => {
      const last = i === nodes.length - 1;
      out.push(prefix + (last ? '└─ ' : '├─ ') + nodeLabel(n) + (n.responded ? '' : '  (no response)'));
      out.push(...SS.treeLines(n.children, prefix + (last ? '   ' : '│  ')));
    });
    return out;
  };

  SS.analyzeRules = function (cfg, rows) {
    const trees = SS.buildCallTrees(rows);
    const order = Object.fromEntries(cfg.layers.map((l, i) => [l.id, l.depth * 100 + i]));
    const rootRules = new Map();
    const catalogs = new Map();
    let calls = 0, timeouts = 0, orphans = 0;

    const visit = node => {
      calls++;
      if (!node.responded) timeouts++;
      if (!catalogs.has(node.layerId)) catalogs.set(node.layerId, { layerId: node.layerId, layerLabel: node.layerLabel, apis: new Map() });
      const cat = catalogs.get(node.layerId).apis;
      if (!cat.has(node.api)) cat.set(node.api, { api: node.api, count: 0, elapsed: [], timeouts: 0, calledBy: new Map(), calls: new Map(), params: new Set() });
      const e = cat.get(node.api);
      e.count++;
      e.elapsed.push(node.elapsed);
      if (!node.responded) e.timeouts++;
      node.params.forEach(k => e.params.add(k));
      const by = node.parent ? nodeLabel(node.parent) : '(entry point)';
      e.calledBy.set(by, (e.calledBy.get(by) || 0) + 1);
      for (const c of node.children) e.calls.set(nodeLabel(c), (e.calls.get(nodeLabel(c)) || 0) + 1);
      node.children.forEach(visit);
    };

    for (const s of trees) {
      orphans += s.orphans.length;
      for (const root of s.roots) {
        visit(root);
        const key = `${root.layerId}|${root.api}`;
        if (!rootRules.has(key)) {
          rootRules.set(key, {
            layerId: root.layerId, layerLabel: root.layerLabel, api: root.api,
            count: 0, sessions: new Set(), elapsed: [], timeouts: 0, params: new Set(), variants: new Map(),
          });
        }
        const rule = rootRules.get(key);
        rule.count++;
        rule.sessions.add(s.sessionId);
        rule.elapsed.push(root.elapsed);
        if (!root.responded) rule.timeouts++;
        root.params.forEach(k => rule.params.add(k));
        let downstreamTimeouts = 0;
        const countTimeouts = n => { if (!n.responded) downstreamTimeouts++; n.children.forEach(countTimeouts); };
        root.children.forEach(countTimeouts);
        rule.timeouts += downstreamTimeouts;
        const sig = signature({ ...root, layerId: '', api: '' });
        if (!rule.variants.has(sig)) rule.variants.set(sig, { count: 0, children: root.children });
        rule.variants.get(sig).count++;
      }
    }

    const rules = [...rootRules.values()].map(r => {
      const variants = [...r.variants.values()].sort((a, b) => b.count - a.count)
        .map(v => ({ count: v.count, share: Math.round((v.count / r.count) * 100), children: v.children, tree: SS.treeLines(v.children) }));
      const leafOnly = variants.filter(v => !v.children.length).length;
      const type = leafOnly === variants.length ? 'Processing rule only'
        : leafOnly ? 'Sometimes processing rule only' : 'Calls downstream';
      return { ...r, sessions: r.sessions.size, stats: SS.elapsedStats(r.elapsed), params: [...r.params], variants, type };
    });

    const layerCatalogs = [...catalogs.values()]
      .sort((a, b) => (order[a.layerId] ?? 999) - (order[b.layerId] ?? 999))
      .map(c => ({
        layerId: c.layerId, layerLabel: c.layerLabel,
        entries: [...c.apis.values()].map(e => ({
          api: e.api, count: e.count, timeouts: e.timeouts, stats: SS.elapsedStats(e.elapsed), params: [...e.params],
          calledBy: [...e.calledBy.entries()].map(([k, n]) => ({ label: k, count: n })),
          calls: [...e.calls.entries()].map(([k, n]) => ({ label: k, count: n })),
        })),
      }));

    return {
      summary: {
        sessions: trees.length,
        entryCalls: trees.reduce((n, s) => n + s.roots.length, 0),
        entryApis: rules.length,
        processingOnly: rules.filter(r => r.type === 'Processing rule only').length,
        calls, timeouts, orphans,
      },
      rules,
      catalogs: layerCatalogs,
    };
  };

  const fmtStats = s => (s ? `avg ${s.avg} ms (min ${s.min}, p95 ${s.p95}, max ${s.max})` : 'no response timings');
  SS.formatStats = fmtStats;
  const mdCell = s => String(s ?? '').replace(/\|/g, '\\|');

  SS.rulesMarkdown = function (a, title = 'Processing rules') {
    const s = a.summary;
    const out = [`# ${title}`, '',
      `Analysed ${s.sessions} session(s): ${s.entryCalls} entry call(s) across ${s.entryApis} API(s), ${s.calls} call(s) in total.`,
      `${s.processingOnly} API(s) are processing rule only. ${s.timeouts} call(s) had no response logged.` +
      (s.orphans ? ` ${s.orphans} response(s) had no matching request.` : ''), ''];
    out.push('## Entry API rules', '');
    for (const r of a.rules) {
      out.push(`### ${r.layerLabel} ${r.api}`, '');
      out.push(`- Rule: **${r.type}**`);
      out.push(`- Calls: ${r.count} in ${r.sessions} session(s)`);
      out.push(`- Elapsed: ${fmtStats(r.stats)}`);
      if (r.params.length) out.push(`- Params: ${r.params.join(', ')}`);
      if (r.timeouts) out.push(`- Missing responses: ${r.timeouts}`);
      r.variants.forEach((v, i) => {
        out.push('', r.variants.length > 1 ? `Pattern ${i + 1} (${v.count}×, ${v.share}%):` : 'Downstream:', '');
        out.push('```text', ...(v.tree.length ? v.tree : ['(no downstream calls: processing rule only)']), '```');
      });
      out.push('');
    }
    for (const c of a.catalogs) {
      out.push(`## ${c.layerLabel} catalogue`, '', '| API | Calls | Called by | Calls downstream | Elapsed | Missing responses |', '|---|---|---|---|---|---|');
      for (const e of c.entries) {
        out.push(`| ${mdCell(e.api)} | ${e.count} | ${mdCell(e.calledBy.map(x => `${x.label} (${x.count})`).join(', '))} | ` +
          `${mdCell(e.calls.map(x => `${x.label} (${x.count})`).join(', ') || '—')} | ${fmtStats(e.stats)} | ${e.timeouts || '—'} |`);
      }
      out.push('');
    }
    return out.join('\n');
  };
})(window.SS);
