import { criarLogAcessos, usuarioPadrao, type OpcoesLogAcessos, type Usuario } from './core.js';

export interface OpcoesExpress extends OpcoesLogAcessos {
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
export function logAcessos(opcoes: OpcoesExpress) {
  const log = criarLogAcessos(opcoes);
  const usuario = opcoes.usuario ?? ((req: any) => usuarioPadrao(req.user ?? req.auth));

  return function logAcessosMiddleware(req: any, res: any, next: (err?: unknown) => void): void {
    res.on('finish', () => {
      log.registrar({
        method: req.method,
        url: req.originalUrl ?? req.url,
        headers: req.headers,
        body: req.body,
        statusCode: res.statusCode,
        usuario: usuario(req),
      });
    });
    next();
  };
}

export default logAcessos;
