import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarCaminho, caminhoFrontend, corpoAuditoria, usuarioPadrao, criarControleVisitas, criarFiltroRotas,
  calcularAlteracoes, iguais, registrarAntes, registrarAlteracoes, lerRegistrado, classificarAparelho,
} from '../dist/index.js';

test('aparelho: User-Agents reais', () => {
  const ua = (s, extra = {}) => classificarAparelho({ 'user-agent': s, ...extra });
  const casos = [
    // Windows + Chrome / Edge
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      ['computador', 'Windows', 'Chrome']],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      ['computador', 'Windows', 'Edge']],
    // Mac + Safari / Firefox
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      ['computador', 'macOS', 'Safari']],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0', ['computador', 'macOS', 'Firefox']],
    // iPhone: Safari e Chrome (CriOS)
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ['celular', 'iOS', 'Safari']],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
      ['celular', 'iOS', 'Chrome']],
    // Android: Chrome reduzido (modelo "K"), Samsung Internet, WebView de app
    ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      ['celular', 'Android', 'Chrome']],
    ['Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
      ['celular', 'Android', 'Samsung Internet']],
    ['Mozilla/5.0 (Linux; Android 13; SM-A135M Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36',
      ['celular', 'Android', 'WebView']],
    // Tablet Android (sem "Mobile") e iPad antigo
    ['Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      ['tablet', 'Android', 'Chrome']],
    ['Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1',
      ['tablet', 'iOS', 'Safari']],
  ];
  for (const [s, [dispositivo, sistema, navegador]] of casos) {
    assert.deepEqual(ua(s), { dispositivo, sistema, navegador }, s);
  }
  // Client Hints mandam: Chrome "desktop mode" no Android ainda diz que é celular
  assert.deepEqual(
    ua('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      { 'sec-ch-ua-mobile': '?1', 'sec-ch-ua-platform': '"Android"' }),
    { dispositivo: 'celular', sistema: 'Android', navegador: 'Chrome' },
  );
  assert.equal(classificarAparelho({}), null);
});

test('aparelho: navegador pela marca do Sec-CH-UA (Brave se passa por Chrome no User-Agent)', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const nav = (secChUa, ua = chrome) => classificarAparelho({ 'user-agent': ua, 'sec-ch-ua': secChUa, 'sec-ch-ua-platform': '"Windows"' }).navegador;
  assert.equal(nav('"Chromium";v="130", "Brave";v="130", "Not?A_Brand";v="99"'), 'Brave');
  assert.equal(nav('"Google Chrome";v="130", "Chromium";v="130", "Not_A Brand";v="24"'), 'Chrome');
  assert.equal(nav('"Microsoft Edge";v="130", "Chromium";v="130", "Not?A_Brand";v="99"'), 'Edge');
  assert.equal(nav('"Opera";v="114", "Chromium";v="128", "Not;A=Brand";v="24"'), 'Opera');
  // só Chromium: não afirma Chrome
  assert.equal(nav('"Chromium";v="130", "Not?A_Brand";v="99"'), 'Chromium');
  // sem o cabeçalho, como antes: pelo User-Agent
  assert.equal(nav(undefined), 'Chrome');
  assert.equal(nav(undefined, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'), 'Firefox');
  // WebView de app Android
  assert.equal(
    classificarAparelho({ 'user-agent': 'Mozilla/5.0 (Linux; Android 13; SM-A135M; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36',
      'sec-ch-ua': '"Android WebView";v="130", "Chromium";v="130", "Not?A_Brand";v="99"', 'sec-ch-ua-mobile': '?1' }).navegador,
    'WebView',
  );
});
import * as fastify from '../dist/fastify.js';
import * as express from '../dist/express.js';

test('helpers saem também por /fastify e /express', () => {
  assert.equal(typeof fastify.registrarAntes, 'function');
  assert.equal(typeof express.registrarAlteracoes, 'function');
});

test('iguais: vazios, número x texto e data x data-hora não são mudança', () => {
  assert.equal(iguais('', null), true);
  assert.equal(iguais(undefined, null), true);
  assert.equal(iguais(73, '73'), true);
  assert.equal(iguais('2026-10-23', new Date('2026-10-23T00:00:00Z')), true);
  assert.equal(iguais({ a: [1] }, { a: [1] }), true);
  assert.equal(iguais('PLUGPHARMA', 'API_SID'), false);
  assert.equal(iguais(true, false), false);
  assert.equal(iguais(0, null), false);
});

test('alteracoes: antes x corpo enviado, só o que mudou', () => {
  const antes = { fonte_de_dados: 'PLUGPHARMA', fantasia: 'Madre Leonia', telefone: '', id: 73 };
  const corpo = { fonte_de_dados: 'API_SID', fantasia: 'Madre Leonia', telefone: null, id: '73' };
  assert.deepEqual(calcularAlteracoes('PATCH', corpo, antes, undefined), {
    fonte_de_dados: { de: 'PLUGPHARMA', para: 'API_SID' },
  });
  assert.equal(calcularAlteracoes('PATCH', { fantasia: 'Madre Leonia' }, antes, undefined), null);
  // campo novo (não existia no antes)
  assert.deepEqual(calcularAlteracoes('PUT', { email: 'a@x' }, {}, undefined), { email: { de: null, para: 'a@x' } });
});

test('alteracoes: de/para pronto tem prioridade e perde o ruído "" -> null', () => {
  const prontas = { telefone_fixo_2: { de: '', para: null }, fonte_de_dados: { de: 'PLUGPHARMA', para: 'API_SID' }, lixo: 1 };
  assert.deepEqual(calcularAlteracoes('PATCH', { x: 1 }, { x: 2 }, prontas), {
    fonte_de_dados: { de: 'PLUGPHARMA', para: 'API_SID' },
  });
});

test('alteracoes: DELETE grava o registro apagado; sem antes = null', () => {
  assert.deepEqual(calcularAlteracoes('DELETE', undefined, { nome: 'Ana', obs: '' }, undefined), {
    nome: { de: 'Ana', para: null },
  });
  assert.equal(calcularAlteracoes('PATCH', { a: 1 }, undefined, undefined), null);
});

test('alteracoes e corpo: sensível sai, oculto vira ***', () => {
  const ocultos = new Set(['cpf']);
  assert.deepEqual(
    calcularAlteracoes('PUT', { cpf: '222', senha: 'x', nome: 'B' }, { cpf: '111', senha: 'y', nome: 'A' }, undefined, ocultos),
    { cpf: { de: '***', para: '***' }, nome: { de: 'A', para: 'B' } },
  );
  assert.equal(corpoAuditoria({ nome: 'B', cpf: '222', rg: '' }, new Set(['cpf', 'rg'])), '{"nome":"B","cpf":"***","rg":""}');
});

test('registrarAntes/registrarAlteracoes chegam ao adaptador', () => {
  const req = {};
  registrarAntes(req, { a: 1 });
  registrarAlteracoes(req, { a: { de: 1, para: 2 } });
  assert.deepEqual(lerRegistrado(req), { antes: { a: 1 }, alteracoes: { a: { de: 1, para: 2 } } });
});

test('ignorarAuditoria: rota exata, prefixo de segmento e RegExp', () => {
  const f = criarFiltroRotas(['/api/lojas/preferences', /\/rascunho$/]);
  assert.equal(f('/api/lojas/preferences'), true);
  assert.equal(f('/api/lojas/preferences/:id'), true);
  assert.equal(f('/api/lojas/preferencesX'), false);
  assert.equal(f('/api/lojas/:id'), false);
  assert.equal(f('/api/pedidos/:id/rascunho'), true);
  assert.equal(criarFiltroRotas([])('/api/x'), false);
});

test('visitas: várias chamadas da mesma página = 1 visita', () => {
  const v = criarControleVisitas(30 * 60_000);
  const t = 1_000_000;
  assert.equal(v.visitaNova('ana', '/', t), true);
  assert.equal(v.visitaNova('ana', '/', t + 100), false);
  assert.equal(v.visitaNova('ana', '/', t + 200), false);
  // outro usuário na mesma página é outra visita
  assert.equal(v.visitaNova('joao', '/', t + 300), true);
});

test('visitas: ir e voltar entre páginas dentro da janela não repete', () => {
  const v = criarControleVisitas(30 * 60_000);
  assert.equal(v.visitaNova('ana', '/a', 0), true);
  assert.equal(v.visitaNova('ana', '/b', 1000), true);
  assert.equal(v.visitaNova('ana', '/a', 2000), false);
  assert.equal(v.visitaNova('ana', '/b', 3000), false);
});

test('visitas: duas abas em polling alternado = 1 linha por página por janela', () => {
  // caso real do chamados: /demandas e /tarefas abertas, consultando a cada 30 s
  const j = 30 * 60_000;
  const v = criarControleVisitas(j);
  let gravadas = 0;
  for (let t = 0; t < 2 * j; t += 30_000) {
    if (v.visitaNova('ana', t % 60_000 ? '/tarefas' : '/demandas', t)) gravadas++;
  }
  assert.equal(gravadas, 4); // 2 páginas × 2 janelas (antes: 240)
});

test('visitas: a janela conta da última gravação, não da última chamada', () => {
  const j = 30 * 60_000;
  const v = criarControleVisitas(j);
  assert.equal(v.visitaNova('ana', '/', 0), true);
  assert.equal(v.visitaNova('ana', '/', j - 1), false);
  // uso contínuo: uma linha nova a cada janela
  assert.equal(v.visitaNova('ana', '/', j), true);
  assert.equal(v.visitaNova('ana', '/', 2 * j - 1), false);
  assert.equal(v.visitaNova('ana', '/', 2 * j), true);
});

test('normalizarCaminho troca ids por :id e tira query', () => {
  assert.equal(normalizarCaminho('/api/lojas/12345678000199?x=1'), '/api/lojas/:id');
  assert.equal(normalizarCaminho('/api/pedidos/42/itens/7'), '/api/pedidos/:id/itens/:id');
  assert.equal(normalizarCaminho('/api/x/3f2b1c4d-1a2b-4c3d-8e9f-0a1b2c3d4e5f'), '/api/x/:id');
  assert.equal(normalizarCaminho('/api/v2/produtos'), '/api/v2/produtos');
});

test('caminhoFrontend usa o Referer só quando é do mesmo domínio', () => {
  const host = 'analisemercado.drogamais.com.br';
  // mantém o ID (qual produto/campanha foi aberto); tira query e #
  assert.equal(caminhoFrontend({ host, referer: `https://${host}/produtos/123?aba=2#topo` }), '/produtos/123');
  assert.equal(caminhoFrontend({ host, referer: `https://${host}/campanha/a%C3%A7%C3%A3o` }), '/campanha/ação');
  assert.equal(caminhoFrontend({ host: 'backend:3000', 'x-forwarded-host': host, referer: `https://${host}/` }), '/');
  assert.equal(caminhoFrontend({ host, referer: 'https://google.com/busca' }), null);
  assert.equal(caminhoFrontend({ host }), null);
  assert.equal(caminhoFrontend({ host, referer: 'lixo' }), null);
});

test('corpoAuditoria remove campos sensíveis e trunca', () => {
  assert.equal(corpoAuditoria({ nome: 'a', Senha: 'x', token: 'y' }), '{"nome":"a"}');
  assert.equal(corpoAuditoria(null), null);
  assert.equal(corpoAuditoria([1, 2]), null);
  assert.ok(corpoAuditoria({ t: 'x'.repeat(3000) }).endsWith('…'));
});

test('usuarioPadrao entende os formatos do parque', () => {
  assert.deepEqual(usuarioPadrao({ email: 'a@x', name: 'Ana' }), { email: 'a@x', nome: 'Ana' });
  assert.deepEqual(usuarioPadrao({ email: 'a@x', groups: [] }), { email: 'a@x', nome: null });
  assert.deepEqual(usuarioPadrao({ username: 'joao', role: 'x' }), { email: 'joao', nome: 'joao' });
  assert.equal(usuarioPadrao(undefined), null);
});
