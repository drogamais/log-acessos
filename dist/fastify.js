import {
  criarLogAcessos,
  usuarioPadrao
} from "./chunk-3U566USD.js";

// src/fastify.ts
async function logAcessos(fastify, opcoes) {
  const log = criarLogAcessos(opcoes);
  const usuario = opcoes.usuario ?? ((request) => usuarioPadrao(request.user));
  fastify.addHook("onResponse", async (request, reply) => {
    log.registrar({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: request.body,
      statusCode: reply.statusCode,
      usuario: usuario(request)
    });
  });
  fastify.addHook("onClose", async () => log.fechar());
}
logAcessos[Symbol.for("skip-override")] = true;
logAcessos[Symbol.for("fastify.display-name")] = "log-acessos";
var fastify_default = logAcessos;
export {
  fastify_default as default,
  logAcessos
};
