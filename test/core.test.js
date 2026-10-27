import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarCaminho, caminhoFrontend, corpoAuditoria, usuarioPadrao, criarControleVisitas, criarFiltroRotas } from '../dist/index.js';

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
