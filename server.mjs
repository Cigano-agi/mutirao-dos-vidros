// Servidor local: node server.mjs  (variáveis: PORT, HOST, CODIGOS, DB, CIDADE, CENTRO)
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { criarApi, CABECALHOS } from './api.mjs';

const AQUI = fileURLToPath(new URL('.', import.meta.url));
const PUB = join(AQUI, 'public') + sep;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/manifest+json', '.svg': 'image/svg+xml' };

export function abrirDb(caminho) {
  const s = new DatabaseSync(caminho);
  s.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  s.exec(readFileSync(join(AQUI, 'schema.sql'), 'utf8'));
  return {
    async all(sql, ...p) { return s.prepare(sql).all(...p); },
    async run(sql, ...p) { return Number(s.prepare(sql).run(...p).changes); },
    async batch(lista) { // síncrono por dentro: nada se intercala no meio da transação
      s.exec('BEGIN IMMEDIATE');
      try { const r = lista.map(([sql, ...p]) => Number(s.prepare(sql).run(...p).changes)); s.exec('COMMIT'); return r; }
      catch (e) { s.exec('ROLLBACK'); throw e; }
    },
    fechar: () => s.close(),
  };
}

const lerConfig = env => ({ cidade: env.CIDADE || 'Cidade Exemplo', centro: (env.CENTRO || '-30.0375,-51.2140').split(',').map(Number) });

export async function iniciar({ porta = 8787, dbPath = 'mutirao.db', codigos, env = process.env, agora, host = '127.0.0.1' }) {
  const db = abrirDb(dbPath);
  const api = await criarApi({ db, codigos, config: lerConfig(env), agora });
  const srv = http.createServer(async (rq, rs) => {
    try {
      const url = new URL(rq.url, `http://${rq.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) {
        const pedacos = []; let total = 0;
        for await (const c of rq) { total += c.length; if (total > 700000) { rs.writeHead(413).end(); return; } pedacos.push(c); }
        const r = await api(new Request(url, { method: rq.method, headers: rq.headers, body: pedacos.length ? Buffer.concat(pedacos) : undefined }), rq.socket.remoteAddress);
        rs.writeHead(r.status, Object.fromEntries(r.headers)); rs.end(Buffer.from(await r.arrayBuffer())); return;
      }
      const rel = normalize(url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)).replace(/^[\\/]+/, '');
      const arq = join(PUB, rel);
      if (!arq.startsWith(PUB) || !existsSync(arq) || !statSync(arq).isFile()) { rs.writeHead(404, CABECALHOS).end('Não encontrado'); return; }
      const h = { ...CABECALHOS, 'content-type': MIME[extname(arq)] || 'application/octet-stream', 'cache-control': rel.startsWith('vendor') ? 'public, max-age=2592000' : 'no-cache' };
      let corpo = readFileSync(arq);
      if (/gzip/.test(rq.headers['accept-encoding'] || '')) { corpo = gzipSync(corpo); h['content-encoding'] = 'gzip'; }
      rs.writeHead(200, h); rs.end(corpo);
    } catch (e) { console.error(e); if (!rs.headersSent) rs.writeHead(500); rs.end(); }
  });
  await new Promise((ok, erro) => { srv.once('error', erro); srv.listen(porta, host, ok); });
  return { url: `http://localhost:${srv.address().port}`, db, parar: () => new Promise(ok => { srv.close(() => { db.fechar(); ok(); }); srv.closeAllConnections(); }) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await iniciar({ porta: Number(process.env.PORT || 8787), dbPath: process.env.DB || join(AQUI, 'mutirao.db'), codigos: process.env.CODIGOS, host: process.env.HOST || '127.0.0.1' });
  console.log('Mutirão dos Vidros em', s.url);
}
