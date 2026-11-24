'use strict';
/* Mutirão dos Vidros. Sem framework: a página inteira pesa menos que uma foto. */
const NOME = { medir: 'Medir', cortar: 'Cortar', instalar: 'Instalar', concluido: 'Concluído', cancelado: 'Cancelado' };
const LETRA = { medir: 'M', cortar: 'C', instalar: 'I', concluido: 'OK', cancelado: 'X' };
const PAPEL = { morador: 'Pedir vidro', medir: 'Medição', cortar: 'Vidraçaria', instalar: 'Instalação', coord: 'Coordenação' };
const TIPO = { comum: 'Comum (liso)', canelado: 'Canelado / fantasia', temperado: 'Temperado', laminado: 'Laminado', nao_sei: 'Não sei' };
const FAZER = { medir: 'medir os vãos', cortar: 'cortar os vidros', instalar: 'retirar e instalar' };

// ---------- utilidades ----------
function el(tag, props, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'required', 'id', 'className', 'textContent'].includes(k)) n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...filhos.flat(9).filter(f => f != null && f !== false)); // texto entra como texto: nada do banco vira HTML
  return n;
}
const $ = id => document.getElementById(id);
const ler = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch { return padrao; } };
function gravar(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch { avisar('Memória do celular cheia. Envie o que está pendente (ou tire a foto) antes de continuar.', 9000); return false; }
}
const apagar = k => localStorage.removeItem(k);
let tAviso;
function avisar(txt, ms = 5000) { const a = $('aviso'); a.textContent = txt; a.className = 'ver'; clearTimeout(tAviso); tAviso = setTimeout(() => { a.className = ''; }, ms); }
const uuid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128;
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
};
const hora = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const ateQuando = t => new Date(t).toDateString() === new Date().toDateString() ? 'às ' + hora(t) : 'em ' + quando(t);
const quando = t => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const num = t => Number(String(t ?? '').replace(',', '.'));
const cm = n => String(n).replace('.', ',');

let eu = ler('eu', null), dados = ler('lista', { pedidos: [], em: 0 }), semSinal = !navigator.onLine, filtro = null;

async function api(metodo, rota, corpo) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), 20000);
  let r, j;
  try {
    r = await fetch('/api/' + rota, { method: metodo, signal: c.signal, headers: corpo ? { 'content-type': 'application/json' } : {}, body: corpo && JSON.stringify(corpo) });
    j = await r.json();
    if (r.status >= 500) throw 0;
  } catch { semSinal = true; topo(); throw { rede: true, erro: 'Sem sinal agora' }; } finally { clearTimeout(t); }
  if (semSinal) { semSinal = false; topo(); }
  if (!r.ok) { if (r.status === 401 && rota !== 'entrar') { gravar('vencida', 1); } throw { status: r.status, ...j }; }
  return j;
}

// ---------- fila de envio: nada digitado se perde ----------
const fila = () => ler('fila', []);
function enfileirar(item, chaveRascunho) {
  if (!gravar('fila', [...fila(), { ...item, em: Date.now(), estado: 'esperando' }])) return false; // sem espaço: o rascunho continua na tela
  if (chaveRascunho) apagar(chaveRascunho);
  return true;
}
const mudarFila = (op, f) => gravar('fila', fila().flatMap(i => i.op === op ? (f ? [f(i)] : []) : [i]));
let enviando = false;
async function enviarFila() {
  if (enviando || !eu) return;
  enviando = true;
  try {
    for (const i of fila().filter(x => x.estado === 'esperando')) {
      try { const r = await api('POST', i.rota, i.corpo); mudarFila(i.op, null); apagar('d:' + i.pedido); avisar(i.tipo === 'criar' ? `Pedido nº ${r.numero} enviado` : `Enviado: ${i.titulo}`); }
      catch (e) {
        if (e.rede || e.status === 429) break;
        if (e.status === 401) { location.hash = '#/entrar'; break; }
        mudarFila(i.op, x => ({ ...x, estado: 'problema', erro: e.erro })); // fica guardado para a pessoa resolver
        avisar('Um envio precisa da sua atenção: ' + e.erro, 8000);
      }
    }
  } finally { enviando = false; topo(); }
}
async function atualizar() {
  if (!eu) return;
  await enviarFila();
  try {
    const r = await api('GET', 'pedidos');
    dados = { pedidos: r.pedidos, em: Date.now() };
    // no aparelho fica o mínimo: endereço só das casas que estão comigo
    gravar('lista', { em: dados.em, pedidos: r.pedidos.map(p => { if (p.dono?.meu || eu.papel === 'morador') return p; const { endereco, morador, obs, lat, lng, ...resto } = p; return resto.etapa && p.aprox ? { ...resto, lat, lng } : resto; }) });
    const meus = new Set(r.pedidos.filter(p => p.dono?.meu).map(p => 'd:' + p.id));
    for (const k of Object.keys(localStorage)) if (k.startsWith('d:') && !meus.has(k)) apagar(k);
  } catch (e) { if (e.status === 401) location.hash = '#/entrar'; }
  topo();
}
async function atualizarTela() { await atualizar(); if (/^#?\/?$|^#\/mapa|^#\/envios/.test(location.hash)) desenhar(true); }

// ---------- moldura ----------
function topo() {
  const f = fila(), prob = f.filter(i => i.estado === 'problema').length;
  $('topo').replaceChildren(el('div', {}, el('b', {}, 'Mutirão dos Vidros'), el('small', { id: 'estado' }, eu ? PAPEL[eu.papel] + ' · ' : '', semSinal ? el('strong', { className: 'off' }, 'sem sinal') : 'conectado')),
    f.length ? el('a', { href: '#/envios', className: 'alerta' }, prob ? `${prob} com problema` : `${f.length} para enviar`) : eu ? el('a', { href: '#/envios' }, eu.nome.split(' ')[0]) : '');
  const h = location.hash || '#/';
  const it = (href, t) => el('a', { href, 'aria-current': h === href ? 'page' : null }, t);
  $('nav').replaceChildren(...(eu && !h.startsWith('#/entrar') ? [it('#/', eu.papel === 'morador' ? 'Meus pedidos' : 'Lista'), ...(['morador', 'cortar'].includes(eu.papel) ? [] : [it('#/mapa', 'Mapa')]), it('#/novo', '+ Pedido')] : []));
}
const tela = (...n) => $('tela').replaceChildren(...n.flat(9).filter(x => x != null && x !== false));
const etq = e => el('span', { className: 'etq ' + e }, NOME[e]);

// ---------- entrar ----------
function telaEntrar() {
  const doLink = /[#&]c=([A-Za-z0-9-]+)/.exec(location.hash)?.[1];
  if (doLink) { sessionStorage.setItem('c', doLink); history.replaceState(null, '', '#/entrar'); }
  const r = ler('r:entrar', {});
  const cod = el('input', { id: 'codigo', value: sessionStorage.getItem('c') || '', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'XXXX-XXXX', required: true });
  const nome = el('input', { id: 'nome', value: eu?.nome || r.nome || '', autocomplete: 'name', required: true }), tel = el('input', { id: 'tel', type: 'tel', value: r.tel || '', autocomplete: 'tel' });
  const bt = el('button', { className: 'forte', type: 'submit' }, 'Entrar'), erro = el('div', { role: 'alert' });
  const guardar = () => gravar('r:entrar', { nome: nome.value, tel: tel.value });
  tela(el('h1', {}, ler('vencida') ? 'Entre de novo' : 'Entrar no mutirão'),
    fila().length ? el('div', { className: 'caixa alerta' }, `Você tem ${fila().length} envio(s) guardado(s) neste celular. Eles vão assim que você entrar.`) : null,
    el('form', { oninput: guardar, onsubmit: async ev => {
      ev.preventDefault(); bt.disabled = true; erro.replaceChildren();
      let ap = ler('aparelho'); if (!ap) { ap = [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join(''); gravar('aparelho', ap); }
      try {
        eu = await api('POST', 'entrar', { codigo: cod.value, nome: nome.value, telefone: tel.value, aparelho: ap });
        gravar('eu', eu); apagar('vencida'); sessionStorage.removeItem('c'); dados = { pedidos: [], em: 0 }; location.hash = '#/'; await atualizar(); desenhar();
      } catch (e) { erro.replaceChildren(el('div', { className: 'caixa erro' }, e.rede ? 'Sem sinal agora. Tente de novo quando voltar.' : e.erro)); bt.disabled = false; }
    } },
    el('label', { for: 'codigo' }, 'Código do mutirão'), cod,
    el('label', { for: 'nome' }, 'Seu nome'), nome,
    el('label', { for: 'tel' }, 'Seu telefone ', el('small', {}, '(opcional; só aparece para quem pegar a etapa seguinte da mesma casa)')), tel,
    erro, bt),
    el('p', { className: 'fraco' }, 'Cada função tem um código. Quem coordena o mutirão é que entrega. Não poste o código em grupo aberto: ele mostra onde estão as casas danificadas.'));
}

// ---------- lista ----------
function cartao(p) {
  const pend = fila().some(i => i.pedido === p.id);
  return el('a', { className: 'card ' + p.etapa, href: '#/p/' + p.id },
    el('div', { className: 'linha' }, el('b', { className: 'n' }, `Nº ${p.numero} · ${p.bairro}`), etq(p.etapa)),
    p.endereco ? el('p', {}, p.endereco) : null,
    p.vaos ? el('p', { className: 'fraco' }, `${p.vaos} vidro(s)`) : null,
    p.urgente ? el('span', { className: 'etq urg' }, 'Urgente') : null, p.duplicado ? el('span', { className: 'etq dup' }, 'Pode ser repetido') : null,
    pend ? el('p', {}, el('b', {}, 'Guardado no celular, esperando envio')) : p.dono ? el('p', {}, el('b', {}, p.dono.meu ? (p.dono.ate < Date.now() ? 'Com você (prazo venceu, renove)' : `Com você; vence ${ateQuando(p.dono.ate)}`) : `${p.dono.nome} está indo (${hora(p.dono.desde)})`)) : null,
    el('p', { className: 'fraco' }, 'Pedido em ' + quando(p.criado_em)));
}
const secao = (t, ps, vazio) => ps.length ? [el('h2', {}, `${t} (${ps.length})`), ps.map(cartao)] : vazio ? [el('h2', {}, t), el('p', { className: 'fraco' }, vazio)] : [];

function telaLista() {
  const ps = dados.pedidos, rodape = el('p', { className: 'fraco' }, dados.em ? `Atualizado às ${hora(dados.em)}` : 'Ainda não carregou');
  const bt = el('button', { onclick: atualizarTela }, 'Atualizar agora');
  const novos = fila().filter(i => i.tipo === 'criar').map(i => el('div', { className: 'card' }, el('b', {}, i.titulo), el('p', {}, 'Guardado no celular, esperando envio')));
  if (eu.papel === 'morador') return tela(el('h1', {}, 'Meus pedidos'), el('a', { className: 'bt forte', href: '#/novo' }, 'Pedir troca de vidro'), novos, ps.map(cartao), ps.length ? null : el('p', { className: 'fraco' }, 'Nenhum pedido feito neste celular.'), bt, rodape);
  if (eu.papel === 'coord') {
    const conta = e => ps.filter(p => p.etapa === e).length, vis = filtro ? ps.filter(p => p.etapa === filtro) : ps.filter(p => !['concluido', 'cancelado'].includes(p.etapa));
    const minhas = ps.filter(p => p.dono?.meu);
    return tela(el('h1', {}, 'Como está o mutirão'),
      el('div', { className: 'contas' }, ['medir', 'cortar', 'instalar', 'concluido'].map(e => el('button', { className: e, 'aria-pressed': String(filtro === e), onclick: () => { filtro = filtro === e ? null : e; desenhar(); } }, el('b', {}, conta(e)), NOME[e]))),
      novos, secao('Comigo', minhas), secao(filtro ? NOME[filtro] : 'Em andamento', vis.filter(p => !p.dono?.meu), 'Nada aqui.'), bt, rodape);
  }
  const et = ps.filter(p => p.etapa === eu.papel);
  tela(el('h1', {}, 'O que eu faço agora?'), novos,
    secao('Comigo', et.filter(p => p.dono?.meu)),
    secao(`Livres para ${FAZER[eu.papel]}`, et.filter(p => !p.dono), dados.em ? 'Nenhuma casa esperando por você agora.' : 'Sem dados ainda. Toque em atualizar quando tiver sinal.'),
    secao('Outra pessoa já está indo', et.filter(p => p.dono && !p.dono.meu)), bt, rodape);
}

// ---------- mapa ----------
let carregaMapa;
function leaflet() {
  return carregaMapa ||= new Promise((ok, erro) => {
    document.head.append(el('link', { rel: 'stylesheet', href: 'vendor/leaflet.css' }));
    document.head.append(el('script', { src: 'vendor/leaflet.js', onload: () => ok(window.L), onerror: () => { carregaMapa = null; erro(); } }));
  });
}
function base(L, id, centro, zoom) {
  const m = L.map(id).setView(centro, zoom);
  const t = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m);
  t.on('tileerror', () => { const a = $('semtile'); if (a) a.hidden = false; });
  return m;
}
const avisoTile = t => el('div', { id: 'semtile', className: 'caixa alerta', hidden: true }, t);
let mapaVivo;
async function telaMapa(mesmaTela) {
  if (mesmaTela && mapaVivo?.no.isConnected) return mapaVivo.pinos(); // atualiza os pinos sem perder zoom nem baixar o mapa de novo
  const no = el('div', { id: 'mapa' });
  const sem = dados.pedidos.filter(p => p.lat == null && p.etapa === eu.papel);
  tela(el('h1', {}, 'Mapa das casas'), el('div', { className: 'legenda' }, ['medir', 'cortar', 'instalar', ...(eu.papel === 'coord' ? ['concluido'] : [])].map(e => el('span', { className: 'etq ' + e }, `${LETRA[e]} ${NOME[e]}`))),
    avisoTile('O desenho do mapa não carregou. Os pinos continuam valendo; se precisar, use a lista.'), no,
    eu.papel !== 'coord' ? el('p', { className: 'fraco' }, 'Pino aproximado (até 110 m). O endereço certo aparece quando você toca em "Estou indo".') : null,
    sem.length ? secao('Sem ponto no mapa', sem) : null);
  try {
    const L = await leaflet(); if (!no.isConnected) return;
    const m = base(L, no, eu.config.centro, 14), camada = L.layerGroup().addTo(m); let ajustou = false;
    const pinos = () => {
      const ps = dados.pedidos.filter(p => p.lat != null && (eu.papel !== 'coord' || p.etapa !== 'cancelado'));
      camada.clearLayers();
      for (const p of ps) {
        const ic = L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 40], html: el('div', { className: `pino ${p.etapa}${p.dono && !p.dono.meu ? ' ocupado' : ''}` }, el('b', {}, LETRA[p.etapa])) });
        L.marker([p.lat, p.lng], { icon: ic, title: `Nº ${p.numero} ${NOME[p.etapa]}`, alt: `Nº ${p.numero}, ${NOME[p.etapa]}` }).addTo(camada)
          .bindPopup(el('div', {}, el('b', {}, `Nº ${p.numero} · ${p.bairro}`), el('br'), NOME[p.etapa], p.dono ? ` (${p.dono.meu ? 'com você' : p.dono.nome + ' está indo'})` : '', el('br'), el('a', { href: '#/p/' + p.id }, 'Abrir')));
      }
      if (ps.length && !ajustou) { ajustou = true; m.fitBounds(ps.map(p => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 16 }); }
    };
    mapaVivo = { no, pinos }; pinos();
  } catch { if (no.isConnected) no.replaceWith(el('div', { className: 'caixa alerta' }, 'O mapa não carregou. Use a lista.')); }
}

// ---------- pedaços de formulário ----------
function campoFoto(r, salvar) {
  const st = el('p', { className: 'fraco' }, r.foto ? 'Foto guardada.' : ''), tirar = el('button', { type: 'button', className: 'mini', onclick: () => { delete r.foto; salvar(); st.textContent = ''; inp.value = ''; tirar.hidden = true; } }, 'Remover a foto');
  tirar.hidden = !r.foto;
  const inp = el('input', { type: 'file', id: 'foto', accept: 'image/*', onchange: async () => {
    const f = inp.files[0]; if (!f) return; st.textContent = 'Diminuindo a foto…';
    try { // redesenhar também remove a localização escondida no arquivo
      const im = await createImageBitmap(f), c = document.createElement('canvas');
      let lado = 1024, q = .6, b64;
      do {
        const k = Math.min(1, lado / Math.max(im.width, im.height)); c.width = im.width * k; c.height = im.height * k;
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); b64 = c.toDataURL('image/jpeg', q).split(',')[1]; lado *= .75; q *= .9;
      } while (b64.length > 200000 && lado > 200);
      const antes = r.foto; r.foto = b64;
      if (salvar() === false) { r.foto = antes; st.textContent = 'Sem espaço para a foto.'; return; }
      st.textContent = `Foto guardada (${Math.round(b64.length * .75 / 1024)} KB).`; tirar.hidden = false;
    } catch { st.textContent = 'Não consegui ler essa foto. Pode seguir sem ela.'; }
  } });
  return [el('label', { for: 'foto' }, 'Foto ', el('small', {}, '(opcional)')), inp, st, tirar];
}
function lerPonto(t) {
  const m = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(t) || /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(t) || /(?:[?&](?:q|ll|query|destination)=(?:loc:)?)(-?\d+\.\d+)(?:,|%2C)\+?(-?\d+\.\d+)/i.exec(t) || /^\s*(-?\d+\.\d+)\s*[,; ]\s*(-?\d+\.\d+)\s*$/.exec(t);
  return m && Math.abs(m[1]) <= 90 && Math.abs(m[2]) <= 180 ? [Number(m[1]), Number(m[2])] : null;
}

// ---------- novo pedido ----------
function telaNovo() {
  const K = 'r:novo', r = ler(K, {}), salvar = () => gravar(K, r);
  const campo = (k, rot, at = {}, peq) => [el('label', { for: k }, rot, peq ? el('small', {}, ' ' + peq) : ''), el(at.tag || 'input', { id: k, value: r[k] || '', oninput: e => { r[k] = e.target.value; salvar(); }, ...at, tag: null })];
  const pt = el('div', { className: 'caixa', id: 'ponto' }), erro = el('div', { role: 'alert' }), lugarMapa = el('div');
  const mostra = () => pt.replaceChildren(r.lat != null ? el('span', {}, el('b', {}, 'Ponto marcado'), r.prec ? ` (GPS com erro de ~${Math.round(r.prec)} m)` : '') : 'Ainda sem ponto no mapa. Pode enviar só com o endereço.');
  const marca = (lat, lng, prec) => { r.lat = lat; r.lng = lng; r.prec = prec; salvar(); mostra(); };
  mostra();
  const gps = el('button', { type: 'button', onclick: () => {
    if (!navigator.geolocation) return avisar('Este celular não tem GPS no navegador. Marque no mapa ou só escreva o endereço.');
    gps.disabled = true; gps.textContent = 'Procurando…';
    const fim = () => { gps.disabled = false; gps.textContent = 'Usar meu GPS'; };
    navigator.geolocation.getCurrentPosition(p => { fim(); marca(p.coords.latitude, p.coords.longitude, p.coords.accuracy); }, () => { fim(); avisar('GPS não respondeu. Marque no mapa, cole um link ou só escreva o endereço.', 7000); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
  } }, 'Usar meu GPS');
  const noMapa = el('button', { type: 'button', onclick: async () => {
    lugarMapa.replaceChildren(avisoTile('O desenho do mapa não carregou. Use o endereço escrito ou cole um link do Google Maps.'), el('div', { id: 'mapinha' }), el('p', { className: 'fraco' }, 'Toque no telhado da casa.'));
    try {
      const L = await leaflet(), m = base(L, 'mapinha', r.lat != null ? [r.lat, r.lng] : eu.config.centro, r.lat != null ? 17 : 14); let mk;
      const ic = L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 40], html: el('div', { className: 'pino medir' }) });
      const poe = ll => { mk ? mk.setLatLng(ll) : mk = L.marker(ll, { icon: ic }).addTo(m); };
      if (r.lat != null) poe([r.lat, r.lng]);
      m.on('click', e => { poe(e.latlng); marca(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)); });
    } catch { lugarMapa.replaceChildren(el('div', { className: 'caixa alerta' }, 'O mapa não carregou. Escreva o endereço com uma boa referência.')); }
  } }, 'Marcar no mapa');
  const link = el('input', { id: 'link', placeholder: 'cole aqui', oninput: () => { const p = lerPonto(link.value); if (p) { marca(...p); link.value = ''; avisar('Ponto lido do link.'); } else if (/goo\.gl/.test(link.value)) avisar('Link curto não mostra o ponto. Abra no Google Maps, segure o dedo na casa e copie os números (ex.: -29.1, -53.8).', 8000); } });
  tela(el('h1', {}, 'Novo pedido de vidro'), el('p', { className: 'fraco' }, 'O que você escreve fica guardado no celular, mesmo sem sinal.'),
    el('form', { onsubmit: ev => {
      ev.preventDefault(); const id = uuid();
      const falta = ['morador', 'telefone', 'bairro', 'endereco'].filter(k => !(r[k] || '').trim());
      if (falta.length || (r.telefone || '').replace(/\D/g, '').length < 8) { erro.replaceChildren(el('div', { className: 'caixa erro' }, falta.length ? 'Preencha nome, telefone, bairro e endereço.' : 'Telefone incompleto.')); return; }
      const corpo = { id, morador: r.morador, telefone: r.telefone, bairro: r.bairro, endereco: r.endereco, obs: r.obs, urgente: !!r.urgente, lat: r.lat ?? null, lng: r.lng ?? null, foto: r.foto };
      if (!enfileirar({ op: id, tipo: 'criar', pedido: id, rota: 'pedidos', corpo, titulo: `${r.morador} · ${r.bairro}`, rascunho: [K, r] }, K)) return;
      avisar('Guardado no celular. Enviando…'); location.hash = '#/'; atualizarTela();
    } },
    campo('morador', 'Nome do morador', { maxlength: 60, autocomplete: 'off' }), campo('telefone', 'Telefone do morador', { type: 'tel', maxlength: 20, autocomplete: 'off' }, '(só quem assumir a casa vê)'),
    campo('bairro', 'Bairro', { maxlength: 60 }), campo('endereco', 'Endereço ou referência', { maxlength: 200, placeholder: 'rua, número, casa amarela perto de…' }),
    el('h2', {}, 'Onde fica'), pt, gps, noMapa, lugarMapa, el('label', { for: 'link' }, 'Ou cole um link do Google Maps / coordenadas'), link,
    campo('obs', 'Observação', { tag: 'textarea', maxlength: 500, placeholder: 'quantos vidros, cachorro no pátio, melhor horário…' }),
    el('label', { className: 'marca' }, el('input', { type: 'checkbox', id: 'urgente', checked: !!r.urgente, onchange: e => { r.urgente = e.target.checked; salvar(); } }), 'Urgente (casa aberta, sem ter onde ficar)'),
    campoFoto(r, salvar), erro, el('button', { className: 'forte', type: 'submit' }, 'Enviar pedido')));
}

// ---------- uma casa ----------
const linkMaps = p => 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(p.lat != null ? `${p.lat},${p.lng}` : `${p.endereco}, ${p.bairro}, ${eu.config.cidade}`);
const ligar = (t, quem) => t ? el('div', { className: 'duplo' }, el('a', { className: 'bt', href: 'tel:' + t.replace(/[^\d+]/g, '') }, 'Ligar ' + quem), el('a', { className: 'bt', href: 'https://wa.me/55' + t.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''), rel: 'noreferrer', target: '_blank' }, 'WhatsApp')) : null;
const tabela = ms => el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Vão'), el('th', {}, 'Larg × alt (cm)'))), el('tbody', {}, ms.map(m => el('tr', {}, el('td', {}, el('b', {}, m.nome), el('br'), `${TIPO[m.tipo]}${m.esp ? `, ${m.esp} mm` : ', espessura não informada'}`, m.obs ? [el('br'), m.obs] : null), el('td', { className: 'med' }, `${cm(m.larg)} × ${cm(m.alt)}`, el('br'), `${m.qtd} un.`)))));

async function telaCasa(id) {
  let p = ler('d:' + id) || dados.pedidos.find(x => x.id === id);
  if (p) desenharCasa(p); else tela(el('p', {}, 'Abrindo…'));
  if (fila().some(i => i.pedido === id)) return;
  try { p = await api('GET', 'pedidos/' + id); if (p.dono?.meu) gravar('d:' + id, p); else apagar('d:' + id); if (location.hash === '#/p/' + id && !$('tela').querySelector('input:focus,textarea:focus,select:focus')) desenharCasa(p); /* não redesenha embaixo de quem digita */ }
  catch (e) { if (e.status === 401) location.hash = '#/entrar'; else if (!p) tela(el('h1', {}, 'Não abriu'), el('p', {}, e.erro), el('a', { className: 'bt', href: '#/' }, 'Voltar')); }
}
async function agir(p, acao, corpo, bt) {
  bt.disabled = true;
  try {
    const r = await api('POST', `pedidos/${p.id}/${acao}`, corpo || {});
    if (r.pedido.dono?.meu) gravar('d:' + p.id, r.pedido); else apagar('d:' + p.id);
    avisar({ assumir: 'É sua. As outras pessoas já veem que você está indo.', soltar: 'Casa liberada para outra pessoa.', cancelar: 'Pedido cancelado.', urgente: 'Salvo.' }[acao]);
    await atualizar(); location.hash === '#/p/' + p.id ? telaCasa(p.id) : 0;
  } catch (e) {
    bt.disabled = false;
    if (e.status === 401) { location.hash = '#/entrar'; return; }
    avisar(e.rede ? (acao === 'assumir' ? 'Sem sinal: a trava NÃO foi confirmada. Outra pessoa pode pegar esta casa. Tente de novo.' : 'Sem sinal. Tente de novo.') : e.erro, 8000);
    if (e.motivo) { await atualizar(); telaCasa(p.id); }
  }
}
function desenharCasa(p) {
  const meu = p.dono?.meu, coord = eu.papel === 'coord', aberta = ['medir', 'cortar', 'instalar'].includes(p.etapa), minhaFuncao = aberta && (coord || eu.papel === p.etapa), pend = fila().find(i => i.pedido === p.id);
  const cab = [el('div', { className: 'linha' }, el('h1', {}, `Nº ${p.numero} · ${p.bairro}`), etq(p.etapa)),
    p.urgente ? el('span', { className: 'etq urg' }, 'Urgente') : null, p.duplicado ? el('div', { className: 'caixa alerta' }, 'Pode ser repetido: outro pedido aberto tem o mesmo telefone ou ponto.') : null,
    pend ? el('div', { className: 'caixa alerta' }, pend.estado === 'problema' ? `Seu envio não entrou: ${pend.erro}. ` : 'Guardado no celular, esperando sinal para enviar. ', el('a', { href: '#/envios' }, 'Ver envios')) : null];
  const onde = p.endereco ? el('div', { className: 'caixa' }, el('b', {}, p.morador), el('p', {}, p.endereco), p.obs ? el('p', {}, p.obs) : null, el('a', { className: 'bt', href: linkMaps(p), target: '_blank', rel: 'noreferrer' }, 'Abrir no Google Maps'), p.telefone ? ligar(p.telefone, 'morador') : null) : null;
  const hist = p.historico?.length ? [el('h2', {}, 'O que já foi feito'), p.historico.map(h => el('div', { className: 'caixa' }, el('b', {}, `${h.acao === 'devolver' ? 'Devolvido de ' : h.acao === 'criar' ? 'Pedido feito' : ''}${h.acao === 'criar' ? '' : NOME[h.etapa]}`), ` · ${h.nome.split(' ')[0]}, ${quando(h.em)}`, h.obs ? el('p', {}, h.obs) : null, h.telefone ? ligar(h.telefone, h.nome.split(' ')[0]) : null))] : null;
  const fotos = p.fotos?.length ? [el('details', {}, el('summary', {}, `Ver foto(s) (${p.fotos.length})`), p.fotos.map(f => el('img', { className: 'foto', src: '/api/fotos/' + f.id, loading: 'lazy', alt: 'Foto da etapa ' + (NOME[f.etapa] || 'pedido') })))] : null;
  const med = p.medidas ? [el('h2', {}, 'Medidas'), p.medidas.some(m => m.tipo === 'temperado') ? el('div', { className: 'caixa alerta' }, 'Tem vidro temperado: não se corta na bancada, é feito sob medida.') : null, el('div', { className: 'caixa' }, tabela(p.medidas))] : null;
  const ret = p.retirar_em && p.etapa === 'instalar' ? el('div', { className: 'caixa bom' }, el('b', {}, 'Retirar os vidros em: '), p.retirar_em) : null;
  let acao = null;
  if (minhaFuncao && !pend) {
    if (meu) acao = formEtapa(p);
    else if (p.dono) acao = el('div', { className: 'caixa alerta' }, el('b', {}, `${p.dono.nome} está indo`), ` desde ${hora(p.dono.desde)}. Libera sozinho ${ateQuando(p.dono.ate)} se não concluir.`);
    else acao = el('button', { className: 'forte', id: 'assumir', onclick: e => agir(p, 'assumir', null, e.target) }, p.etapa === 'cortar' ? 'Vou cortar este' : 'Estou indo');
    if (!meu && !p.dono && eu.papel !== 'cortar' && !p.endereco) acao = [el('p', {}, 'O endereço, o telefone e as fotos aparecem quando você assume a casa.'), acao];
  }
  const coisas = !coord && !(eu.papel === 'morador' && p.criei && aberta) ? null : el('details', {}, el('summary', {}, coord ? 'Coordenação' : 'Cancelar pedido'),
    coord && p.dono && !meu ? el('button', { onclick: e => agir(p, 'soltar', null, e.target) }, `Liberar a casa (tirar de ${p.dono.nome})`) : null,
    coord ? el('button', { onclick: e => agir(p, 'urgente', { urgente: !p.urgente }, e.target) }, p.urgente ? 'Tirar urgente' : 'Marcar urgente') : null,
    aberta ? el('button', { className: 'ruim', onclick: e => agir(p, 'cancelar', {}, e.target) }, 'Cancelar este pedido') : null);
  tela(cab, p.dono && !minhaFuncao ? el('p', {}, `${p.dono.nome} está cuidando desta etapa.`) : null, ret, onde, med, acao, hist, fotos, coisas);
}

function formEtapa(p) {
  const K = `r:${p.id}:${p.etapa}`, r = ler(K, {}), salvar = () => gravar(K, r), erro = el('div', { role: 'alert' });
  const ate = el('div', { className: 'caixa bom' }, p.dono.ate < Date.now() ? 'O prazo da trava venceu. Renove para ninguém pegar junto.' : `Com você. A trava vence ${ateQuando(p.dono.ate)}. `, el('button', { type: 'button', className: 'mini', onclick: e => agir(p, 'assumir', null, e.target) }, 'Renovar prazo'));
  const corpo = { medir: 'Concluir medição e mandar para a vidraçaria', cortar: 'Vidros cortados: mandar para instalação', instalar: 'Instalado: concluir a casa' }[p.etapa];
  const partes = [];
  if (p.etapa === 'medir') {
    r.vaos ||= p.medidas?.length ? p.medidas.map(m => ({ ...m, larg: cm(m.larg), alt: cm(m.alt) })) : [{ tipo: 'comum', qtd: 1 }];
    const lugar = el('div');
    const monta = () => lugar.replaceChildren(...r.vaos.map((v, i) => {
      const c = (k, rot, at) => el('div', {}, el('label', { for: `${k}${i}` }, rot), el('input', { id: `${k}${i}`, value: v[k] ?? '', oninput: e => { v[k] = e.target.value; salvar(); }, ...at }));
      const s = (k, rot, ops) => el('div', {}, el('label', { for: `${k}${i}` }, rot), el('select', { id: `${k}${i}`, onchange: e => { v[k] = e.target.value; salvar(); } }, ops.map(([a, b]) => { const o = el('option', { value: a }, b); o.selected = String(v[k] ?? '') === String(a); return o; })));
      return el('fieldset', { className: 'caixa' }, el('div', { className: 'linha' }, el('b', {}, `Vão ${i + 1}`), r.vaos.length > 1 ? el('button', { type: 'button', className: 'mini', onclick: () => { r.vaos.splice(i, 1); salvar(); monta(); } }, 'Tirar') : null),
        c('nome', 'Qual janela/porta', { placeholder: 'ex.: quarto da frente', maxlength: 60 }),
        el('div', { className: 'duplo' }, c('larg', 'Largura cm', { inputmode: 'decimal' }), c('alt', 'Altura cm', { inputmode: 'decimal' })),
        el('div', { className: 'duplo assim' }, s('tipo', 'Tipo', Object.entries(TIPO)), s('esp', 'Espessura', [['', 'Não sei'], ...[2, 3, 4, 5, 6, 8, 10].map(n => [n, n + ' mm'])])),
        el('div', { className: 'duplo' }, c('qtd', 'Quantos iguais', { inputmode: 'numeric' }), c('obs', 'Detalhe', { maxlength: 200 })));
    }), el('button', { type: 'button', id: 'maisvao', onclick: () => { const u = r.vaos.at(-1); r.vaos.push({ tipo: u.tipo, esp: u.esp, qtd: 1 }); salvar(); monta(); } }, '+ Outro vão'));
    monta();
    partes.push(el('h2', {}, 'Medir'), el('p', { className: 'fraco' }, 'Em centímetros. Meça em dois pontos e anote o menor. Não desconte folga: a vidraçaria desconta.'), lugar);
  }
  if (p.etapa === 'cortar') partes.push(el('label', { for: 'retirar' }, 'Onde retirar os vidros'), el('input', { id: 'retirar', maxlength: 200, value: r.retirar_em ?? ler('retirar', ''), oninput: e => { r.retirar_em = e.target.value; salvar(); } }));
  partes.push(el('label', { for: 'obs' }, 'Observação ', el('small', {}, '(passa para a próxima pessoa)')), el('textarea', { id: 'obs', maxlength: 500, value: r.obs || '', oninput: e => { r.obs = e.target.value; salvar(); } }), campoFoto(r, salvar), erro, el('button', { className: 'forte', type: 'submit', id: 'concluir' }, corpo));
  const enviar = (tipo, dadosEnvio, titulo) => {
    const op = uuid();
    if (!enfileirar({ op, tipo, pedido: p.id, rota: `pedidos/${p.id}/${tipo}`, corpo: { op_id: op, ...dadosEnvio }, titulo: `Nº ${p.numero} · ${titulo}`, rascunho: [K, r] }, K)) return;
    avisar('Guardado no celular. Enviando…'); location.hash = '#/'; atualizarTela();
  };
  const mostraErro = t => { erro.replaceChildren(el('div', { className: 'caixa erro' }, t)); erro.scrollIntoView({ block: 'center' }); };
  const ant = { medir: [], cortar: ['medir'], instalar: ['cortar', 'medir'] }[p.etapa], para = el('select', { id: 'para' }, ant.map(e => el('option', { value: e }, NOME[e]))), mot = el('textarea', { id: 'motivo', maxlength: 500, value: r.motivo || '', oninput: e => { r.motivo = e.target.value; salvar(); } });
  return [ate, el('form', { novalidate: true, onsubmit: ev => {
    ev.preventDefault(); const d = { etapa: p.etapa, obs: r.obs, foto: r.foto };
    if (p.etapa === 'medir') {
      d.medidas = r.vaos.map(v => ({ nome: v.nome, larg: num(v.larg), alt: num(v.alt), qtd: num(v.qtd || 1), tipo: v.tipo, esp: v.esp ? Number(v.esp) : null, obs: v.obs }));
      const i = d.medidas.findIndex(m => !(m.larg >= 1 && m.larg <= 400 && m.alt >= 1 && m.alt <= 400 && Number.isInteger(m.qtd) && m.qtd >= 1 && m.qtd <= 50));
      if (i >= 0) return mostraErro(`Vão ${i + 1}: confira largura e altura em centímetros (1 a 400) e a quantidade.`);
    }
    if (p.etapa === 'cortar') { d.retirar_em = (r.retirar_em ?? ler('retirar', '')).trim(); if (!d.retirar_em) return mostraErro('Diga onde retirar os vidros.'); gravar('retirar', d.retirar_em); }
    enviar('concluir', d, NOME[p.etapa]);
  } }, partes),
  ant.length ? el('details', {}, el('summary', {}, 'Deu problema: devolver'), el('label', { for: 'para' }, 'Devolver para'), para, el('label', { for: 'motivo' }, 'O que houve'), mot, el('button', { className: 'ruim', onclick: () => r.motivo?.trim() ? enviar('devolver', { para: para.value, motivo: r.motivo }, 'Devolução') : avisar('Escreva o que houve.') }, 'Devolver')) : null,
  el('button', { className: 'ruim', id: 'soltar', onclick: e => agir(p, 'soltar', null, e.target) }, 'Não vou conseguir: soltar a casa')];
}

// ---------- envios e saída ----------
function telaEnvios() {
  const f = fila();
  tela(el('h1', {}, 'Envios deste celular'), f.length ? null : el('p', {}, 'Nada pendente. Tudo o que você fez já foi enviado.'),
    f.map(i => el('div', { className: 'caixa ' + (i.estado === 'problema' ? 'erro' : 'alerta') }, el('b', {}, i.titulo), el('p', {}, i.estado === 'problema' ? i.erro : 'Esperando sinal'),
      i.estado === 'problema' ? [
        el('button', { onclick: () => { gravar(...i.rascunho); mudarFila(i.op, null); topo(); location.hash = i.tipo === 'criar' ? '#/novo' : '#/p/' + i.pedido; } }, 'Abrir e tentar de novo'),
        el('button', { onclick: async () => { const { foto, op_id, ...c } = i.corpo; try { await navigator.clipboard.writeText(i.titulo + '\n' + JSON.stringify(c, null, 1)); avisar('Copiado. Cole numa mensagem para a coordenação.'); } catch { avisar('Não deu para copiar.'); } } }, 'Copiar os dados'),
        el('button', { className: 'ruim', onclick: e => { if (e.target.dataset.c) { mudarFila(i.op, null); topo(); desenhar(); } else { e.target.dataset.c = 1; e.target.textContent = 'Apagar mesmo? Toque de novo'; } } }, 'Apagar')] : null)),
    f.length ? el('button', { className: 'forte', onclick: atualizarTela }, 'Tentar enviar agora') : null,
    el('h2', {}, 'Sair'), el('p', { className: 'fraco' }, 'Apaga deste celular tudo o que veio do mutirão. Solte suas casas antes, se não for concluir.'),
    el('button', { className: 'ruim', disabled: f.length > 0, onclick: async () => { try { await api('POST', 'sair', {}); } catch (e) { if (e.rede) return avisar('Sem sinal. Saia quando voltar, para fechar o acesso de verdade.'); } localStorage.clear(); eu = null; dados = { pedidos: [], em: 0 }; location.hash = '#/entrar'; } }, f.length ? 'Envie os pendentes antes de sair' : 'Sair deste celular'));
}

// ---------- rotas ----------
function desenhar(mesmaTela) {
  topo();
  const h = location.hash || '#/';
  if (!eu || /^#\/entrar|^#c=/.test(h)) telaEntrar();
  else if (h.startsWith('#/p/')) telaCasa(h.slice(4));
  else if (h === '#/novo') telaNovo();
  else if (h === '#/mapa') telaMapa(mesmaTela);
  else if (h === '#/envios') telaEnvios();
  else telaLista();
  if (!mesmaTela) scrollTo(0, 0);
}
addEventListener('hashchange', () => { desenhar(); if (['', '#/', '#/mapa'].includes(location.hash)) atualizarTela(); });
addEventListener('online', () => { semSinal = false; topo(); atualizarTela(); });
addEventListener('offline', () => { semSinal = true; topo(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizarTela(); });
// só com a tela acesa: bateria vale mais que tempo real
setInterval(() => { if (!document.hidden && eu && (fila().some(i => i.estado === 'esperando') || location.hash === '#/' || !location.hash)) atualizarTela(); }, 60000);
setInterval(() => { if (!document.hidden && fila().some(i => i.estado === 'esperando')) atualizarTela(); }, 15000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
desenhar(); atualizarTela();
