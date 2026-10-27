"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/express.ts
var express_exports = {};
__export(express_exports, {
  default: () => express_default,
  logAcessos: () => logAcessos
});
module.exports = __toCommonJS(express_exports);

// src/core.ts
var import_pg = __toESM(require("pg"), 1);
var EXT_IGNORAR = /\.(js|mjs|css|map|png|jpe?g|svg|gif|webp|ico|woff2?|ttf|eot)$/i;
var METODOS_ESCRITA = /* @__PURE__ */ new Set(["POST", "PUT", "PATCH", "DELETE"]);
var CAMPOS_SENSIVEIS = /* @__PURE__ */ new Set(["password", "senha", "token", "secret", "access_token", "refresh_token"]);
function normalizarCaminho(caminho) {
  const semQuery = caminho.split("?")[0].split("#")[0] || "/";
  return semQuery.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, "/:id").replace(/\/[0-9]+(?=\/|$)/g, "/:id");
}
function cabecalho(headers, nome) {
  const v = headers[nome];
  return Array.isArray(v) ? v[0] : v;
}
function caminhoFrontend(headers) {
  const referer = cabecalho(headers, "referer");
  if (!referer) return null;
  let url;
  try {
    url = new URL(referer);
  } catch {
    return null;
  }
  const hosts = [cabecalho(headers, "x-forwarded-host"), cabecalho(headers, "host")].flatMap((h) => h ? h.split(",") : []).map((h) => h.trim().toLowerCase());
  if (!hosts.includes(url.host.toLowerCase())) return null;
  return normalizarCaminho(url.pathname);
}
function corpoAuditoria(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const copia = { ...body };
  for (const campo of Object.keys(copia)) {
    if (CAMPOS_SENSIVEIS.has(campo.toLowerCase())) delete copia[campo];
  }
  const json = JSON.stringify(copia);
  return json.length > 2e3 ? json.slice(0, 2e3) + "\u2026" : json;
}
function usuarioPadrao(u) {
  if (!u || typeof u !== "object") return null;
  const o = u;
  const email = o.email ?? o.preferred_username ?? o.username;
  if (!email) return null;
  const nome = o.name ?? o.nome ?? o.preferred_username ?? o.username ?? null;
  return { email: String(email), nome: nome == null ? null : String(nome) };
}
var corta = (s, n) => s.length > n ? s.slice(0, n) : s;
function criarFiltroRotas(regras) {
  const testes = regras.map((r) => {
    if (r instanceof RegExp) return (c) => r.test(c);
    const base = r.replace(/\/+$/, "");
    return (c) => c === base || c.startsWith(base + "/");
  });
  return (caminho) => testes.some((t) => t(caminho));
}
function criarControleVisitas(janelaMs) {
  const ultimas = /* @__PURE__ */ new Map();
  let ultimaLimpeza = 0;
  return {
    visitaNova(usuario, pagina, agora = Date.now()) {
      if (agora - ultimaLimpeza > janelaMs) {
        for (const [k, v] of ultimas) if (agora - v.quando > janelaMs) ultimas.delete(k);
        ultimaLimpeza = agora;
      }
      const ultima = ultimas.get(usuario);
      const nova = !ultima || ultima.pagina !== pagina || agora - ultima.quando > janelaMs;
      ultimas.set(usuario, { pagina, quando: agora });
      return nova;
    }
  };
}
function criarLogAcessos(opcoes) {
  const { aplicacao, acesso = true, auditoria = true, agruparPorPagina = true, janelaVisitaMin = 30 } = opcoes;
  const visitas = criarControleVisitas(janelaVisitaMin * 6e4);
  const auditoriaIgnorada = criarFiltroRotas(opcoes.ignorarAuditoria ?? []);
  const url = opcoes.connectionString ?? process.env.DATABASE_OPERATIONAL_URL;
  let pool = null;
  let ultimoErro = 0;
  function avisar(msg, err) {
    const agora = Date.now();
    if (agora - ultimoErro < 6e4) return;
    ultimoErro = agora;
    console.error(`[log-acessos] ${aplicacao}: ${msg}`, err instanceof Error ? err.message : err ?? "");
  }
  function obterPool() {
    if (pool) return pool;
    if (!url) {
      avisar("DATABASE_OPERATIONAL_URL n\xE3o definida \u2014 log desligado");
      return null;
    }
    const u = new URL(url);
    u.searchParams.delete("schema");
    u.searchParams.delete("connection_limit");
    pool = new import_pg.default.Pool({
      connectionString: u.toString(),
      // 1 conexão que fecha quando ociosa: o log não disputa o
      // max_connections do pgDrogamais com o pool do app.
      max: 1,
      idleTimeoutMillis: 3e4,
      connectionTimeoutMillis: 5e3,
      // created_at = DEFAULT CURRENT_TIMESTAMP da coluna (timestamp sem fuso):
      // a sessão em São Paulo garante o mesmo horário em todos os apps.
      options: "-c timezone=America/Sao_Paulo"
    });
    pool.on("error", (e) => avisar("conex\xE3o ociosa caiu", e));
    return pool;
  }
  function gravar(sql, valores) {
    const p = obterPool();
    if (!p) return;
    p.query(sql, valores).catch((e) => avisar("falha ao gravar", e));
  }
  return {
    registrar(r) {
      try {
        if (!r.usuario?.email || r.method === "OPTIONS") return;
        const caminho = normalizarCaminho(r.url);
        if (EXT_IGNORAR.test(caminho)) return;
        const email = corta(r.usuario.email, 100);
        const nome = corta(r.usuario.nome || r.usuario.email, 150);
        const paginaFrontend = caminhoFrontend(r.headers);
        const gravarAcesso = acesso && (!agruparPorPagina || !paginaFrontend || visitas.visitaNova(email, paginaFrontend));
        if (gravarAcesso) {
          gravar(
            `INSERT INTO log_acessos.fat_log_acesso
               (user_email, user_name, aplicacao, method, path, path_frontend)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            // Com página do frontend, a rota da API não acrescenta nada (é só
            // a 1ª chamada da visita): path fica NULL. Sem página (script,
            // integração), a rota é a única informação — grava.
            [email, nome, aplicacao, r.method, paginaFrontend ? null : corta(caminho, 255), paginaFrontend]
          );
        }
        if (auditoria && METODOS_ESCRITA.has(r.method) && !auditoriaIgnorada(caminho)) {
          gravar(
            `INSERT INTO log_acessos.fat_log_portal
               (user_email, user_name, aplicacao, method, path, status_code, body)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            // Sem query string: pode trazer CPF/termos de busca.
            [email, nome, aplicacao, r.method, corta(r.url.split("?")[0], 255), r.statusCode, corpoAuditoria(r.body)]
          );
        }
      } catch (e) {
        avisar("erro inesperado", e);
      }
    },
    async fechar() {
      if (pool) await pool.end();
      pool = null;
    }
  };
}

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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  logAcessos
});
