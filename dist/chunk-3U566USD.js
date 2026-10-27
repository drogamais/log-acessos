// src/core.ts
import pg from "pg";
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

export {
  normalizarCaminho,
  caminhoFrontend,
  corpoAuditoria,
  usuarioPadrao,
  criarFiltroRotas,
  criarControleVisitas,
  criarLogAcessos
};
