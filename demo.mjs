// Demonstração local com dados FICTÍCIOS (pinos dentro de um parque público, sem casa nenhuma).
// node demo.mjs  -> http://localhost:8787   (apaga e recria demo.db)
import { rmSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { iniciar } from './server.mjs';

// Códigos só da demonstração local. Produção usa `node codigos.mjs`.
export const DEMO = { morador: 'DEMO-MORA', medir: 'DEMO-MEDE', cortar: 'DEMO-CORT', instalar: 'DEMO-INST', coord: 'DEMO-COOR' };

export async function cliente(url, papel, nome, telefone) {
  const r = await fetch(url + '/api/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codigo: DEMO[papel] ?? papel, nome, telefone, aparelho: randomBytes(32).toString('hex') }) });
  if (!r.ok) throw new Error(`${papel}: ${r.status} ${await r.text()}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (metodo, rota, corpo) => {
    const x = await fetch(url + '/api/' + rota, { method: metodo, headers: { cookie, ...(corpo ? { 'content-type': 'application/json' } : {}) }, body: corpo && JSON.stringify(corpo) });
    const t = await x.text();
    return { status: x.status, ...(x.headers.get('content-type')?.includes('json') ? JSON.parse(t) : { corpo: t }) };
  };
}

export async function semear(url) {
  const coord = await cliente(url, 'coord', 'Coord Exemplo'), med = await cliente(url, 'medir', 'Bento Exemplo', '(00) 90000-0101');
  const vid = await cliente(url, 'cortar', 'Vidraçaria Exemplo', '(00) 90000-0202');
  const casas = [
    ['Ana Fictícia', 'Bairro Norte', 'Rua Modelo 10, casa azul', -30.0358, -51.2165, true],
    ['Beto Fictício', 'Bairro Norte', 'Rua Modelo 45, ao lado da escola', -30.0369, -51.2149, false],
    ['Célia Fictícia', 'Centro', 'Av. Exemplo 120', -30.0381, -51.2158, false],
    ['Davi Fictício', 'Centro', 'Rua Teste 7, fundos', -30.0362, -51.2172, false],
    ['Elis Fictícia', 'Bairro Sul', 'Travessa Amostra 3', -30.0376, -51.2178, true],
    ['Fábio Fictício', 'Bairro Sul', 'Perto da caixa d’água, sem número', null, null, false],
  ];
  const ids = [];
  for (const [i, [morador, bairro, endereco, lat, lng, urgente]] of casas.entries()) {
    const id = randomUUID(); ids.push(id);
    const r = await coord('POST', 'pedidos', { id, morador, telefone: `(00) 90000-00${10 + i}`, bairro, endereco, lat, lng, urgente, obs: i === 0 ? 'Cachorro no pátio, chamar no portão' : null });
    if (r.status !== 200) throw new Error(JSON.stringify(r));
  }
  const medidas = [{ nome: 'Janela do quarto', larg: 98.5, alt: 60, qtd: 2, tipo: 'comum', esp: 4 }, { nome: 'Basculante banheiro', larg: 40, alt: 30, qtd: 1, tipo: 'canelado', esp: null, obs: 'Canto quebrado, dá para reaproveitar o baguete' }];
  for (const i of [2, 3, 4]) {
    await med('POST', `pedidos/${ids[i]}/assumir`, {});
    await med('POST', `pedidos/${ids[i]}/concluir`, { op_id: randomUUID(), etapa: 'medir', medidas, obs: 'Levar escada' });
  }
  await vid('POST', `pedidos/${ids[4]}/assumir`, {});
  await vid('POST', `pedidos/${ids[4]}/concluir`, { op_id: randomUUID(), etapa: 'cortar', retirar_em: 'Balcão da vidraçaria exemplo, até 18h' });
  return ids;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = fileURLToPath(new URL('demo.db', import.meta.url));
  for (const s of ['', '-wal', '-shm']) rmSync(db + s, { force: true });
  const s = await iniciar({ porta: Number(process.env.PORT || 8787), dbPath: db, codigos: Object.entries(DEMO).map(x => x.join(':')).join(',') });
  await semear(s.url);
  console.log('Demonstração em', s.url, '\nCódigos:', DEMO);
}
