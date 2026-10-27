import {
  criarLogAcessos,
  usuarioPadrao
} from "./chunk-4BBIF72U.js";

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
        usuario: usuario(req)
      });
    });
    next();
  };
}
var express_default = logAcessos;
export {
  express_default as default,
  logAcessos
};
