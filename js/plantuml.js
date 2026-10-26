// Turns Flow Result rows into a PlantUML sequence diagram for one session.
// Callers are worked out with a call stack: a request comes from the innermost call still open,
// and a response returns to whoever made the matching request.
(function (SS) {
  'use strict';

  const alias = id => 'L_' + String(id).replace(/\W/g, '_');
  const text = s => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/"/g, "'");

  SS.diagramSessions = rows => [...new Set(rows.map(r => r.sessionId).filter(Boolean))];

  // opts.internal: layer ids drawn as internal processing of their caller (a self-call
  // on the caller's lifeline) instead of as their own participant, e.g. ['ws'].
  SS.buildPlantUml = function (cfg, rows, opts = {}) {
    const o = { caller: 'App', params: true, time: false, elapsed: true, autonumber: true, internal: [], ...opts };
    const s = cfg.settings;
    const sessions = SS.diagramSessions(rows);
    const sid = o.sessionId && sessions.includes(o.sessionId) ? o.sessionId : (sessions[0] ?? null);
    const list = rows.filter(r => r.sessionId === sid && r.layerId);
    const internal = new Set(o.internal || []);

    const head = ['@startuml'];
    head.push(`title Transaction flow${o.label ? ' - ' + text(o.label) : ''}${sid ? ' - session ' + sid : ''}`);
    head.push('hide footbox');
    head.push('skinparam responseMessageBelowArrow true');
    if (o.autonumber) head.push('autonumber');
    head.push('');
    head.push(`actor "${text(o.caller) || 'App'}" as Caller`);

    if (!list.length) {
      return [...head, '', "note over Caller : No flow rows to draw. Check the Flow Result tab.", '@enduml'].join('\n');
    }

    const label = r => {
      const sym = r.direction === 'Request' ? s.requestSymbol : s.responseSymbol;
      const prefix = internal.has(r.layerId) ? text(r.layerLabel) + ': ' : '';
      let m = `${o.time ? r.eventTime.slice(11) + '  ' : ''}${prefix}${text(r.api)} [${text(sym)}]`;
      if (o.elapsed && r.direction === 'Response' && r.elapsed != null) m += ` (${r.elapsed} ms)`;
      if (r.hostServices) m += '\\n' + text(r.hostServices); // PlantUML line break
      if (o.params && r.params) m += '\\n' + text(r.params);
      return m;
    };

    const body = [];
    const drawn = new Set();
    const use = a => { if (a !== 'Caller') drawn.add(a); return a; };
    const unanswered = c => {
      body.push(`note over ${c.as} : no response logged for ${text(c.row.api)}`);
      body.push(`deactivate ${c.as}`);
    };

    // Each open call remembers which lifeline it is drawn on ("as").
    const stack = [];
    for (const r of list) {
      if (r.direction === 'Request') {
        const from = stack.length ? stack[stack.length - 1].as : 'Caller';
        const as = internal.has(r.layerId) && from !== 'Caller' ? from : alias(r.layerId);
        body.push(`${use(from)} -> ${use(as)} : ${label(r)}`);
        body.push(`activate ${as}`);
        stack.push({ row: r, as });
        continue;
      }
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].row.layerId === r.layerId && stack[i].row.pairKey === r.pairKey) { idx = i; break; }
      }
      if (idx === -1) {
        const self = use(alias(r.layerId));
        const to = stack.length ? stack[stack.length - 1].as : 'Caller';
        body.push(`${self} --> ${use(to)} : ${label(r)}`);
        body.push(`note right of ${self} : response without a logged request`);
        continue;
      }
      for (let i = stack.length - 1; i > idx; i--) unanswered(stack[i]);
      const self = stack[idx].as;
      const to = idx > 0 ? stack[idx - 1].as : 'Caller';
      body.push(`${self} --> ${to} : ${label(r)}`);
      body.push(`deactivate ${self}`);
      stack.length = idx;
    }
    for (let i = stack.length - 1; i >= 0; i--) unanswered(stack[i]);

    const layers = cfg.layers
      .map((l, i) => ({ l, i }))
      .filter(x => drawn.has(alias(x.l.id)))
      .sort((a, b) => (a.l.depth - b.l.depth) || (a.i - b.i))
      .map(x => x.l);
    for (const l of layers) head.push(`participant "${text(l.label)}" as ${alias(l.id)}`);

    return [...head, '', ...body, '@enduml'].join('\n');
  };
})(window.SS);
