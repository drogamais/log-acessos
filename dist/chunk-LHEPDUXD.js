// src/core.ts
import pg from "pg";
var ANTES = Symbol.for("@drogamais/log-acessos.antes");
var ALTERACOES = Symbol.for("@drogamais/log-acessos.alteracoes");
function registrarAntes(req, registro) {
  req[ANTES] = registro;
}
function registrarAlteracoes(req, alteracoes) {
  req[ALTERACOES] = alteracoes;
}
function lerRegistrado(req) {
  return { antes: req[ANTES], alteracoes: req[ALTERACOES] };
}
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
  let caminho = url.pathname || "/";
  try {
    caminho = decodeURI(caminho);
  } catch {
  }
  return caminho.length > 255 ? caminho.slice(0, 255) : caminho;
}
var OCULTO = "***";
function corpoAuditoria(body, ocultos = /* @__PURE__ */ new Set()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const copia = { ...body };
  for (const campo of Object.keys(copia)) {
    const c = campo.toLowerCase();
    if (CAMPOS_SENSIVEIS.has(c)) delete copia[campo];
    else if (ocultos.has(c) && copia[campo] != null && copia[campo] !== "") copia[campo] = OCULTO;
  }
  const json = JSON.stringify(copia);
  return json.length > 2e3 ? json.slice(0, 2e3) + "\u2026" : json;
}
var ehObjeto = (v) => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
function comoJson(v) {
  if (v === void 0) return null;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
}
function iguais(a, b) {
  const x = comoJson(a);
  const y = comoJson(b);
  const vazio = (v) => v === null || v === "";
  if (vazio(x) && vazio(y)) return true;
  if (JSON.stringify(x) === JSON.stringify(y)) return true;
  if (typeof x !== "object" && typeof y !== "object" && x !== null && y !== null) {
    const sx = String(x);
    const sy = String(y);
    if (sx === sy) return true;
    const soData = /^\d{4}-\d{2}-\d{2}$/;
    if (soData.test(sx) && sy.startsWith(sx + "T00:00:00")) return true;
    if (soData.test(sy) && sx.startsWith(sy + "T00:00:00")) return true;
  }
  return false;
}
var LIMITE_VALOR = 500;
var LIMITE_ALTERACOES = 2e4;
function valorAuditoria(v) {
  const j = comoJson(v);
  return typeof j === "string" && j.length > LIMITE_VALOR ? j.slice(0, LIMITE_VALOR) + "\u2026" : j;
}
function calcularAlteracoes(method, body, antes, prontas, ocultos = /* @__PURE__ */ new Set()) {
  let pares = [];
  if (ehObjeto(prontas)) {
    for (const [k, v] of Object.entries(prontas)) {
      if (ehObjeto(v) && ("de" in v || "para" in v)) pares.push([k, v.de, v.para]);
    }
  } else if (ehObjeto(antes)) {
    if (method === "DELETE") pares = Object.entries(antes).map(([k, v]) => [k, v, null]);
    else if (ehObjeto(body)) pares = Object.entries(body).map(([k, v]) => [k, antes[k], v]);
  }
  const out = {};
  let tamanho = 0;
  for (const [campo, de, para] of pares) {
    const c = campo.toLowerCase();
    if (CAMPOS_SENSIVEIS.has(c) || iguais(de, para)) continue;
    const item = ocultos.has(c) ? { de: de == null || de === "" ? null : OCULTO, para: para == null || para === "" ? null : OCULTO } : { de: valorAuditoria(de), para: valorAuditoria(para) };
    tamanho += JSON.stringify(item).length + campo.length;
    if (tamanho > LIMITE_ALTERACOES) {
      out._truncado = { de: null, para: true };
      break;
    }
    out[campo] = item;
  }
  return Object.keys(out).length ? out : null;
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
  const gravadas = /* @__PURE__ */ new Map();
  let ultimaLimpeza = 0;
  return {
    visitaNova(usuario, pagina, agora = Date.now()) {
      if (agora - ultimaLimpeza > janelaMs) {
        for (const [k, quando2] of gravadas) if (agora - quando2 >= janelaMs) gravadas.delete(k);
        ultimaLimpeza = agora;
      }
      const chave = `${usuario}\0${pagina}`;
      const quando = gravadas.get(chave);
      if (quando !== void 0 && agora - quando < janelaMs) return false;
      gravadas.set(chave, agora);
      return true;
    }
  };
}
function criarLogAcessos(opcoes) {
  const { aplicacao, acesso = true, auditoria = true, agruparPorPagina = true, janelaVisitaMin = 30 } = opcoes;
  const visitas = criarControleVisitas(janelaVisitaMin * 6e4);
  const auditoriaIgnorada = criarFiltroRotas(opcoes.ignorarAuditoria ?? []);
  const ocultos = new Set((opcoes.ocultarCampos ?? []).map((c) => c.toLowerCase()));
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
    pool = new pg.Pool({
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
        const gravarAcesso = acesso && !!paginaFrontend && (!agruparPorPagina || visitas.visitaNova(email, paginaFrontend));
        if (gravarAcesso) {
          gravar(
            `INSERT INTO log_acessos.fat_log_acesso
               (user_email, user_name, aplicacao, method, path_frontend)
             VALUES ($1, $2, $3, $4, $5)`,
            [email, nome, aplicacao, r.method, paginaFrontend]
          );
        }
        if (auditoria && METODOS_ESCRITA.has(r.method) && !auditoriaIgnorada(caminho)) {
          const alteracoes = calcularAlteracoes(r.method, r.body, r.antes, r.alteracoes, ocultos);
          gravar(
            `INSERT INTO log_acessos.fat_log_portal
               (user_email, user_name, aplicacao, method, path, status_code, body, alteracoes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
            // Sem query string: pode trazer CPF/termos de busca.
            [
              email,
              nome,
              aplicacao,
              r.method,
              corta(r.url.split("?")[0], 255),
              r.statusCode,
              corpoAuditoria(r.body, ocultos),
              alteracoes ? JSON.stringify(alteracoes) : null
            ]
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

export {
  registrarAntes,
  registrarAlteracoes,
  lerRegistrado,
  normalizarCaminho,
  caminhoFrontend,
  corpoAuditoria,
  iguais,
  calcularAlteracoes,
  usuarioPadrao,
  criarFiltroRotas,
  criarControleVisitas,
  criarLogAcessos
};
