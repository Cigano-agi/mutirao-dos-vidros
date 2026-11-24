// node test/ui.mjs  -> sobe a demo em porta livre, percorre as telas em 390 px e grava ../capturas
// Usa o Playwright global da máquina (npm i -g playwright); o app em si não tem dependências.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { iniciar } from '../server.mjs';
import { DEMO, semear, cliente } from '../demo.mjs';
const { chromium } = createRequire(join(execSync('npm root -g').toString().trim(), 'x.js'))('playwright');

const CAP = fileURLToPath(new URL('../../capturas/', import.meta.url)); mkdirSync(CAP, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'vidros-ui-')), codigos = Object.entries(DEMO).map(x => x.join(':')).join(',');
let srv = await iniciar({ porta: 0, dbPath: join(dir, 'ui.db'), codigos });
const url = srv.url, porta = Number(new URL(url).port), ids = await semear(url);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined }); // CHROMIUM=caminho se o do Playwright não estiver instalado
const erros = [];
async function celular(papel, nome, { mapaReal, ...opt } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR', ...opt });
  ctx.setDefaultTimeout(15000);
  if (!mapaReal) await ctx.route('https://tile.openstreetmap.org/**', r => r.abort());
  const p = await ctx.newPage();
  p.on('pageerror', e => erros.push(`${papel}: ${e.message}`));
  await p.goto(url + '/#c=' + DEMO[papel]);
  await p.fill('#nome', nome); await p.click('button[type=submit]');
  await p.waitForSelector('#nav a');
  return p;
}
const foto = async (p, n) => {
  const larg = await p.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(larg <= 390, `${n}: rola para o lado (${larg}px)`);
  await p.evaluate(() => scrollTo(0, 0));
  await p.waitForTimeout(250); await p.screenshot({ path: join(CAP, n + '.png'), fullPage: true });
};
const naFila = p => p.evaluate(() => JSON.parse(localStorage.fila || '[]').length);
const filaVazia = p => p.waitForFunction(() => JSON.parse(localStorage.fila || '[]').length === 0, null, { timeout: 30000 });
const etapa = async (nome, f) => { await f(); console.log('OK  ', nome); };
try {
  await etapa('sem código: tela de entrada, nenhum dado; código errado recusado', async () => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage();
    await p.goto(url + '/#/p/' + ids[0]); await p.waitForSelector('#codigo');
    assert.ok(!/Modelo|Fictíci/.test(await p.textContent('body')));
    await p.fill('#codigo', 'ERRA-DOOO'); await p.fill('#nome', 'Curioso'); await p.click('button[type=submit]');
    await p.waitForSelector('.caixa.erro'); assert.match(await p.textContent('.caixa.erro'), /não confere/);
    await foto(p, '01-entrar-codigo-errado'); await ctx.close();
  });
  await etapa('código do link some da barra de endereço', async () => {
    const ctx = await b.newContext(), p = await ctx.newPage();
    await p.goto(url + '/#c=' + DEMO.medir); await p.waitForSelector('#codigo');
    assert.ok(!p.url().includes('DEMO')); assert.equal(await p.inputValue('#codigo'), DEMO.medir); await ctx.close();
  });
  const mor = await celular('morador', 'Moradora Exemplo', { permissions: [] });
  await etapa('morador: GPS negado e mapa sem imagem; marca à mão; recarrega sem perder', async () => {
    await mor.click('text=Pedir troca de vidro'); await mor.waitForSelector('#morador');
    for (const [k, v] of [['morador', 'Gil Fictício'], ['telefone', '(00) 90000-0077'], ['bairro', 'Centro'], ['endereco', 'Rua Exemplo 88, portão verde']]) await mor.fill('#' + k, v);
    await mor.click('text=Usar meu GPS'); await mor.waitForFunction(() => /GPS não respondeu/.test(document.getElementById('aviso').textContent), null, { timeout: 25000 });
    await mor.fill('#link', 'https://www.google.com/maps/place/X/@-30.0379,-51.2146,17z'); assert.match(await mor.textContent('#ponto'), /Ponto marcado/);
    await mor.click('text=Marcar no mapa'); await mor.waitForSelector('#mapinha.leaflet-container'); await mor.waitForSelector('#semtile:not([hidden])');
    await mor.click('#mapinha', { position: { x: 120, y: 150 } });
    await mor.reload(); await mor.waitForSelector('#morador');
    assert.equal(await mor.inputValue('#morador'), 'Gil Fictício'); assert.match(await mor.textContent('#ponto'), /Ponto marcado/);
    assert.equal(await mor.isVisible('text=Remover a foto'), false);
    await foto(mor, '02-morador-novo-pedido');
    await mor.click('text=Enviar pedido'); await mor.waitForSelector('.card.medir'); await foto(mor, '03-morador-meus-pedidos');
  });
  const med = await celular('medir', 'Bento Medidor', { mapaReal: true });
  await etapa('medição: lista, mapa, endereço e Google Maps só depois de assumir', async () => {
    await med.waitForSelector('.card'); await foto(med, '04-medicao-lista');
    assert.ok(!(await med.textContent('#tela')).includes('Rua Modelo 10'));
    await med.click('#nav >> text=Mapa'); await med.waitForSelector('.pino'); await med.waitForTimeout(4000); await foto(med, '05-medicao-mapa');
    assert.match(await med.textContent('.leaflet-control-attribution'), /OpenStreetMap/);
    await med.goto(url + '/#/p/' + ids[0]); await med.waitForSelector('#assumir'); await foto(med, '06-medicao-antes-de-assumir');
    await med.click('#assumir'); await med.waitForSelector('#concluir'); assert.match(await med.textContent('#tela'), /Rua Modelo 10/);
    assert.equal(await med.getAttribute('a:has-text("Google Maps")', 'href'), 'https://www.google.com/maps/dir/?api=1&destination=-30.0358%2C-51.2165');
  });
  await etapa('conflito na tela: quem chega depois vê quem está indo; sem sinal a trava não é prometida', async () => {
    const m2 = await celular('medir', 'Zeca Segundo'); await m2.goto(url + '/#/p/' + ids[1]); await m2.waitForSelector('#assumir');
    const rita = await cliente(url, 'medir', 'Rita Rápida'); assert.equal((await rita('POST', `pedidos/${ids[1]}/assumir`, {})).status, 200);
    await m2.click('#assumir'); await m2.waitForSelector('text=Rita está indo'); assert.match(await m2.textContent('#aviso'), /Rita já está nesta casa/);
    assert.equal(await m2.locator('#concluir').count(), 0); await foto(m2, '07-conflito-alguem-ja-foi');
    await rita('POST', `pedidos/${ids[1]}/soltar`, {}); await m2.reload(); await m2.waitForSelector('#assumir');
    await m2.context().setOffline(true); await m2.click('#assumir');
    await m2.waitForFunction(() => /NÃO foi confirmada/.test(document.getElementById('aviso').textContent)); await foto(m2, '08-sem-sinal-trava-nao-confirmada');
    await m2.context().close();
  });
  await etapa('rede cortada: mede sem sinal, recarrega, fecha a página; volta a rede e chega uma vez só', async () => {
    await med.evaluate(() => navigator.serviceWorker.ready.then(() => 1)); await med.context().setOffline(true);
    await med.fill('#nome0', 'Janela da sala'); await med.fill('#larg0', '98,5'); await med.fill('#alt0', '60');
    await med.reload(); await med.waitForSelector('#larg0'); assert.equal(await med.inputValue('#larg0'), '98,5', 'rascunho sobrevive ao recarregar sem rede');
    assert.match(await med.textContent('#tela'), /Rua Modelo 10/, 'endereço da casa assumida abre sem rede');
    await med.click('#maisvao'); await med.fill('#larg1', '40'); await med.fill('#alt1', '30,2'); await med.fill('#obs', 'Levar escada');
    await med.setInputFiles('#foto', join(CAP, '01-entrar-codigo-errado.png')); await med.waitForSelector('text=Foto guardada');
    await foto(med, '09-medicao-formulario-sem-sinal');
    await med.click('#concluir'); await med.waitForSelector('text=1 para enviar'); await foto(med, '10-medicao-guardado-sem-sinal'); assert.equal(await naFila(med), 1);
    const ctx = med.context(); await med.close();
    const n = await ctx.newPage(); n.on('pageerror', e => erros.push('reaberta: ' + e.message));
    await n.goto(url + '/'); await n.waitForSelector('text=1 para enviar');
    await ctx.setOffline(false); await filaVazia(n);
    const c = await cliente(url, 'coord', 'Conferente'), v = await c('GET', 'pedidos/' + ids[0]);
    assert.equal(v.etapa, 'cortar'); assert.deepEqual(v.medidas.map(m => [m.larg, m.alt]), [[98.5, 60], [40, 30.2]]); assert.equal(v.fotos.length, 1);
    assert.equal(v.historico.filter(h => h.acao === 'concluir').length, 1);
    await n.waitForSelector('text=conectado'); await n.waitForTimeout(800); await foto(n, '11-medicao-depois-de-enviar');
    assert.equal(await n.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('d:')).length), 0, 'endereço apagado do aparelho depois de concluir');
  });
  await etapa('servidor fora do ar (não só o celular): pedido fica guardado e entra quando volta', async () => {
    await mor.click('text=Pedir troca de vidro');
    for (const [k, v] of [['morador', 'Hugo Fictício'], ['telefone', '(00) 90000-0088'], ['bairro', 'Bairro Sul'], ['endereco', 'Rua Exemplo 5']]) await mor.fill('#' + k, v);
    await srv.parar(); await mor.click('text=Enviar pedido'); await mor.waitForSelector('text=1 para enviar'); await foto(mor, '12-morador-servidor-fora');
    srv = await iniciar({ porta, dbPath: join(dir, 'ui.db'), codigos });
    await mor.click('text=Atualizar agora'); await filaVazia(mor); await mor.waitForSelector('.card.medir >> nth=1');
  });
  await etapa('vidraçaria: vê medidas e foto do vão, não vê endereço; corta', async () => {
    const p = await celular('cortar', 'Vidraçaria Um'); await p.waitForSelector('.card'); await foto(p, '13-vidracaria-lista');
    await p.goto(url + '/#/p/' + ids[0]); await p.click('#assumir'); await p.waitForSelector('#retirar');
    const t = await p.textContent('#tela'); assert.match(t, /98,5 × 60/); assert.match(t, /Levar escada/); assert.ok(!/Rua Modelo|Ana Fict/.test(t));
    await p.click('summary:has-text("foto")'); await p.waitForFunction(() => document.querySelector('img.foto')?.naturalWidth > 0);
    await p.click('#concluir'); await p.waitForSelector('.caixa.erro'); await foto(p, '14-vidracaria-cortar');
    await p.fill('#retirar', 'Balcão da vidraçaria exemplo'); await p.click('#concluir'); await p.waitForFunction(() => location.hash === '#/'); await filaVazia(p);
  });
  await etapa('instalação: retira e conclui', async () => {
    const p = await celular('instalar', 'Ivo Instalador'); await p.waitForSelector('.card'); await foto(p, '15-instalacao-lista');
    await p.goto(url + '/#/p/' + ids[0]); await p.click('#assumir'); await p.waitForSelector('#concluir');
    assert.match(await p.textContent('#tela'), /Balcão da vidraçaria exemplo/); await p.waitForTimeout(600); await foto(p, '16-instalacao-casa');
    await p.click('#concluir'); await p.waitForFunction(() => location.hash === '#/'); await filaVazia(p);
    const c = await cliente(url, 'coord', 'Conferente'); assert.equal((await c('GET', 'pedidos/' + ids[0])).etapa, 'concluido');
  });
  const tarde = await celular('medir', 'Tarcísio Tarde');
  await etapa('envio que chegou tarde (outra pessoa assumiu): dado fica guardado, com saída', async () => {
    await tarde.goto(url + '/#/p/' + ids[5]); await tarde.click('#assumir'); await tarde.waitForSelector('#larg0');
    await tarde.fill('#larg0', '50'); await tarde.fill('#alt0', '70'); await tarde.context().setOffline(true);
    await tarde.click('#concluir'); await tarde.waitForSelector('text=1 para enviar');
    const c = await cliente(url, 'coord', 'Conferente'), o = await cliente(url, 'medir', 'Outro Medidor');
    await c('POST', `pedidos/${ids[5]}/soltar`, {}); await o('POST', `pedidos/${ids[5]}/assumir`, {});
    await tarde.context().setOffline(false); await tarde.waitForSelector('text=1 com problema'); await tarde.click('text=1 com problema');
    await tarde.waitForSelector('text=Outro já está nesta casa'); await foto(tarde, '17-envio-com-conflito');
    assert.ok((await tarde.evaluate(() => localStorage.fila)).includes('"larg":50'));
    await tarde.click('text=Abrir e tentar de novo'); await tarde.waitForSelector('text=Outro está indo');
    assert.ok((await tarde.evaluate(id => localStorage['r:' + id + ':medir'], ids[5])).includes('"larg":"50"'), 'medida volta a rascunho');
  });
  await etapa('coordenação: painel, mapa, libera casa', async () => {
    const p = await celular('coord', 'Cora Coordena', { mapaReal: true }); await p.waitForSelector('.card'); await foto(p, '18-coordenacao-painel');
    await p.click('#nav >> text=Mapa'); await p.waitForSelector('.pino'); await p.waitForTimeout(4000); await foto(p, '19-coordenacao-mapa');
    await p.goto(url + '/#/p/' + ids[5]); await p.waitForTimeout(1500); await p.click('summary:has-text("Coordenação")');
    await foto(p, '20-coordenacao-casa'); await p.click('text=Liberar a casa'); await p.waitForFunction(() => /liberada/.test(document.getElementById('aviso').textContent));
  });
  await etapa('sair apaga tudo do aparelho e fecha o acesso', async () => {
    await mor.goto(url + '/#/envios'); await mor.click('text=Sair deste celular'); await mor.waitForSelector('#codigo');
    assert.ok(!/Fictício|Rua/.test(await mor.evaluate(() => JSON.stringify(localStorage))));
    assert.equal(await mor.evaluate(() => fetch('/api/pedidos').then(r => r.status)), 401);
  });
  const peso = await tarde.evaluate(() => performance.getEntriesByType('resource').filter(r => !r.name.includes('/api/')).map(r => [r.name.split('/').pop(), r.encodedBodySize]));
  console.log('Arquivos da página (bytes comprimidos):', JSON.stringify(peso));
  assert.deepEqual(erros, []); console.log('Sem erro de JavaScript. TUDO PASSOU');
} catch (e) { console.error('FALHOU', e, erros); process.exitCode = 1; } finally { await b.close(); await srv.parar(); rmSync(dir, { recursive: true, force: true }); }
