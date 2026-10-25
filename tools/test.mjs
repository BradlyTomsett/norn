import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
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
