// Turns Flow Result rows into a PlantUML sequence diagram for one session.
// Callers are worked out with a call stack: a request comes from the innermost call still open,
// and a response returns to whoever made the matching request.
(function (SS) {
  'use strict';

  const alias = id => 'L_' + String(id).replace(/\W/g, '_');
  const text = s => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/"/g, "'");

  SS.diagramSessions = rows => [...new Set(rows.map(r => r.sessionId).filter(Boolean))];

  SS.buildPlantUml = function (cfg, rows, opts = {}) {
    const o = { caller: 'App', params: true, time: false, elapsed: true, autonumber: true, ...opts };
    const s = cfg.settings;
    const sessions = SS.diagramSessions(rows);
    const sid = o.sessionId && sessions.includes(o.sessionId) ? o.sessionId : (sessions[0] ?? null);
    const list = rows.filter(r => r.sessionId === sid && r.layerId);

    const used = new Set(list.map(r => r.layerId));
    const layers = cfg.layers
      .map((l, i) => ({ l, i }))
      .filter(x => used.has(x.l.id))
      .sort((a, b) => (a.l.depth - b.l.depth) || (a.i - b.i))
      .map(x => x.l);

    const out = ['@startuml'];
    out.push(`title Transaction flow${o.label ? ' - ' + text(o.label) : ''}${sid ? ' - session ' + sid : ''}`);
    out.push('hide footbox');
    out.push('skinparam responseMessageBelowArrow true');
    if (o.autonumber) out.push('autonumber');
    out.push('');
    out.push(`actor "${text(o.caller) || 'App'}" as Caller`);
    for (const l of layers) out.push(`participant "${text(l.label)}" as ${alias(l.id)}`);
    out.push('');

    if (!list.length) {
      out.push("note over Caller : No flow rows to draw. Check the Flow Result tab.");
      out.push('@enduml');
      return out.join('\n');
    }

    const label = r => {
      const sym = r.direction === 'Request' ? s.requestSymbol : s.responseSymbol;
      let m = `${o.time ? r.eventTime.slice(11) + '  ' : ''}${text(r.api)} [${text(sym)}]`;
      if (o.elapsed && r.direction === 'Response' && r.elapsed != null) m += ` (${r.elapsed} ms)`;
      if (o.params && r.params) m += '\\n' + text(r.params);
      return m;
    };
    const unanswered = c => {
      out.push(`note over ${alias(c.row.layerId)} : no response logged for ${text(c.row.api)}`);
      out.push(`deactivate ${alias(c.row.layerId)}`);
    };

    const stack = [];
    for (const r of list) {
      const self = alias(r.layerId);
      if (r.direction === 'Request') {
        const from = stack.length ? alias(stack[stack.length - 1].row.layerId) : 'Caller';
        out.push(`${from} -> ${self} : ${label(r)}`);
        out.push(`activate ${self}`);
        stack.push({ row: r });
        continue;
      }
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].row.layerId === r.layerId && stack[i].row.pairKey === r.pairKey) { idx = i; break; }
      }
      if (idx === -1) {
        const to = stack.length ? alias(stack[stack.length - 1].row.layerId) : 'Caller';
        out.push(`${self} --> ${to} : ${label(r)}`);
        out.push(`note right of ${self} : response without a logged request`);
        continue;
      }
      for (let i = stack.length - 1; i > idx; i--) unanswered(stack[i]);
      const to = idx > 0 ? alias(stack[idx - 1].row.layerId) : 'Caller';
      out.push(`${self} --> ${to} : ${label(r)}`);
      out.push(`deactivate ${self}`);
      stack.length = idx;
    }
    for (let i = stack.length - 1; i >= 0; i--) unanswered(stack[i]);

    out.push('@enduml');
    return out.join('\n');
  };
})(window.SS);
