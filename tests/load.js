// Loads the browser scripts into a sandbox so the engine can be tested in Node without a DOM.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const ENGINE = ['util', 'defaults', 'generator', 'simulator', 'spl', 'plantuml'];

function loadSS() {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ENGINE) {
    const file = path.join(ROOT, 'js', f + '.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  }
  return ctx.SS;
}

module.exports = { ROOT, loadSS };
