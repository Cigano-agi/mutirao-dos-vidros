// Cloudflare Worker + D1. Deploy só com OK do Fabrício; passo a passo em DEPLOY.md
import { criarApi, CABECALHOS } from './api.mjs';

const d1 = DB => ({
  async all(sql, ...p) { return (await DB.prepare(sql).bind(...p).all()).results; },
  async run(sql, ...p) { return (await DB.prepare(sql).bind(...p).run()).meta.changes; },
  async batch(l) { return (await DB.batch(l.map(([sql, ...p]) => DB.prepare(sql).bind(...p)))).map(r => r.meta.changes); },
});
let api;
export default {
  async fetch(req, env) {
    if (new URL(req.url).pathname.startsWith('/api/')) {
      api ??= await criarApi({ db: d1(env.DB), codigos: env.CODIGOS, config: { cidade: env.CIDADE, centro: env.CENTRO.split(',').map(Number) } });
      return api(req, req.headers.get('cf-connecting-ip') || 'local');
    }
    const r = await env.ASSETS.fetch(req), h = new Headers(r.headers);
    for (const [k, v] of Object.entries(CABECALHOS)) h.set(k, v);
    return new Response(r.body, { status: r.status, headers: h });
  },
};
