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
function classificarAparelho(headers) {
  const ua = cabecalho(headers, "user-agent") ?? "";
  const chMobile = cabecalho(headers, "sec-ch-ua-mobile");
  const chPlataforma = (cabecalho(headers, "sec-ch-ua-platform") ?? "").replace(/"/g, "").trim();
  if (!ua && !chPlataforma) return null;
  const plataformas = {
    Windows: "Windows",
    macOS: "macOS",
    Linux: "Linux",
    "Chrome OS": "ChromeOS",
    ChromeOS: "ChromeOS",
    Android: "Android",
    iOS: "iOS"
  };
  let sistema = plataformas[chPlataforma];
  if (!sistema) {
    if (/iPhone|iPad|iPod/.test(ua)) sistema = "iOS";
    else if (/Android/.test(ua)) sistema = "Android";
    else if (/Windows/.test(ua)) sistema = "Windows";
    else if (/CrOS/.test(ua)) sistema = "ChromeOS";
    else if (/Macintosh|Mac OS X/.test(ua)) sistema = "macOS";
    else if (/Linux/.test(ua)) sistema = "Linux";
    else sistema = "Outro";
  }
  let dispositivo;
  if (/iPad|Tablet/.test(ua) || sistema === "Android" && !/Mobile/.test(ua) && chMobile !== "?1") dispositivo = "tablet";
  else if (chMobile === "?1" || /iPhone|iPod|Mobi/.test(ua)) dispositivo = "celular";
  else if (["Windows", "macOS", "Linux", "ChromeOS"].includes(sistema)) dispositivo = "computador";
  else dispositivo = "outro";
  const marcas = [...(cabecalho(headers, "sec-ch-ua") ?? "").matchAll(/"([^"]+)";\s*v="/g)].map((m) => m[1]);
  const porMarca = [
    ["Brave", "Brave"],
    ["Microsoft Edge", "Edge"],
    ["Opera GX", "Opera"],
    ["Opera", "Opera"],
    ["Vivaldi", "Vivaldi"],
    ["Samsung Internet", "Samsung Internet"],
    ["Android WebView", "WebView"],
    ["Google Chrome", "Chrome"]
  ];
  const daMarca = porMarca.find(([marca]) => marcas.includes(marca))?.[1] ?? (marcas.includes("Chromium") ? "Chromium" : void 0);
  let navegador;
  if (daMarca) navegador = daMarca;
  else if (/Edg(e|A|iOS)?\//.test(ua)) navegador = "Edge";
  else if (/OPR\/|Opera/.test(ua)) navegador = "Opera";
  else if (/SamsungBrowser\//.test(ua)) navegador = "Samsung Internet";
  else if (/Firefox\/|FxiOS\//.test(ua)) navegador = "Firefox";
  else if (/; wv\)/.test(ua)) navegador = "WebView";
  else if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) navegador = "Chrome";
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) navegador = "Safari";
  else navegador = "Outro";
  return { dispositivo, sistema, navegador };
}
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
  const {
    aplicacao,
    acesso = true,
    auditoria = true,
    erros = true,
    agruparPorPagina = true,
    janelaVisitaMin = 30,
    janelaErroMin = 10
  } = opcoes;
  const visitas = criarControleVisitas(janelaVisitaMin * 6e4);
  const errosGravados = criarControleVisitas(janelaErroMin * 6e4);
  const auditoriaIgnorada = criarFiltroRotas(opcoes.ignorarAuditoria ?? []);
  const erroIgnorado = criarFiltroRotas(opcoes.ignorarErros ?? []);
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
        const rotaApi = corta(r.url.split("?")[0], 255);
        const gravarErro = erros && r.method === "GET" && r.statusCode >= 400 && !erroIgnorado(caminho) && errosGravados.visitaNova(email, `${rotaApi}\0${r.statusCode}`);
        const ap = gravarAcesso || gravarErro || auditoria && METODOS_ESCRITA.has(r.method) ? classificarAparelho(r.headers) : null;
        if (gravarAcesso) {
          gravar(
            `INSERT INTO log_acessos.fat_log_acesso
               (user_email, user_name, aplicacao, method, path_frontend, dispositivo, sistema, navegador)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [email, nome, aplicacao, r.method, paginaFrontend, ap?.dispositivo ?? null, ap?.sistema ?? null, ap?.navegador ?? null]
          );
        }
        if (gravarErro) {
          gravar(
            `INSERT INTO log_acessos.fat_erro_acesso
               (user_email, user_name, aplicacao, method, path, path_frontend, status_code,
                dispositivo, sistema, navegador)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              email,
              nome,
              aplicacao,
              r.method,
              rotaApi,
              paginaFrontend,
              r.statusCode,
              ap?.dispositivo ?? null,
              ap?.sistema ?? null,
              ap?.navegador ?? null
            ]
          );
        }
        if (auditoria && METODOS_ESCRITA.has(r.method) && !auditoriaIgnorada(caminho)) {
          const alteracoes = calcularAlteracoes(r.method, r.body, r.antes, r.alteracoes, ocultos);
          gravar(
            `INSERT INTO log_acessos.fat_log_portal
               (user_email, user_name, aplicacao, method, path, status_code, body, alteracoes,
                dispositivo, sistema, navegador)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
            [
              email,
              nome,
              aplicacao,
              r.method,
              rotaApi,
              r.statusCode,
              corpoAuditoria(r.body, ocultos),
              alteracoes ? JSON.stringify(alteracoes) : null,
              ap?.dispositivo ?? null,
              ap?.sistema ?? null,
              ap?.navegador ?? null
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
  classificarAparelho,
  corpoAuditoria,
  iguais,
  calcularAlteracoes,
  usuarioPadrao,
  criarFiltroRotas,
  criarControleVisitas,
  criarLogAcessos
};
