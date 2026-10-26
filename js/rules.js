// Processing rules for one session, read off the same flow the sequence diagram draws.
// Step numbers equal the diagram's autonumber: one arrow per Flow Result row, in order.
// Each API/URL is one item; service-code (Host) calls are described in their caller's rule.
(function (SS) {
  'use strict';

  // Rebuild each session's call tree from the flat, time-ordered rows.
  SS.buildCallTrees = function (rows) {
    const sessions = new Map();
    for (const r of rows) {
      if (!r.sessionId || !r.layerId) continue;
      if (!sessions.has(r.sessionId)) sessions.set(r.sessionId, { sessionId: r.sessionId, roots: [], orphans: [], stack: [] });
      const s = sessions.get(r.sessionId);
      if (r.direction === 'Request') {
        const node = {
          layerId: r.layerId, layerLabel: r.layerLabel, api: r.api, pairKey: r.pairKey,
          reqStep: r.step, respStep: null, reqParams: r.params || '', respParams: '',
          elapsed: null, responded: false, children: [], parent: s.stack[s.stack.length - 1] || null,
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
      Object.assign(node, { responded: true, respStep: r.step, respParams: r.params || '', elapsed: r.elapsed });
      s.stack.length = idx;
    }
    return [...sessions.values()].map(({ stack, ...rest }) => rest);
  };

  const steps = n => (n.responded ? `${n.reqStep} → ${n.respStep}` : `${n.reqStep} → (no response)`);
  const ms = n => (n.elapsed != null ? `${n.elapsed} ms` : '');

  // opts: { sessionId, caller, wsInternal }
  SS.processingSteps = function (cfg, rows, opts = {}) {
    const o = { caller: 'App', wsInternal: true, ...opts };
    const svcLayers = new Set(cfg.layers.filter(l => l.apiMode === 'svccode').map(l => l.id));
    const trees = SS.buildCallTrees(rows);
    const tree = trees.find(t => t.sessionId === o.sessionId) || trees[0];
    if (!tree) return { sessionId: null, items: [], orphans: [] };

    const isService = n => svcLayers.has(n.layerId);
    const isInternal = n => o.wsInternal && n.layerId === 'ws' && n.parent;
    const name = n => `${n.layerLabel} ${n.api}`;
    const items = [];

    const describe = n => {
      const rules = [];
      // Who calls it.
      if (!n.parent) rules.push(`Entry API, called by ${o.caller}.`);
      else if (isInternal(n)) rules.push(`Internal processing step of ${name(n.parent)}: calls this web service.`);
      else rules.push(`Called by ${name(n.parent)}.`);

      // What it calls, in order.
      const kids = n.children;
      if (!kids.length) {
        rules.push(!n.parent ? 'Processing rule only: no downstream call.' : 'Handled here: no downstream call.');
      } else {
        rules.push('Calls, in order: ' + kids.map(c =>
          (isService(c) ? `${c.layerLabel} ${c.pairKey || c.api}` : name(c)) +
          (isInternal(c) ? ` (internal, step ${c.reqStep})` : ` (step ${c.reqStep})`)).join(' → ') + '.');
      }

      // Service-code calls are described here rather than as their own rows.
      for (const c of kids.filter(isService)) {
        const main = c.pairKey || String(c.api).split('.')[0];
        const subs = String(c.api).startsWith(main + '.') ? String(c.api).slice(main.length + 1) : '';
        let line = `${c.layerLabel} call: service code ${main}` + (subs ? ` with sub-codes ${subs.split(',').join(', ')}` : '');
        line += c.responded
          ? `; steps ${c.reqStep} → ${c.respStep}` + (c.elapsed != null ? `, ${ms(c)}` : '')
          : `; step ${c.reqStep}, no response logged (possible timeout)`;
        if (c.reqParams) line += `; request ${c.reqParams}`;
        if (c.respParams) line += `; response ${c.respParams}`;
        rules.push(line + '.');
      }

      // Its own outcome and parameters.
      if (n.responded) rules.push(`Responded at step ${n.respStep}` + (n.elapsed != null ? ` after ${ms(n)}` : '') + '.');
      else rules.push('No response logged (possible timeout).');
      if (n.reqParams) rules.push(`Request params: ${n.reqParams}.`);
      if (n.respParams) rules.push(`Response params: ${n.respParams}.`);
      return rules;
    };

    // Pre-order walk over the items (service-code calls excluded), with tree prefixes for the item column.
    const walk = (nodes, prefix, depth) => {
      const list = nodes.filter(n => !isService(n));
      list.forEach((n, i) => {
        const last = i === list.length - 1;
        items.push({
          steps: steps(n), reqStep: n.reqStep, respStep: n.respStep,
          layerId: n.layerId, layerLabel: n.layerLabel, api: n.api, depth,
          prefix: depth === 0 ? '' : prefix + (last ? '└─ ' : '├─ '),
          rules: describe(n),
        });
        walk(n.children, depth === 0 ? '' : prefix + (last ? '   ' : '│  '), depth + 1);
      });
    };
    walk(tree.roots, '', 0);

    // A service-code call made straight from the entry point (no API above it) still gets a row.
    for (const n of tree.roots.filter(isService)) {
      items.push({ steps: steps(n), reqStep: n.reqStep, respStep: n.respStep, layerId: n.layerId, layerLabel: n.layerLabel, api: n.api, depth: 0, prefix: '', rules: describe(n) });
    }
    items.sort((a, b) => a.reqStep - b.reqStep);

    return { sessionId: tree.sessionId, items, orphans: tree.orphans.map(r => ({ step: r.step, layerLabel: r.layerLabel, api: r.api })) };
  };

  const cell = s => String(s ?? '').replace(/\|/g, '\\|');

  SS.processingStepsMarkdown = function (res, title = 'Processing rules') {
    const out = [`# ${title}`, ''];
    if (res.sessionId) out.push(`Session \`${res.sessionId}\`. Step numbers match the sequence diagram.`, '');
    out.push('| Step | Item | Processing rule |', '|---|---|---|');
    for (const it of res.items) {
      out.push(`| ${cell(it.steps)} | ${cell((it.depth ? '&nbsp;'.repeat(it.depth * 3) + '└ ' : '') + `${it.layerLabel} \`${it.api}\``)} | ${cell(it.rules.join('<br>'))} |`);
    }
    if (res.orphans.length) {
      out.push('', 'Responses without a logged request: ' + res.orphans.map(o => `step ${o.step} ${o.layerLabel} ${o.api}`).join('; ') + '.');
    }
    return out.join('\n');
  };
})(window.SS);
