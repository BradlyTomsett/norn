import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL(process.argv.includes('--dist') ? '../dist/' : '../', import.meta.url));
const fixture = process.argv.includes('--fixture');
const port = Number(process.env.NORN_PREVIEW_PORT || 18974);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const target = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative) || (fixture && url.pathname === '/sw.js')) throw new Error('Not found');
    let content = await readFile(target);
    if (fixture && target === path.join(root, 'index.html')) content = Buffer.from(content.toString('utf8').replace('src="app.js"', 'src="tests/browser-fixture.js"'));
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Preview at http://127.0.0.1:${port}${fixture ? ' (synthetic fixtures; no external requests)' : ''}`));
