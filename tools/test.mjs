import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
// Include the application entry point; engine imports alone do not check it.
const syntax = spawnSync(process.execPath, ['--check', fileURLToPath(new URL('app.js', root))], { encoding: 'utf8' });
if (syntax.status !== 0) throw new Error(syntax.stderr || 'app.js syntax check failed');
let count = 0;
for (const name of ['engine-test', 'format-test', 'chronicle-test', 'views-test']) {
  const nodes = new Map();
  globalThis.document = { getElementById: id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); } };
  const source = await readFile(new URL(`tests/${name}.html`, root), 'utf8');
  const body = source.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
    .replace(/from (['"])(\.\.\/[^'"]+)\1/g, (_, q, p) => `from ${q}${new URL(p, new URL('tests/', root)).href}${q}`);
  await import(`data:text/javascript;base64,${Buffer.from(body).toString('base64')}`);
  const output = nodes.get('out')?.textContent || '';
  const failed = output.split('\n').filter(l => /^(FAIL|EXCEPTION)/.test(l));
  const passed = (output.match(/^PASS /gm) || []).length;
  console.log(`${name}: ${passed} passed${failed.length ? `, ${failed.length} failed\n${failed.join('\n')}` : ''}`);
  count += passed;
  if (failed.length) process.exitCode = 1;
}
delete globalThis.document;
console.log(`Browser-compatible checks: ${count} passed`);
