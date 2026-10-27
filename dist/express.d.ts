import { OpcoesLogAcessos, Usuario } from './index.js';
export { registrarAlteracoes, registrarAntes } from './index.js';

interface OpcoesExpress extends OpcoesLogAcessos {
    /** Como achar o usuário. Padrão: usuarioPadrao(req.user ?? req.auth). */
    usuario?: (req: any) => Usuario | null;
}
/**
 * Middleware Express. Pode ir no topo (antes das rotas): o registro roda no
 * evento 'finish', quando o requireAuth de cada rota já preencheu o usuário.
 *
 *   import { logAcessos } from '@drogamais/log-acessos/express'
 *   app.use(express.json())
 *   app.use(logAcessos({ aplicacao: 'precifica' }))
 */
declare function logAcessos(opcoes: OpcoesExpress): (req: any, res: any, next: (err?: unknown) => void) => void;

export { type OpcoesExpress, logAcessos as default, logAcessos };
