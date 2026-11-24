// API do mutirão. Mesma lógica em Node (node:sqlite) e em Cloudflare Workers (D1).
// db: { all(sql, ...p) -> linhas, run(sql, ...p) -> nº de linhas mudadas, batch([[sql, ...p]]) atômico -> [mudadas] }

export const ETAPAS = ['medir', 'cortar', 'instalar', 'concluido'];
export const PAPEIS = ['morador', 'medir', 'cortar', 'instalar', 'coord'];
const HORA = 3600e3;
const VALIDADE = { medir: 2 * HORA, cortar: 24 * HORA, instalar: 3 * HORA };
const MAX_COMIGO = 3; // casas ao mesmo tempo; freia quem quiser abrir todos os endereços
const MAX_ERROS = 30, JANELA_ERROS = 15 * 60e3; // alto de propósito: muita gente pode sair pelo mesmo IP; o código tem 31^8 combinações
const TIPOS = ['comum', 'canelado', 'temperado', 'laminado', 'nao_sei'];
const ESPESSURAS = [2, 3, 4, 5, 6, 8, 10];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class Erro extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
const falha = (s, m, x) => { throw new Erro(s, m, x); };

const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha = async t => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
const normCodigo = c => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** "medir:ABCD-EFGH,cortar:..." -> Map(hash -> papel). Código curto é erro de configuração. */
async function lerCodigos(txt) {
  const m = new Map();
  for (const par of String(txt ?? '').split(',').filter(Boolean)) {
    const [papel, cod] = par.split(':').map(s => s.trim());
    const n = normCodigo(cod);
    if (!PAPEIS.includes(papel) || n.length < 8) throw new Error(`CODIGOS inválido para "${papel}" (mínimo 8 letras/números)`);
    m.set(await sha('c:' + n), papel);
  }
  if (!m.size) throw new Error('CODIGOS não configurado. Rode: node codigos.mjs');
  return m;
}

const texto = (v, max, campo, obrig) => {
  if (v == null || v === '') { if (obrig) falha(400, `Falta: ${campo}`); return null; }
  if (typeof v !== 'string') falha(400, `${campo} inválido`);
  const t = v.trim();
  if (obrig && !t) falha(400, `Falta: ${campo}`);
  if (t.length > max) falha(400, `${campo}: no máximo ${max} letras`);
  return t || null;
};
const digitos = t => String(t ?? '').replace(/\D/g, '');
const primeiro = n => (n || '').split(' ')[0];

function ponto(b) {
  if (b.lat == null && b.lng == null) return [null, null];
  const { lat, lng } = b;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) falha(400, 'Ponto no mapa inválido');
  return [lat, lng];
}

function validarMedidas(ms) {
  if (!Array.isArray(ms) || !ms.length || ms.length > 60) falha(400, 'Anote pelo menos um vão');
  return ms.map((m, i) => {
    const n = `Vão ${i + 1}`;
    if (!m || typeof m !== 'object') falha(400, `${n} inválido`);
    const larg = Number(m.larg), alt = Number(m.alt), qtd = Number(m.qtd ?? 1);
    if (!(larg >= 1 && larg <= 400) || !(alt >= 1 && alt <= 400)) falha(400, `${n}: largura e altura em centímetros (1 a 400)`);
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > 50) falha(400, `${n}: quantidade inválida`);
    if (!TIPOS.includes(m.tipo)) falha(400, `${n}: escolha o tipo de vidro`);
    const esp = m.esp ? Number(m.esp) : null;
    if (esp !== null && !ESPESSURAS.includes(esp)) falha(400, `${n}: espessura inválida`);
    return { nome: texto(m.nome, 60, `${n}: nome`) || n, larg, alt, qtd, tipo: m.tipo, esp, obs: texto(m.obs, 200, `${n}: observação`) };
  });
}

function validarFoto(f) {
  if (f == null || f === '') return null;
  if (typeof f !== 'string' || f.length > 420000 || !/^\/9j\/[A-Za-z0-9+/]+=*$/.test(f)) falha(400, 'Foto inválida ou grande demais');
  return f;
}

// Ponto aproximado: célula de ~110 m, com deslocamento por número para os pinos não se empilharem.
const aprox = (v, n, k) => v == null ? null : (Math.floor(v * 1000) + ((n * k) % 1)) / 1000;

function visao(p, eu, agora) {
  const meu = p.dono === eu.id, ativo = p.dono && (meu || p.dono_ate > agora);
  const criei = p.criado_por === eu.id, coord = eu.papel === 'coord', corta = eu.papel === 'cortar';
  const medidas = p.medidas ? JSON.parse(p.medidas) : null;
  const v = {
    id: p.id, numero: p.numero, etapa: p.etapa, urgente: !!p.urgente, bairro: p.bairro, criado_em: p.criado_em,
    dono: ativo ? { nome: primeiro(p.dono_nome), desde: p.dono_desde, ate: p.dono_ate, meu } : null,
    criei, vaos: medidas ? medidas.reduce((s, m) => s + m.qtd, 0) : null,
  };
  // A vidraçaria corta pelo número do pedido: não precisa saber onde é a casa.
  if (!corta && (coord || meu || (criei && eu.papel === 'morador'))) Object.assign(v, { endereco: p.endereco, lat: p.lat, lng: p.lng, obs: p.obs, morador: p.morador });
  else if (['medir', 'instalar'].includes(eu.papel)) Object.assign(v, { lat: aprox(p.lat, p.numero, .618), lng: aprox(p.lng, p.numero, .414), aprox: true });
  if (meu && !corta) v.telefone = p.telefone; // telefone do morador: só quem assumiu
  if (coord || meu || corta) v.medidas = medidas;
  if (coord || meu) v.retirar_em = p.retirar_em;
  if (coord) v.duplicado = !!p.duplicado;
  return v;
}

const SELECT = 'SELECT p.*, d.nome AS dono_nome FROM pedidos p LEFT JOIN pessoas d ON d.id = p.dono';
const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });

export async function criarApi({ db, codigos, config = {}, agora = () => Date.now() }) {
  const mapa = await lerCodigos(codigos);

  async function quem(req) {
    const tok = /(?:^|;\s*)s=([0-9a-f]{64})/.exec(req.headers.get('cookie') || '')?.[1];
    if (!tok) falha(401, 'Entre com o código do mutirão');
    const [eu] = await db.all('SELECT id, nome, papel, cod_hash FROM pessoas WHERE token_hash = ?', await sha('t:' + tok));
    // trocar um código na configuração derruba quem entrou com o antigo
    if (!eu || mapa.get(eu.cod_hash) !== eu.papel) falha(401, 'Código trocado ou sessão vencida. Entre de novo');
    return eu;
  }
  const um = async id => (await db.all(SELECT + ' WHERE p.id = ?', id))[0] || falha(404, 'Pedido não encontrado');
  const podeVer = (p, eu) => eu.papel !== 'morador' || p.criado_por === eu.id || falha(404, 'Pedido não encontrado');
  const evento = (op, p, eu, acao, etapa, obs, t) =>
    ['INSERT OR IGNORE INTO eventos (op_id,pedido,pessoa,acao,etapa,obs,em) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM pedidos WHERE id=? AND ultima_op=?)',
      op, p, eu, acao, etapa, obs, t, p, op];
  const jaFeito = async (op, pedido, acao) => {
    const [e] = await db.all('SELECT pedido, acao FROM eventos WHERE op_id = ?', op);
    if (e && (e.pedido !== pedido || e.acao !== acao)) falha(409, 'Identificador de envio repetido');
    return !!e;
  };

  function conflito(p, eu, t, etapaEsperada) {
    if (p.etapa !== etapaEsperada) return new Erro(409, 'Esta casa já passou para outra etapa', { motivo: 'etapa', etapa: p.etapa });
    if (p.dono && p.dono !== eu.id && p.dono_ate > t) return new Erro(409, `${primeiro(p.dono_nome) || 'Outra pessoa'} já está nesta casa`, { motivo: 'trava', dono: primeiro(p.dono_nome), desde: p.dono_desde });
    return new Erro(409, 'A casa não está mais com você. Toque em "Estou indo" de novo antes de enviar', { motivo: 'sem_trava' });
  }
  const daFuncao = (p, eu) => {
    if (!ETAPAS.slice(0, 3).includes(p.etapa)) falha(409, 'Este pedido já foi encerrado', { motivo: 'etapa' });
    if (eu.papel !== 'coord' && eu.papel !== p.etapa) falha(403, 'Esta etapa é de outra função');
  };

  const acoes = {
    async assumir(p, eu, b, t) {
      daFuncao(p, eu);
      if (eu.papel !== 'cortar' && p.dono !== eu.id) {
        const [{ n }] = await db.all("SELECT count(*) AS n FROM pedidos WHERE dono=? AND dono_ate>? AND etapa IN ('medir','instalar')", eu.id, t);
        if (n >= MAX_COMIGO) falha(429, `Você já está com ${MAX_COMIGO} casas. Conclua ou solte uma antes`);
      }
      const op = crypto.randomUUID();
      // A trava é este UPDATE: de dois pedidos simultâneos, só um passa pela condição.
      const [n] = await db.batch([
        ['UPDATE pedidos SET dono=?, dono_desde=CASE WHEN dono=? THEN dono_desde ELSE ? END, dono_ate=?, ultima_op=? WHERE id=? AND etapa=? AND (dono IS NULL OR dono=? OR dono_ate<=?)',
          eu.id, eu.id, t, t + VALIDADE[p.etapa], op, p.id, p.etapa, eu.id, t],
        evento(op, p.id, eu.id, 'assumir', p.etapa, null, t)]);
      if (!n) throw conflito(await um(p.id), eu, t, p.etapa);
    },
    async soltar(p, eu, b, t) {
      const op = crypto.randomUUID();
      const [n] = await db.batch([
        ['UPDATE pedidos SET dono=NULL, dono_desde=NULL, dono_ate=NULL, ultima_op=? WHERE id=? AND (dono=? OR ?=1)', op, p.id, eu.id, eu.papel === 'coord' ? 1 : 0],
        evento(op, p.id, eu.id, 'soltar', p.etapa, null, t)]);
      if (!n) falha(409, 'Esta casa não está com você', { motivo: 'sem_trava' });
    },
    async concluir(p, eu, b, t) {
      if (!UUID.test(b.op_id ?? '')) falha(400, 'op_id inválido');
      if (!ETAPAS.slice(0, 3).includes(b.etapa)) falha(400, 'etapa inválida');
      if (await jaFeito(b.op_id, p.id, 'concluir')) return; // reenvio do celular: já estava gravado
      if (p.etapa !== b.etapa) throw conflito(p, eu, t, b.etapa);
      daFuncao(p, eu);
      const obs = texto(b.obs, 500, 'Observação'), foto = validarFoto(b.foto);
      const medidas = b.etapa === 'medir' ? JSON.stringify(validarMedidas(b.medidas)) : null;
      const retirar = b.etapa === 'cortar' ? texto(b.retirar_em, 200, 'Onde retirar', true) : null;
      const prox = ETAPAS[ETAPAS.indexOf(b.etapa) + 1];
      const lista = [
        ['UPDATE pedidos SET etapa=?, medidas=COALESCE(?,medidas), retirar_em=COALESCE(?,retirar_em), dono=NULL, dono_desde=NULL, dono_ate=NULL, ultima_op=? WHERE id=? AND etapa=? AND dono=?',
          prox, medidas, retirar, b.op_id, p.id, b.etapa, eu.id],
        evento(b.op_id, p.id, eu.id, 'concluir', b.etapa, obs, t)];
      if (foto) lista.push(['INSERT OR IGNORE INTO fotos (id,pedido,etapa,jpeg64,em) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM pedidos WHERE id=? AND ultima_op=?)', b.op_id, p.id, b.etapa, foto, t, p.id, b.op_id]);
      const [n] = await db.batch(lista);
      if (!n && !(await jaFeito(b.op_id, p.id, 'concluir'))) throw conflito(await um(p.id), eu, t, b.etapa);
    },
    async devolver(p, eu, b, t) {
      if (!UUID.test(b.op_id ?? '')) falha(400, 'op_id inválido');
      if (await jaFeito(b.op_id, p.id, 'devolver')) return;
      daFuncao(p, eu);
      const i = ETAPAS.indexOf(b.para);
      if (i < 0 || i >= ETAPAS.indexOf(p.etapa)) falha(400, 'Só dá para devolver a uma etapa anterior');
      const motivo = texto(b.motivo, 500, 'Motivo', true);
      const [n] = await db.batch([
        ['UPDATE pedidos SET etapa=?, dono=NULL, dono_desde=NULL, dono_ate=NULL, ultima_op=? WHERE id=? AND etapa=? AND dono=?', b.para, b.op_id, p.id, p.etapa, eu.id],
        evento(b.op_id, p.id, eu.id, 'devolver', p.etapa, motivo, t)]);
      if (!n) throw conflito(await um(p.id), eu, t, p.etapa);
    },
    async cancelar(p, eu, b, t) {
      if (eu.papel !== 'coord' && p.criado_por !== eu.id) falha(403, 'Só a coordenação ou quem cadastrou pode cancelar');
      const op = crypto.randomUUID();
      const [n] = await db.batch([
        ["UPDATE pedidos SET etapa='cancelado', dono=NULL, dono_desde=NULL, dono_ate=NULL, ultima_op=? WHERE id=? AND etapa NOT IN ('concluido','cancelado')", op, p.id],
        evento(op, p.id, eu.id, 'cancelar', p.etapa, texto(b.motivo, 300, 'Motivo'), t)]);
      if (!n) falha(409, 'Este pedido já foi encerrado', { motivo: 'etapa' });
    },
    async urgente(p, eu, b) {
      if (eu.papel !== 'coord') falha(403, 'Só a coordenação');
      await db.run('UPDATE pedidos SET urgente=? WHERE id=?', b.urgente ? 1 : 0, p.id);
    },
  };

  async function entrar(b, ip, t, https) {
    const chave = await sha('ip:' + ip);
    await db.run('DELETE FROM tentativas WHERE em < ?', t - JANELA_ERROS);
    const [{ n }] = await db.all('SELECT count(*) AS n FROM tentativas WHERE ip = ?', chave);
    if (n >= MAX_ERROS) falha(429, 'Muitas tentativas. Espere 15 minutos');
    const ch = await sha('c:' + normCodigo(b.codigo)), papel = mapa.get(ch);
    if (!papel) {
      await db.run('INSERT INTO tentativas (ip,em) VALUES (?,?)', chave, t);
      falha(401, 'Código não confere');
    }
    const nome = texto(b.nome, 60, 'Seu nome', true), tel = texto(b.telefone, 20, 'Telefone');
    if (typeof b.aparelho !== 'string' || !/^[0-9a-f]{64}$/.test(b.aparelho)) falha(400, 'Aparelho inválido');
    const id = await sha('p:' + b.aparelho), tok = hex(crypto.getRandomValues(new Uint8Array(32)));
    await db.run(`INSERT INTO pessoas (id,nome,telefone,papel,cod_hash,token_hash,criado_em) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, telefone=excluded.telefone, papel=excluded.papel, cod_hash=excluded.cod_hash, token_hash=excluded.token_hash`,
    id, nome, tel, papel, ch, await sha('t:' + tok), t);
    return json({ nome, papel, config }, 200, { 'set-cookie': `s=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${https ? '; Secure' : ''}` });
  }

  async function criar(b, eu, t) {
    if (!UUID.test(b.id ?? '')) falha(400, 'id inválido');
    const [ja] = await db.all('SELECT numero FROM pedidos WHERE id = ?', b.id);
    if (ja) return { ok: true, numero: ja.numero }; // reenvio do celular
    const [lat, lng] = ponto(b), tel = texto(b.telefone, 20, 'Telefone', true), dig = digitos(tel);
    if (dig.length < 8) falha(400, 'Telefone incompleto');
    const foto = validarFoto(b.foto);
    const campos = [texto(b.morador, 60, 'Nome do morador', true), tel, texto(b.bairro, 60, 'Bairro', true), texto(b.endereco, 200, 'Endereço ou referência', true), lat, lng, texto(b.obs, 500, 'Observação')];
    // Possível repetido: mesmo telefone ou ponto a ~15 m. Só avisa a coordenação; não bloqueia (prédio, vizinho).
    // ponytail: varre os ativos a cada cadastro; coluna indexada se passar de alguns milhares.
    const ativos = await db.all("SELECT telefone, lat, lng FROM pedidos WHERE etapa NOT IN ('concluido','cancelado')");
    const dup = ativos.some(a => digitos(a.telefone).slice(-8) === dig.slice(-8) || (lat != null && a.lat != null && Math.abs(a.lat - lat) < .00014 && Math.abs(a.lng - lng) < .00014)) ? 1 : 0;
    const lista = [
      ["INSERT OR IGNORE INTO pedidos (id,etapa,urgente,duplicado,morador,telefone,bairro,endereco,lat,lng,obs,criado_por,criado_em,ultima_op) VALUES (?,'medir',?,?,?,?,?,?,?,?,?,?,?,?)",
        b.id, b.urgente === true ? 1 : 0, dup, ...campos, eu.id, t, b.id],
      evento(b.id, b.id, eu.id, 'criar', 'pedido', null, t)];
    if (foto) lista.push(["INSERT OR IGNORE INTO fotos (id,pedido,etapa,jpeg64,em) VALUES (?,?,'pedido',?,?)", b.id, b.id, foto, t]);
    await db.batch(lista);
    return { ok: true, numero: (await um(b.id)).numero };
  }

  async function rota(req, ip) {
    const url = new URL(req.url), m = req.method, t = agora();
    const partes = url.pathname.split('/').filter(Boolean).slice(1);
    let b = {};
    if (m === 'POST') {
      // JSON obrigatório + cookie SameSite=Strict: site de fora não consegue agir pela pessoa.
      if (!(req.headers.get('content-type') || '').startsWith('application/json')) falha(415, 'Envie JSON');
      const cru = await req.text();
      if (cru.length > 600000) falha(413, 'Envio grande demais');
      try { b = JSON.parse(cru || '{}'); } catch { falha(400, 'JSON inválido'); }
      if (!b || typeof b !== 'object' || Array.isArray(b)) falha(400, 'JSON inválido');
    } else if (m !== 'GET') falha(405, 'Método não aceito');
    const r = `${m} ${partes[0] || ''}`;

    if (r === 'POST entrar' && partes.length === 1) return entrar(b, ip, t, url.protocol === 'https:');
    const eu = await quem(req);
    if (r === 'GET eu') return json({ nome: eu.nome, papel: eu.papel, config });
    if (r === 'POST sair') {
      await db.run('UPDATE pessoas SET token_hash=NULL WHERE id=?', eu.id);
      return json({ ok: true }, 200, { 'set-cookie': 's=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }
    if (r === 'GET pedidos' && partes.length === 1) {
      const w = { morador: ' WHERE p.criado_por = ?', cortar: " WHERE p.etapa = 'cortar'", coord: '' }[eu.papel] ?? " WHERE p.etapa NOT IN ('concluido','cancelado')";
      const ps = await db.all(SELECT + w + ' ORDER BY p.urgente DESC, p.criado_em', ...(eu.papel === 'morador' ? [eu.id] : []));
      return json({ agora: t, pedidos: ps.map(p => visao(p, eu, t)) });
    }
    if (r === 'POST pedidos' && partes.length === 1) return json(await criar(b, eu, t));
    if (r === 'GET pedidos' && partes.length === 2) {
      const p = await um(partes[1]); podeVer(p, eu);
      const v = visao(p, eu, t);
      if (v.dono?.meu || eu.papel === 'coord') {
        const ev = await db.all("SELECT e.acao,e.etapa,e.obs,e.em,s.nome,s.telefone FROM eventos e JOIN pessoas s ON s.id=e.pessoa WHERE e.pedido=? AND e.acao IN ('criar','concluir','devolver') ORDER BY e.em", p.id);
        // telefone de quem fez a etapa anterior: só para quem assumiu a atual
        v.historico = ev.filter(e => eu.papel !== 'cortar' || e.acao !== 'criar')
          .map(e => ({ acao: e.acao, etapa: e.etapa, obs: e.obs, em: e.em, nome: e.nome, ...(v.dono?.meu && e.acao !== 'criar' ? { telefone: e.telefone } : {}) }));
        // foto da casa não vai para a vidraçaria; a do vão medido vai
        v.fotos = (await db.all('SELECT id, etapa FROM fotos WHERE pedido=?', p.id)).filter(f => eu.papel !== 'cortar' || f.etapa !== 'pedido');
      }
      return json(v);
    }
    if (r === 'POST pedidos' && partes.length === 3 && Object.hasOwn(acoes, partes[2])) {
      const p = await um(partes[1]); podeVer(p, eu);
      await acoes[partes[2]](p, eu, b, t);
      return json({ ok: true, pedido: visao(await um(p.id), eu, t) });
    }
    if (r === 'GET fotos' && partes.length === 2) {
      const [f] = await db.all('SELECT f.jpeg64, f.etapa, p.dono FROM fotos f JOIN pedidos p ON p.id=f.pedido WHERE f.id=?', partes[1]);
      if (!f || !(eu.papel === 'coord' || f.dono === eu.id) || (eu.papel === 'cortar' && f.etapa === 'pedido')) falha(404, 'Foto não encontrada');
      return new Response(Uint8Array.from(atob(f.jpeg64), c => c.charCodeAt(0)), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
    }
    falha(404, 'Rota não existe');
  }

  return async (req, ip) => {
    try { return await rota(req, ip); } catch (e) {
      if (e instanceof Erro) return json({ erro: e.message, ...e.extra }, e.status);
      console.error(e);
      return json({ erro: 'Erro no servidor. Tente de novo' }, 500);
    }
  };
}

export const CABECALHOS = {
  'content-security-policy': "default-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  // a política de tiles do OSM exige Referer; aqui vai só a origem, nunca o caminho
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-robots-tag': 'noindex, nofollow',
  'permissions-policy': 'geolocation=(self), camera=(self)',
};
