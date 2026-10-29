// Servidor local sem Netlify CLI: ficheiros estáticos + /api (dados em memória). Só para testar.
process.env.TOTOBOLA_MEM = '1';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import api from '../netlify/functions/api.mjs';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await api(new Request('http://localhost' + req.url, { method: req.method, body: chunks.length ? Buffer.concat(chunks) : undefined }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(Buffer.from(await r.arrayBuffer()));
  }
  const p = req.url.split('?')[0]; const f = join(root, p === '/' ? 'index.html' : p);
  try { const body = await readFile(f); res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('404'); }
}).listen(8888, () => console.log('http://localhost:8888'));
