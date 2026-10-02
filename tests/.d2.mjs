import fs from 'node:fs';
import * as espree from 'espree';
import * as eslintScope from 'eslint-scope';
const src = fs.readFileSync('www/js/app.js', 'utf8');
const ast = espree.parse(src, { ecmaVersion: 2022, sourceType: 'module', range: true, loc: true });
const sm = eslintScope.analyze(ast, { ecmaVersion: 2022, sourceType: 'module' });
const iife = sm.scopes.find((s) => s.type === 'function' && s.block.type === 'FunctionExpression' && s.upper && s.upper.type === 'module');
for (const name of process.argv.slice(2)) {
  const v = iife.set.get(name); if (!v) { console.log(name, 'MISSING'); continue; }
  const node = v.defs[0].node; const range = (v.defs[0].type === 'Variable' ? v.defs[0].parent : node).range;
  const deps = new Set(), glob = new Set();
  for (const s of sm.scopes) { if (s.block.range[0] < range[0] || s.block.range[1] > range[1]) continue;
    for (const r of s.references) { const n = r.identifier.name;
      if (r.resolved && r.resolved.scope === iife && n !== name) deps.add(n);
      else if (!r.resolved || r.resolved.scope.type === 'global') glob.add(n); } }
  const users = [];
  for (const r of v.references) { const id = r.identifier; if (id.range[0] >= range[0] && id.range[1] <= range[1]) continue; users.push(id.loc.start.line); }
  console.log(`${name} (${node.loc.start.line}, ${node.loc.end.line - node.loc.start.line + 1}L) deps: ${[...deps].join(', ')} | globals: ${[...glob].filter((g) => !/^(Math|String|Number|Array|Object|JSON|Date|Promise|Boolean|isFinite|parseFloat|parseInt|Set|Map|Error)$/.test(g)).join(', ')} | used at: ${users.length} places`);
}
