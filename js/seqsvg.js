// Draws a PlantUML sequence diagram locally (no PlantUML server), so the preview
// matches the generated code without any data leaving the browser.
// Supports the subset js/plantuml.js emits: title, autonumber, actor/participant,
// -> and --> messages (with \n line breaks), activate/deactivate, notes.
(function (SS) {
  'use strict';

  const LINE = 15;
  const MARGIN = 20;
  SS.SEQ_FONT = '12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  SS.parsePlantUml = function (src) {
    const d = { title: '', autonumber: false, responseBelow: false, participants: [], items: [] };
    const byAlias = {};
    const add = (alias, label, kind) => {
      if (!byAlias[alias]) { byAlias[alias] = { alias, label, kind }; d.participants.push(byAlias[alias]); }
    };
    const lines = text => String(text ?? '').split('\\n');
    for (const raw of String(src ?? '').split(/\r?\n/)) {
      const line = raw.trim();
      let m;
      if (!line || line.startsWith("'") || line.startsWith('@') || line.startsWith('hide ')) continue;
      if ((m = line.match(/^skinparam\s+responseMessageBelowArrow\s+true$/i))) d.responseBelow = true;
      else if (line.startsWith('skinparam')) continue;
      else if ((m = line.match(/^title\s+(.*)$/))) d.title = m[1];
      else if (line === 'autonumber') d.autonumber = true;
      else if ((m = line.match(/^(actor|participant)\s+(?:"([^"]*)"|(\S+))(?:\s+as\s+([\w.]+))?$/))) {
        const label = m[2] ?? m[3];
        add(m[4] || label, label, m[1]);
      } else if ((m = line.match(/^([\w.]+)\s*(-->|->)\s*([\w.]+)\s*(?::\s*(.*))?$/))) {
        d.items.push({ type: 'msg', from: m[1], to: m[3], dashed: m[2] === '-->', text: lines(m[4]) });
      } else if ((m = line.match(/^(activate|deactivate)\s+([\w.]+)$/))) {
        d.items.push({ type: m[1], who: m[2] });
      } else if ((m = line.match(/^note\s+(over|right of|left of)\s+([\w.]+)\s*:\s*(.*)$/))) {
        d.items.push({ type: 'note', pos: m[1], who: m[2], text: lines(m[3]) });
      }
    }
    for (const it of d.items) for (const a of [it.from, it.to, it.who]) if (a) add(a, a, 'participant');
    return d;
  };

  // Returns { width, height, shapes } with shapes in paint order.
  SS.layoutSequence = function (d, measure) {
    const tw = measure || (s => String(s).length * 6.8);
    const P = d.participants;
    const n = P.length;
    const idx = Object.fromEntries(P.map((p, i) => [p.alias, i]));
    const boxW = P.map(p => Math.max(70, tw(p.label) + 24));
    const gaps = [];
    for (let i = 0; i < n - 1; i++) gaps.push(Math.max(110, (boxW[i] + boxW[i + 1]) / 2 + 30));

    // Widen columns so every message label fits between its two lifelines.
    let num = 0;
    const msgs = d.items.filter(it => it.type === 'msg').map(m => {
      num++;
      const a = idx[m.from], b = idx[m.to];
      const prefix = d.autonumber ? tw(String(num)) + 8 : 0;
      const w = Math.max(...m.text.map((t, k) => tw(t) + (k === 0 ? prefix : 0))) + 30;
      return { lo: Math.min(a, b), hi: Math.max(a, b), w };
    }).filter(m => m.hi > m.lo).sort((x, y) => (x.hi - x.lo) - (y.hi - y.lo));
    for (const m of msgs) {
      let sum = 0;
      for (let i = m.lo; i < m.hi; i++) sum += gaps[i];
      if (sum < m.w) gaps[m.hi - 1] += m.w - sum;
    }

    const xs = [];
    let x = MARGIN + (boxW[0] || 0) / 2;
    for (let i = 0; i < n; i++) { xs.push(x); x += gaps[i] || 0; }
    let right = n ? xs[n - 1] + boxW[n - 1] / 2 : MARGIN;

    const back = [], bars = [], fg = [];
    let y = MARGIN;
    if (d.title) { fg.push({ t: 'text', x: 0, y: y + 13, s: d.title, c: 'seq-title', a: 'middle', center: true }); y += 30; }

    const hasActor = P.some(p => p.kind === 'actor');
    const headTop = y;
    const headH = hasActor ? 58 : 32;
    P.forEach((p, i) => {
      if (p.kind === 'actor') {
        const cx = xs[i], top = headTop;
        fg.push({ t: 'circle', cx, cy: top + 7, r: 7, c: 'seq-actor' });
        fg.push({ t: 'line', x1: cx, y1: top + 14, x2: cx, y2: top + 30, c: 'seq-figure' });
        fg.push({ t: 'line', x1: cx - 10, y1: top + 19, x2: cx + 10, y2: top + 19, c: 'seq-figure' });
        fg.push({ t: 'line', x1: cx, y1: top + 30, x2: cx - 8, y2: top + 40, c: 'seq-figure' });
        fg.push({ t: 'line', x1: cx, y1: top + 30, x2: cx + 8, y2: top + 40, c: 'seq-figure' });
        fg.push({ t: 'text', x: cx, y: top + 54, s: p.label, c: 'seq-label', a: 'middle' });
      } else {
        const top = headTop + headH - 32;
        fg.push({ t: 'rect', x: xs[i] - boxW[i] / 2, y: top, w: boxW[i], h: 28, rx: 3, c: 'seq-box' });
        fg.push({ t: 'text', x: xs[i], y: top + 18, s: p.label, c: 'seq-label', a: 'middle' });
      }
    });
    const lifeTop = headTop + headH;
    y = lifeTop + 14;

    const active = {};
    const depth = a => (active[a] || []).length;
    let lastArrowY = y;
    num = 0;

    d.items.forEach((it, k) => {
      if (it.type === 'msg') {
        num++;
        const a = idx[it.from], b = idx[it.to];
        const dir = xs[b] >= xs[a] ? 1 : -1;
        const next = d.items[k + 1];
        const activatesTarget = next && next.type === 'activate' && next.who === it.to;
        const x1 = xs[a] + dir * (depth(it.from) ? 5 : 0);
        const x2 = xs[b] - dir * (depth(it.to) || activatesTarget ? 5 : 0);
        const below = it.dashed && d.responseBelow;
        const textH = it.text.length * LINE;
        const arrowY = below ? y + 4 : y + textH + 2;
        const textTop = below ? arrowY + 4 : y;
        const tx = Math.min(x1, x2) + 8;
        it.text.forEach((line, li) => {
          let lx = tx;
          const ly = textTop + (li + 1) * LINE - 3;
          if (li === 0 && d.autonumber) {
            fg.push({ t: 'text', x: lx, y: ly, s: String(num), c: 'seq-num', a: 'start' });
            lx += tw(String(num)) + 8;
          }
          fg.push({ t: 'text', x: lx, y: ly, s: line, c: 'seq-text', a: 'start' });
        });
        fg.push({ t: 'line', x1, y1: arrowY, x2: x2 - dir * 2, y2: arrowY, c: it.dashed ? 'seq-msg seq-dashed' : 'seq-msg' });
        fg.push({ t: 'poly', pts: [[x2, arrowY], [x2 - dir * 9, arrowY - 4], [x2 - dir * 9, arrowY + 4]], c: 'seq-head' });
        lastArrowY = arrowY;
        y = (below ? textTop + textH : arrowY) + 12;
      } else if (it.type === 'activate') {
        (active[it.who] = active[it.who] || []).push(lastArrowY);
      } else if (it.type === 'deactivate') {
        const stack = active[it.who] || [];
        const start = stack.pop();
        if (start !== undefined) {
          const i = idx[it.who];
          bars.push({ t: 'rect', x: xs[i] - 5 + stack.length * 5, y: start, w: 10, h: Math.max(8, lastArrowY - start), rx: 0, c: 'seq-act' });
        }
      } else if (it.type === 'note') {
        const i = idx[it.who];
        const w = Math.max(...it.text.map(tw)) + 18;
        const h = it.text.length * LINE + 10;
        const nx = it.pos === 'over' ? xs[i] - w / 2 : it.pos === 'right of' ? xs[i] + 12 : xs[i] - 12 - w;
        const ny = y + 2;
        fg.push({ t: 'poly', pts: [[nx, ny], [nx + w - 8, ny], [nx + w, ny + 8], [nx + w, ny + h], [nx, ny + h]], c: 'seq-note' });
        it.text.forEach((line, li) => fg.push({ t: 'text', x: nx + 8, y: ny + 5 + (li + 1) * LINE - 3, s: line, c: 'seq-text', a: 'start' }));
        right = Math.max(right, nx + w);
        lastArrowY = Math.max(lastArrowY, ny + h);
        y = ny + h + 12;
      }
    });

    // Close anything never deactivated.
    for (const [who, stack] of Object.entries(active)) {
      while (stack.length) {
        const start = stack.pop();
        bars.push({ t: 'rect', x: xs[idx[who]] - 5 + stack.length * 5, y: start, w: 10, h: Math.max(8, y - start), rx: 0, c: 'seq-act' });
      }
    }

    const bottom = y + 6;
    xs.forEach(cx => back.push({ t: 'line', x1: cx, y1: lifeTop, x2: cx, y2: bottom, c: 'seq-life' }));
    const width = Math.ceil(right + MARGIN);
    for (const s of fg) if (s.center) s.x = width / 2;
    return { width, height: Math.ceil(bottom + MARGIN), shapes: [...back, ...bars, ...fg] };
  };

  // Standalone SVG file (own colours, light theme) for download.
  const EXPORT_CSS = [
    `text{font:${SS.SEQ_FONT};fill:#181818}`,
    '.seq-title{font-weight:600;font-size:14px}',
    '.seq-num{font-weight:700}',
    '.seq-box{fill:#eef1fb;stroke:#4a5578;stroke-width:1}',
    '.seq-actor{fill:#eef1fb;stroke:#4a5578;stroke-width:1.5}',
    '.seq-figure{stroke:#4a5578;stroke-width:1.5}',
    '.seq-life{stroke:#8a93a6;stroke-width:1;stroke-dasharray:5 4}',
    '.seq-act{fill:#ffffff;stroke:#4a5578;stroke-width:1}',
    '.seq-msg{stroke:#181818;stroke-width:1.2}',
    '.seq-dashed{stroke-dasharray:5 3}',
    '.seq-head{fill:#181818}',
    '.seq-note{fill:#fff8d6;stroke:#a68a00;stroke-width:1}',
  ].join('');

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const r = v => Math.round(v * 10) / 10;

  SS.sequenceSvgString = function (layout) {
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">`,
      `<style>${EXPORT_CSS}</style>`,
      `<rect width="100%" height="100%" fill="#ffffff"/>`,
    ];
    for (const s of layout.shapes) {
      if (s.t === 'line') parts.push(`<line class="${s.c}" x1="${r(s.x1)}" y1="${r(s.y1)}" x2="${r(s.x2)}" y2="${r(s.y2)}"/>`);
      else if (s.t === 'rect') parts.push(`<rect class="${s.c}" x="${r(s.x)}" y="${r(s.y)}" width="${r(s.w)}" height="${r(s.h)}" rx="${s.rx || 0}"/>`);
      else if (s.t === 'circle') parts.push(`<circle class="${s.c}" cx="${r(s.cx)}" cy="${r(s.cy)}" r="${s.r}"/>`);
      else if (s.t === 'poly') parts.push(`<polygon class="${s.c}" points="${s.pts.map(p => p.map(r).join(',')).join(' ')}"/>`);
      else if (s.t === 'text') parts.push(`<text class="${s.c}" x="${r(s.x)}" y="${r(s.y)}" text-anchor="${s.a}">${esc(s.s)}</text>`);
    }
    parts.push('</svg>');
    return parts.join('\n');
  };
})(window.SS);
