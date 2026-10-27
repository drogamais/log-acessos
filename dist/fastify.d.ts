import { OpcoesLogAcessos, Usuario } from './index.js';

interface OpcoesFastify extends OpcoesLogAcessos {
    /** Como achar o usuário. Padrão: usuarioPadrao(request.user). */
    usuario?: (request: any) => Usuario | null;
}
/**
 * Plugin Fastify (v4 e v5). Registre DEPOIS do plugin de autenticação:
 *
 *   import { logAcessos } from '@drogamais/log-acessos/fastify'
 *   await app.register(logAcessos, { aplicacao: 'lojas' })
 */
declare function logAcessos(fastify: any, opcoes: OpcoesFastify): Promise<void>;

export { type OpcoesFastify, logAcessos as default, logAcessos };
