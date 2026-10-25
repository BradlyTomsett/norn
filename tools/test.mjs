import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);

// 先做语法检查：任何一个模块写坏，手机上就是黑屏，测试必须先拦住
const rootFiles = (await readdir(root)).filter((f) => f.endsWith('.js'));
const engineFiles = (await readdir(new URL('engine/', root))).filter((f) => f.endsWith('.js')).map((f) => `engine/${f}`);
const syntaxTargets = [...rootFiles, ...engineFiles];
let syntaxFailed = 0;
for (const rel of syntaxTargets) {
  const r = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(rel, root))], { encoding: 'utf8' });
  if (r.status !== 0) {
    syntaxFailed += 1;
    console.log(`SYNTAX FAIL ${rel}\n${(r.stderr || '').split('\n').slice(0, 4).join('\n')}`);
  }
}
console.log(`Syntax check: ${syntaxTargets.length - syntaxFailed}/${syntaxTargets.length} ok`);
if (syntaxFailed) process.exitCode = 1;

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
