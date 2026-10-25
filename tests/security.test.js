// Guards the promise that the app never sends data anywhere: no network APIs,
// no remote resources, no HTML injection, and a CSP that blocks connections.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./load');

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);
const html = read('index.html');

test('no network APIs in the app code', () => {
  const banned = [
    /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/,
    /\bimport\s*\(/, /importScripts/, /new\s+Image\s*\(/, /\.src\s*=/, /window\.open\s*\(/,
    /RTCPeerConnection/, /navigator\.serviceWorker/,
  ];
  for (const f of jsFiles) {
    const src = read(f);
    for (const re of banned) assert.ok(!re.test(src), `${f} must not use ${re}`);
  }
});

test('no HTML injection sinks in the app code', () => {
  for (const f of jsFiles) {
    const src = read(f);
    for (const re of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new\s+Function\s*\(/]) {
      assert.ok(!re.test(src), `${f} must not use ${re}`);
    }
  }
});

test('index.html loads only local scripts and styles', () => {
  const refs = [...html.matchAll(/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)\s*=\s*"([^"]+)"/g)].map(m => m[1]);
  assert.ok(refs.length > 0);
  for (const r of refs) assert.ok(!/^(?:[a-z]+:)?\/\//i.test(r), `remote resource: ${r}`);
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'no inline scripts');
});

test('Content-Security-Policy blocks all outbound connections', () => {
  const m = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  assert.ok(m, 'CSP meta tag present');
  const csp = Object.fromEntries(m[1].split(';').map(s => s.trim().split(/\s+/)).filter(p => p[0]).map(([k, ...v]) => [k, v.join(' ')]));
  assert.equal(csp['default-src'], "'none'");
  assert.equal(csp['connect-src'], "'none'");
  assert.equal(csp['script-src'], "'self'");
  assert.equal(csp['form-action'], "'none'");
  assert.ok(!/unsafe-(inline|eval)/.test(m[1]));
});

test('no secrets or credentials in tracked source files', () => {
  const files = [...jsFiles, 'index.html', 'css/style.css', 'README.md'];
  const patterns = [
    /AKIA[0-9A-Z]{16}/, /gh[pousr]_[A-Za-z0-9]{36,}/, /xox[baprs]-[A-Za-z0-9-]{10,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /AIza[0-9A-Za-z_-]{35}/, /sk-[A-Za-z0-9]{32,}/,
    /(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'][^"']{6,}["']/i,
  ];
  for (const f of files) {
    const src = read(f);
    for (const re of patterns) assert.ok(!re.test(src), `${f} matches ${re}`);
  }
});
