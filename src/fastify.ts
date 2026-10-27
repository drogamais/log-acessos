import { criarLogAcessos, usuarioPadrao, type OpcoesLogAcessos, type Usuario } from './core.js';

export interface OpcoesFastify extends OpcoesLogAcessos {
  /** Como achar o usuário. Padrão: usuarioPadrao(request.user). */
  usuario?: (request: any) => Usuario | null;
}

/**
 * Plugin Fastify (v4 e v5). Registre DEPOIS do plugin de autenticação:
 *
 *   import { logAcessos } from '@drogamais/log-acessos/fastify'
 *   await app.register(logAcessos, { aplicacao: 'lojas' })
 */
export async function logAcessos(fastify: any, opcoes: OpcoesFastify): Promise<void> {
  const log = criarLogAcessos(opcoes);
  const usuario = opcoes.usuario ?? ((request: any) => usuarioPadrao(request.user));

  fastify.addHook('onResponse', async (request: any, reply: any) => {
    log.registrar({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: request.body,
      statusCode: reply.statusCode,
      usuario: usuario(request),
    });
  });
  fastify.addHook('onClose', async () => log.fechar());
}

// Sem fastify-plugin como dependência: estas duas marcas fazem o mesmo —
// o hook vale para o app inteiro, não só para um escopo encapsulado.
(logAcessos as any)[Symbol.for('skip-override')] = true;
(logAcessos as any)[Symbol.for('fastify.display-name')] = 'log-acessos';

export default logAcessos;
