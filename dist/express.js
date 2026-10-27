import {
  criarLogAcessos,
  lerRegistrado,
  registrarAlteracoes,
  registrarAntes,
  usuarioPadrao
} from "./chunk-SLLE73KR.js";

// src/express.ts
function logAcessos(opcoes) {
  const log = criarLogAcessos(opcoes);
  const usuario = opcoes.usuario ?? ((req) => usuarioPadrao(req.user ?? req.auth));
  return function logAcessosMiddleware(req, res, next) {
    res.on("finish", () => {
      log.registrar({
        method: req.method,
        url: req.originalUrl ?? req.url,
        headers: req.headers,
        body: req.body,
        statusCode: res.statusCode,
        usuario: usuario(req),
        ...lerRegistrado(req)
      });
    });
    next();
  };
}
var express_default = logAcessos;
export {
  express_default as default,
  logAcessos,
  registrarAlteracoes,
  registrarAntes
};
