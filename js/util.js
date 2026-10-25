window.SS = window.SS || {};

(function (SS) {
  'use strict';

  // Seeded PRNG so the same config + seed always produces the same mock logs.
  SS.mulberry32 = function (a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  SS.makeRandom = function (seed) {
    const rng = SS.mulberry32(seed >>> 0);
    const R = {
      next: rng,
      int(a, b) {
        if (b < a) [a, b] = [b, a];
        return Math.floor(rng() * (b - a + 1)) + a;
      },
      pick(arr) { return arr[Math.floor(rng() * arr.length)]; },
      hex(n) {
        let s = '';
        for (let i = 0; i < n; i++) s += Math.floor(rng() * 16).toString(16);
        return s;
      },
      uuid() {
        const c = R.hex(32).split('');
        c[12] = '4';
        c[16] = (8 + Math.floor(rng() * 4)).toString(16);
        const s = c.join('');
        return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
      },
    };
    return R;
  };

  SS.parseRange = function (text, fallback) {
    const m = String(text ?? '').match(/^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/);
    if (!m) return fallback;
    const a = Number(m[1]);
    const b = m[2] !== undefined ? Number(m[2]) : a;
    return a <= b ? [a, b] : [b, a];
  };

  SS.splitList = s => String(s ?? '').split(',').map(x => x.trim()).filter(Boolean);

  SS.pad = (n, w = 2) => String(n).padStart(w, '0');

  // Same shape as strftime(_time, "%Y-%m-%d %H:%M:%S.%3N") in local time.
  SS.formatTs = function (ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${SS.pad(d.getMonth() + 1)}-${SS.pad(d.getDate())} ` +
      `${SS.pad(d.getHours())}:${SS.pad(d.getMinutes())}:${SS.pad(d.getSeconds())}.${SS.pad(d.getMilliseconds(), 3)}`;
  };

  SS.parseTs = function (s) {
    const m = String(s ?? '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?/);
    if (!m) return NaN;
    const ms = m[7] ? Number(m[7].padEnd(3, '0').slice(0, 3)) : 0;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, ms).getTime();
  };

  // Splunk rex/match use PCRE; JS lacks inline flags, so a leading (?i)/(?s)/(?m) becomes a JS flag.
  SS.toJsRegex = function (pattern, global) {
    let p = String(pattern ?? '');
    let flags = global ? 'g' : '';
    const m = p.match(/^\(\?([imsx]+)\)/);
    if (m) {
      p = p.slice(m[0].length);
      for (const f of 'ims') if (m[1].includes(f)) flags += f;
    }
    return new RegExp(p, flags);
  };

  SS.escapeRegex = s => String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  SS.escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // A regex inside an SPL string: only double quotes need escaping (\s, \d, \[ pass through to PCRE).
  SS.splRegex = s => '"' + String(s ?? '').replace(/\\?"/g, '\\"') + '"';

  // A plain data string inside an SPL eval string literal.
  SS.splLiteral = s => '"' + String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

  // Rename the (?<value>...) capture group to the Splunk field it should populate.
  SS.namedGroup = (re, field) => String(re ?? '').replace('(?<value>', `(?<${field}>`);

  SS.hasValueGroup = re => String(re ?? '').includes('(?<value>');

  SS.indent = depth => (depth <= 1 ? '' : '-'.repeat(2 + 3 * (depth - 2)) + '> ');
})(window.SS);
