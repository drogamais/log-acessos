import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarCaminho, caminhoFrontend, corpoAuditoria, usuarioPadrao } from '../dist/index.js';

test('normalizarCaminho troca ids por :id e tira query', () => {
  assert.equal(normalizarCaminho('/api/lojas/12345678000199?x=1'), '/api/lojas/:id');
  assert.equal(normalizarCaminho('/api/pedidos/42/itens/7'), '/api/pedidos/:id/itens/:id');
  assert.equal(normalizarCaminho('/api/x/3f2b1c4d-1a2b-4c3d-8e9f-0a1b2c3d4e5f'), '/api/x/:id');
  assert.equal(normalizarCaminho('/api/v2/produtos'), '/api/v2/produtos');
});

test('caminhoFrontend usa o Referer só quando é do mesmo domínio', () => {
  const host = 'analisemercado.drogamais.com.br';
  assert.equal(caminhoFrontend({ host, referer: `https://${host}/produtos/123?aba=2` }), '/produtos/:id');
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
