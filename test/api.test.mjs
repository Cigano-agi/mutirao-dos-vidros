// node --test test/api.test.mjs            -> sobe servidor Node + SQLite próprio
// BASE=http://localhost:8799 node --test … -> roda contra um servidor já no ar (ex.: wrangler dev com D1 local)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliente, DEMO } from '../demo.mjs';

const CODIGOS = Object.entries(DEMO).map(x => x.join(':')).join(',');
const externo = process.env.BASE;
const JPEG = '/9j/4AAQSkZJRgABAQ=='; // só o começo de um JPEG, basta para o servidor
let url = externo, srv, dir, relogio = 0;

before(async () => {
  if (externo) return;
  const { iniciar } = await import('../server.mjs');
  dir = mkdtempSync(join(tmpdir(), 'vidros-'));
  srv = await iniciar({ porta: 0, dbPath: join(dir, 't.db'), codigos: CODIGOS, agora: () => Date.now() + relogio });
  url = srv.url;
});
after(async () => { if (srv) { await srv.parar(); rmSync(dir, { recursive: true, force: true }); } });

const novo = (extra = {}) => ({ id: randomUUID(), morador: 'Morador Fictício', telefone: '(00) 9' + String(Math.random()).slice(2, 10), bairro: 'Centro', endereco: 'Rua Teste SEGREDO 99', lat: -30.0371 - Math.random() / 100, lng: -51.2141 - Math.random() / 100, obs: 'Obs SEGREDO', ...extra });
const medidas = [{ nome: 'Janela', larg: 98.5, alt: 60, qtd: 2, tipo: 'comum', esp: 4 }];
const op = () => randomUUID();
const ok = (r, msg) => { assert.equal(r.status, 200, (msg || '') + ' ' + JSON.stringify(r)); return r; };

test('fluxo completo: morador pede, mede, corta, instala, concluído', async () => {
  const mor = await cliente(url, 'morador', 'Moradora'), med = await cliente(url, 'medir', 'Bento', '(00) 90000-0101');
  const cor = await cliente(url, 'cortar', 'Vidraceiro', '(00) 90000-0202'), ins = await cliente(url, 'instalar', 'Ivo');
  const p = novo({ foto: JPEG }), R = `pedidos/${p.id}`;
  ok(await mor('POST', 'pedidos', p));
  // ninguém pula etapa
  assert.equal((await cor('POST', R + '/assumir', {})).status, 403);
  assert.equal((await med('POST', R + '/concluir', { op_id: op(), etapa: 'medir', medidas })).status, 409, 'concluir sem trava');
  ok(await med('POST', R + '/assumir', {}));
  assert.equal((await med('POST', R + '/concluir', { op_id: op(), etapa: 'medir', medidas: [] })).status, 400, 'sem vão');
  assert.equal((await med('POST', R + '/concluir', { op_id: op(), etapa: 'medir', medidas: [{ ...medidas[0], larg: 985 }] })).status, 400, 'medida em mm');
  ok(await med('POST', R + '/concluir', { op_id: op(), etapa: 'medir', medidas, obs: 'levar escada', foto: JPEG }));
  ok(await cor('POST', R + '/assumir', {}));
  const visto = ok(await cor('GET', R));
  assert.deepEqual(visto.medidas.map(m => [m.larg, m.alt, m.qtd, m.esp]), [[98.5, 60, 2, 4]]);
  assert.equal(visto.historico.find(h => h.etapa === 'medir').obs, 'levar escada');
  assert.equal(visto.historico.find(h => h.etapa === 'medir').telefone, '(00) 90000-0101');
  assert.equal((await cor('POST', R + '/concluir', { op_id: op(), etapa: 'cortar' })).status, 400, 'sem local de retirada');
  ok(await cor('POST', R + '/concluir', { op_id: op(), etapa: 'cortar', retirar_em: 'Balcão 1' }));
  ok(await ins('POST', R + '/assumir', {}));
  const inst = ok(await ins('GET', R));
  assert.equal(inst.retirar_em, 'Balcão 1'); assert.equal(inst.telefone, p.telefone); assert.equal(inst.endereco, p.endereco);
  ok(await ins('POST', R + '/concluir', { op_id: op(), etapa: 'instalar' }));
  const fim = (ok(await mor('GET', 'pedidos'))).pedidos.find(x => x.id === p.id);
  assert.equal(fim.etapa, 'concluido');
  assert.equal((await ins('POST', R + '/assumir', {})).status, 409);
});

test('conflito: 20 pessoas tocam "estou indo" ao mesmo tempo, só uma fica', async () => {
  const c = await cliente(url, 'coord', 'C'), p = novo(), R = `pedidos/${p.id}`;
  ok(await c('POST', 'pedidos', p));
  const gente = await Promise.all(Array.from({ length: 20 }, (_, i) => cliente(url, 'medir', `Vol${i} Sobrenome`)));
  const rs = await Promise.all(gente.map(g => g('POST', R + '/assumir', {})));
  const ganhou = rs.filter(r => r.status === 200), perdeu = rs.filter(r => r.status === 409);
  assert.equal(ganhou.length, 1); assert.equal(perdeu.length, 19);
  const i = rs.indexOf(ganhou[0]);
  assert.ok(perdeu.every(r => r.motivo === 'trava' && r.dono === `Vol${i}`), 'quem perdeu vê quem está indo');
  const outro = gente[(i + 1) % 20];
  assert.equal((await outro('POST', R + '/concluir', { op_id: op(), etapa: 'medir', medidas })).status, 409);
  assert.equal((await outro('POST', R + '/soltar', {})).status, 409, 'não solta a trava alheia');
  ok(await c('POST', R + '/soltar', {}), 'coordenação libera');
  ok(await outro('POST', R + '/assumir', {}));
});

test('reenvio com rede ruim não duplica: criar e concluir são idempotentes', async () => {
  const c = await cliente(url, 'coord', 'C'), med = await cliente(url, 'medir', 'M'), p = novo(), R = `pedidos/${p.id}`;
  const ns = await Promise.all([1, 2, 3].map(() => c('POST', 'pedidos', p)));
  assert.equal(new Set(ns.map(n => ok(n).numero)).size, 1);
  ok(await med('POST', R + '/assumir', {}));
  const envio = { op_id: op(), etapa: 'medir', medidas };
  const rs = await Promise.all([1, 2, 3].map(() => med('POST', R + '/concluir', envio)));
  rs.forEach(r => ok(r));
  ok(await med('POST', R + '/concluir', envio), 'reenvio tardio');
  const h = ok(await c('GET', R));
  assert.equal(h.historico.filter(x => x.acao === 'concluir').length, 1);
  const tarde = await med('POST', R + '/concluir', { op_id: op(), etapa: 'medir', medidas });
  assert.equal(tarde.status, 409); assert.equal(tarde.motivo, 'etapa');
});

test('sem código não entra em nada', async () => {
  const p = novo(), c = await cliente(url, 'coord', 'C'); ok(await c('POST', 'pedidos', p));
  const J = { 'content-type': 'application/json' };
  for (const [m, rota] of [['GET', 'eu'], ['GET', 'pedidos'], ['GET', `pedidos/${p.id}`], ['GET', `fotos/${p.id}`], ['POST', 'pedidos'], ...['assumir', 'soltar', 'concluir', 'devolver', 'cancelar', 'urgente'].map(a => ['POST', `pedidos/${p.id}/${a}`])]) {
    for (const cookie of [undefined, 's=' + '0'.repeat(64), "s=' OR 1=1 --"]) {
      const r = await fetch(`${url}/api/${rota}`, { method: m, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: m === 'POST' ? '{}' : undefined });
      const t = await r.text();
      assert.equal(r.status, 401, `${m} ${rota}`); assert.ok(!/SEGREDO|Centro|-30/.test(t));
    }
  }
  const r = await fetch(url + '/api/entrar', { method: 'POST', headers: J, body: JSON.stringify({ codigo: 'ERRADO-1', nome: 'X', aparelho: randomBytes(32).toString('hex') }) });
  assert.equal(r.status, 401);
  const csrf = await fetch(url + '/api/entrar', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(csrf.status, 415);
});

test('privacidade: cada função só enxerga o necessário', async () => {
  const mor = await cliente(url, 'morador', 'Dona'), mor2 = await cliente(url, 'morador', 'Outro'), med = await cliente(url, 'medir', 'M'), med2 = await cliente(url, 'medir', 'M2');
  const cor = await cliente(url, 'cortar', 'V'), ins = await cliente(url, 'instalar', 'I'), c = await cliente(url, 'coord', 'C');
  const p = novo({ foto: JPEG }), R = `pedidos/${p.id}`;
  ok(await mor('POST', 'pedidos', p));
  const limpo = (r, quem) => { const s = JSON.stringify(r); for (const x of [p.telefone, 'SEGREDO', String(p.lat), String(p.lng), p.morador]) assert.ok(!s.includes(x), `${quem} viu ${x}`); };
  limpo(await med('GET', 'pedidos'), 'medidor (lista)'); limpo(await med('GET', R), 'medidor sem assumir');
  limpo(await ins('GET', R), 'instalador'); limpo(await cor('GET', R), 'vidraçaria'); limpo(await cor('GET', 'pedidos'), 'vidraçaria lista');
  assert.equal((await mor2('GET', R)).status, 404); limpo(await mor2('GET', 'pedidos'), 'outro morador');
  assert.equal((await mor2('POST', R + '/cancelar', {})).status, 404);
  assert.equal((await med('POST', R + '/cancelar', {})).status, 403);
  assert.ok(!JSON.stringify(await c('GET', R)).includes(p.telefone), 'coordenação só vê telefone se assumir');
  assert.equal((await med('GET', `fotos/${p.id}`)).status, 404, 'foto antes de assumir');
  const v = (ok(await med('GET', 'pedidos'))).pedidos.find(x => x.id === p.id);
  const m = Math.hypot(v.lat - p.lat, v.lng - p.lng); assert.ok(m > 0 && m < .0015, 'ponto aproximado');
  ok(await med('POST', R + '/assumir', {}));
  const cheio = ok(await med('GET', R));
  assert.equal(cheio.telefone, p.telefone); assert.equal(cheio.endereco, p.endereco); assert.equal(cheio.lat, p.lat);
  assert.equal((await med('GET', `fotos/${p.id}`)).status, 200);
  limpo(await med2('GET', R), 'segundo medidor');
  ok(await med('POST', R + '/concluir', { op_id: op(), etapa: 'medir', medidas }));
  limpo(await med('GET', R), 'medidor depois de concluir');
  ok(await cor('POST', R + '/assumir', {})); limpo(await cor('GET', R), 'vidraçaria com a trava');
  assert.equal((await cor('GET', `fotos/${p.id}`)).status, 404, 'foto da casa não vai para a vidraçaria');
});

test('devolver com motivo e aviso de possível repetido', async () => {
  const c = await cliente(url, 'coord', 'C'), med = await cliente(url, 'medir', 'M'), cor = await cliente(url, 'cortar', 'V');
  const p = novo(), R = `pedidos/${p.id}`; ok(await c('POST', 'pedidos', p));
  ok(await med('POST', R + '/assumir', {})); ok(await med('POST', R + '/concluir', { op_id: op(), etapa: 'medir', medidas }));
  ok(await cor('POST', R + '/assumir', {}));
  assert.equal((await cor('POST', R + '/devolver', { op_id: op(), para: 'instalar', motivo: 'x' })).status, 400);
  ok(await cor('POST', R + '/devolver', { op_id: op(), para: 'medir', motivo: 'altura não bate' }));
  ok(await med('POST', R + '/assumir', {}));
  assert.equal(ok(await med('GET', R)).historico.at(-1).obs, 'altura não bate');
  const d = novo({ telefone: p.telefone }); ok(await c('POST', 'pedidos', d));
  assert.equal(ok(await c('GET', `pedidos/${d.id}`)).duplicado, true);
});

test('limite de 3 casas por pessoa', async () => {
  const c = await cliente(url, 'coord', 'C'), med = await cliente(url, 'medir', 'M');
  const ps = [novo(), novo(), novo(), novo()]; for (const p of ps) ok(await c('POST', 'pedidos', p));
  for (const p of ps.slice(0, 3)) ok(await med('POST', `pedidos/${p.id}/assumir`, {}));
  assert.equal((await med('POST', `pedidos/${ps[3].id}/assumir`, {})).status, 429);
});

test('trava vencida: outro assume; quem perdeu não sobrescreve', { skip: externo && 'precisa do relógio de teste' }, async () => {
  const c = await cliente(url, 'coord', 'C'), a = await cliente(url, 'medir', 'A'), b = await cliente(url, 'medir', 'B');
  const p = novo(), R = `pedidos/${p.id}`; ok(await c('POST', 'pedidos', p));
  ok(await a('POST', R + '/assumir', {}));
  assert.equal((await b('POST', R + '/assumir', {})).status, 409);
  relogio += 2 * 3600e3 + 1000;
  ok(await b('POST', R + '/assumir', {}));
  const r = await a('POST', R + '/concluir', { op_id: op(), etapa: 'medir', medidas });
  assert.equal(r.status, 409); assert.equal(r.motivo, 'trava'); assert.equal(r.dono, 'B');
  // trava vencida que ninguém pegou: quem estava sem sinal ainda consegue entregar
  const p2 = novo(), R2 = `pedidos/${p2.id}`; ok(await c('POST', 'pedidos', p2));
  ok(await a('POST', R2 + '/assumir', {})); relogio += 3 * 3600e3;
  ok(await a('POST', R2 + '/concluir', { op_id: op(), etapa: 'medir', medidas }));
});

test('código trocado derruba quem entrou com o antigo', { skip: externo && 'precisa reiniciar o servidor' }, async () => {
  const { criarApi } = await import('../api.mjs');
  const entrar = await fetch(url + '/api/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codigo: DEMO.medir, nome: 'Z', aparelho: randomBytes(32).toString('hex') }) });
  const cookie = entrar.headers.get('set-cookie').split(';')[0];
  const nova = await criarApi({ db: srv.db, codigos: 'medir:NOVO-CODE' });
  assert.equal((await nova(new Request('http://x/api/eu', { headers: { cookie } }), 'ip')).status, 401);
  await assert.rejects(criarApi({ db: srv.db, codigos: '' })); await assert.rejects(criarApi({ db: srv.db, codigos: 'medir:123' }));
});

test('chute de código bloqueia depois de 30 erros', async () => {
  const tenta = codigo => fetch(url + '/api/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codigo, nome: 'X', aparelho: randomBytes(32).toString('hex') }) });
  let ultimo; for (let i = 0; i < 32; i++) ultimo = (await tenta('CHUTE-' + i)).status;
  assert.equal(ultimo, 429);
  assert.equal((await tenta(DEMO.coord)).status, 429);
});
