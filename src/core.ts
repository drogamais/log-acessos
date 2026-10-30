import pg from 'pg';

/** Quem fez a requisição. `nome` cai no email quando não vier. */
export interface Usuario {
  email: string;
  nome?: string | null;
}

export interface OpcoesLogAcessos {
  /** Nome da aplicação gravado na coluna `aplicacao` (ex.: 'lojas'). */
  aplicacao: string;
  /** URL do pgDrogamais PRINCIPAL. Padrão: process.env.DATABASE_OPERATIONAL_URL. */
  connectionString?: string;
  /** Grava toda requisição de usuário logado em fat_log_acesso. Padrão: true. */
  acesso?: boolean;
  /** Grava escritas (POST/PUT/PATCH/DELETE) com o corpo em fat_log_portal. Padrão: true. */
  auditoria?: boolean;
  /**
   * Grava leituras (GET) que falharam (status >= 400) em fat_erro_acesso:
   * 403 (sem permissão), 404 (registro inexistente), 5xx (a API quebrou).
   * Escrita com erro já vai para fat_log_portal. Padrão: true.
   */
  erros?: boolean;
  /** Minutos até o mesmo usuário + rota + status poder gravar de novo. Padrão: 10. */
  janelaErroMin?: number;
  /**
   * Rotas cujo erro de leitura NÃO é gravado — ex.: uma consulta em que o 404
   * é resposta normal ("ainda não cadastrado"). Mesmas regras do
   * ignorarAuditoria.
   */
  ignorarErros?: (string | RegExp)[];
  /**
   * Rotas que a auditoria NÃO grava (o acesso continua). String = rota exata
   * ou prefixo (`/api/x` pega `/api/x` e `/api/x/...`); RegExp = teste livre.
   * Comparado com o caminho sem query e com IDs já como `:id`.
   * Ex.: preferências de tela, que mudam a cada ajuste de coluna.
   */
  ignorarAuditoria?: (string | RegExp)[];
  /**
   * fat_log_acesso grava uma linha por VISITA de página (path_frontend), não
   * por chamada de API: a mesma página do mesmo usuário grava no máximo uma
   * vez por janela (janelaVisitaMin). Padrão: true.
   */
  agruparPorPagina?: boolean;
  /** Minutos até a mesma página do mesmo usuário poder gravar de novo. Padrão: 30. */
  janelaVisitaMin?: number;
  /**
   * Campos de dado pessoal que a auditoria guarda como "***" (no corpo e no
   * de/para): o log mostra QUE mudou, não o valor. Ex.: ['cpf', 'rg'].
   * Senha/token já saem sempre.
   */
  ocultarCampos?: string[];
}

/** De/para de uma escrita: só os campos que mudaram. */
export type Alteracoes = Record<string, { de: unknown; para: unknown }>;

const ANTES = Symbol.for('@drogamais/log-acessos.antes');
const ALTERACOES = Symbol.for('@drogamais/log-acessos.alteracoes');

/**
 * Na rota de PUT/PATCH/DELETE, informa o registro como estava ANTES da
 * escrita: a auditoria grava em `alteracoes` só os campos do corpo enviado
 * que mudaram ({campo: {de, para}}); no DELETE, o registro apagado (para: null).
 *
 *   const atual = await prisma.loja.findUnique({ where: { idLoja } })
 *   registrarAntes(request, atual)
 */
export function registrarAntes(req: object, registro: unknown): void {
  (req as any)[ANTES] = registro;
}

/**
 * Para quando o app já sabe o de/para (ex.: comparou antes e depois de
 * salvar, pegando o que o próprio backend mudou). Tem prioridade sobre o
 * registrarAntes.
 */
export function registrarAlteracoes(req: object, alteracoes: Alteracoes): void {
  (req as any)[ALTERACOES] = alteracoes;
}

/** Lê o que a rota registrou (usado pelos adaptadores Fastify/Express). */
export function lerRegistrado(req: object): { antes?: unknown; alteracoes?: unknown } {
  return { antes: (req as any)[ANTES], alteracoes: (req as any)[ALTERACOES] };
}

/** O que os adaptadores (Fastify/Express) extraem de cada requisição. */
export interface Requisicao {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  statusCode: number;
  usuario: Usuario | null;
  /** registrarAntes(req, ...) da rota. */
  antes?: unknown;
  /** registrarAlteracoes(req, ...) da rota. */
  alteracoes?: unknown;
}

export interface LogAcessos {
  /** Fire-and-forget: nunca lança, nunca atrasa a resposta. */
  registrar(req: Requisicao): void;
  /** Fecha a conexão (chamar no shutdown, se o app fecha recursos). */
  fechar(): Promise<void>;
}

// Asset estático não diz nada sobre uso.
const EXT_IGNORAR = /\.(js|mjs|css|map|png|jpe?g|svg|gif|webp|ico|woff2?|ttf|eot)$/i;
const METODOS_ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CAMPOS_SENSIVEIS = new Set(['password', 'senha', 'token', 'secret', 'access_token', 'refresh_token']);

/** IDs viram `:id`, senão "mais acessado" nunca agrupa (CNPJ, matrícula, id, UUID). */
export function normalizarCaminho(caminho: string): string {
  const semQuery = caminho.split('?')[0].split('#')[0] || '/';
  return semQuery
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
    .replace(/\/[0-9]+(?=\/|$)/g, '/:id');
}

function cabecalho(headers: Requisicao['headers'], nome: string): string | undefined {
  const v = headers[nome];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Página do frontend que originou a chamada: pathname do Referer, só quando
 * o Referer é do próprio domínio do app (Host ou X-Forwarded-Host). Fora
 * disso (outro site, dev com portas diferentes, sem Referer) → null.
 *
 * Mantém os IDs (`/campanha/123`), ao contrário do `path` da API: saber QUAL
 * campanha/loja foi aberta é o que interessa. Para agrupar por tela, a view
 * log_acessos.vw_acesso_paginas normaliza. Query string e `#` saem (podem
 * trazer termos de busca e filtros).
 */
export function caminhoFrontend(headers: Requisicao['headers']): string | null {
  const referer = cabecalho(headers, 'referer');
  if (!referer) return null;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return null;
  }
  const hosts = [cabecalho(headers, 'x-forwarded-host'), cabecalho(headers, 'host')]
    .flatMap((h) => (h ? h.split(',') : []))
    .map((h) => h.trim().toLowerCase());
  if (!hosts.includes(url.host.toLowerCase())) return null;
  let caminho = url.pathname || '/';
  try {
    caminho = decodeURI(caminho);
  } catch {
    // %-encoding inválido: grava como veio
  }
  return caminho.length > 255 ? caminho.slice(0, 255) : caminho;
}

const OCULTO = '***';

export interface Aparelho {
  /** computador | celular | tablet | outro */
  dispositivo: string;
  /** Windows | macOS | Linux | ChromeOS | Android | iOS | Outro */
  sistema: string;
  /** Chrome | Edge | Brave | Opera | Vivaldi | Safari | Firefox | Samsung Internet | WebView | Chromium | Outro */
  navegador: string;
}

/**
 * Aparelho pelo User-Agent, com as Client Hints do Chrome/Edge
 * (Sec-CH-UA-Mobile / Sec-CH-UA-Platform) quando vierem — são mais firmes.
 * Só a classe, nunca o modelo (o Chrome esconde de propósito). Limite
 * conhecido: o iPad se identifica como Mac desde o iPadOS 13 → computador/macOS.
 * Sem User-Agent nenhum → null.
 */
export function classificarAparelho(headers: Requisicao['headers']): Aparelho | null {
  const ua = cabecalho(headers, 'user-agent') ?? '';
  const chMobile = cabecalho(headers, 'sec-ch-ua-mobile');
  const chPlataforma = (cabecalho(headers, 'sec-ch-ua-platform') ?? '').replace(/"/g, '').trim();
  if (!ua && !chPlataforma) return null;

  const plataformas: Record<string, string> = {
    Windows: 'Windows', macOS: 'macOS', Linux: 'Linux', 'Chrome OS': 'ChromeOS', ChromeOS: 'ChromeOS',
    Android: 'Android', iOS: 'iOS',
  };
  let sistema = plataformas[chPlataforma];
  if (!sistema) {
    if (/iPhone|iPad|iPod/.test(ua)) sistema = 'iOS';
    else if (/Android/.test(ua)) sistema = 'Android';
    else if (/Windows/.test(ua)) sistema = 'Windows';
    else if (/CrOS/.test(ua)) sistema = 'ChromeOS';
    else if (/Macintosh|Mac OS X/.test(ua)) sistema = 'macOS';
    else if (/Linux/.test(ua)) sistema = 'Linux';
    else sistema = 'Outro';
  }

  let dispositivo: string;
  if (/iPad|Tablet/.test(ua) || (sistema === 'Android' && !/Mobile/.test(ua) && chMobile !== '?1')) dispositivo = 'tablet';
  else if (chMobile === '?1' || /iPhone|iPod|Mobi/.test(ua)) dispositivo = 'celular';
  else if (['Windows', 'macOS', 'Linux', 'ChromeOS'].includes(sistema)) dispositivo = 'computador';
  else dispositivo = 'outro';

  // Navegador pela marca que ele mesmo declara (Sec-CH-UA, Chromium em HTTPS):
  // o Brave copia o User-Agent do Chrome de propósito e só aparece aqui.
  // Sem marca conhecida além de "Chromium" (Arc, Brave com escudo, etc.), grava
  // "Chromium" em vez de afirmar Chrome. Sem o cabeçalho (Firefox, Safari), cai
  // no User-Agent abaixo.
  const marcas = [...(cabecalho(headers, 'sec-ch-ua') ?? '').matchAll(/"([^"]+)";\s*v="/g)].map((m) => m[1]);
  const porMarca: [string, string][] = [
    ['Brave', 'Brave'], ['Microsoft Edge', 'Edge'], ['Opera GX', 'Opera'], ['Opera', 'Opera'],
    ['Vivaldi', 'Vivaldi'], ['Samsung Internet', 'Samsung Internet'], ['Android WebView', 'WebView'],
    ['Google Chrome', 'Chrome'],
  ];
  const daMarca = porMarca.find(([marca]) => marcas.includes(marca))?.[1]
    ?? (marcas.includes('Chromium') ? 'Chromium' : undefined);

  // A ordem importa: Edge, Opera e Samsung também dizem "Chrome", e o Chrome diz "Safari".
  let navegador: string;
  if (daMarca) navegador = daMarca;
  else if (/Edg(e|A|iOS)?\//.test(ua)) navegador = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) navegador = 'Opera';
  else if (/SamsungBrowser\//.test(ua)) navegador = 'Samsung Internet';
  else if (/Firefox\/|FxiOS\//.test(ua)) navegador = 'Firefox';
  else if (/; wv\)/.test(ua)) navegador = 'WebView';
  else if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) navegador = 'Chrome';
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) navegador = 'Safari';
  else navegador = 'Outro';

  return { dispositivo, sistema, navegador };
}

/** Corpo para auditoria: sem campos sensíveis, ocultos como ***, JSON truncado em 2000. */
export function corpoAuditoria(body: unknown, ocultos: ReadonlySet<string> = new Set()): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const copia: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const campo of Object.keys(copia)) {
    const c = campo.toLowerCase();
    if (CAMPOS_SENSIVEIS.has(c)) delete copia[campo];
    else if (ocultos.has(c) && copia[campo] != null && copia[campo] !== '') copia[campo] = OCULTO;
  }
  const json = JSON.stringify(copia);
  return json.length > 2000 ? json.slice(0, 2000) + '…' : json;
}

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

/** Valor como sairia no JSON (Date → ISO, Decimal → string via toJSON). */
function comoJson(v: unknown): unknown {
  if (v === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
}

/**
 * Igualdade "de negócio": null, undefined e "" são o mesmo vazio; 73 e "73"
 * são iguais; "2026-10-23" e "2026-10-23T00:00:00.000Z" também. Evita
 * de/para falso (o formulário manda "" onde o banco tem null, número como
 * texto etc.).
 */
export function iguais(a: unknown, b: unknown): boolean {
  const x = comoJson(a);
  const y = comoJson(b);
  const vazio = (v: unknown) => v === null || v === '';
  if (vazio(x) && vazio(y)) return true;
  if (JSON.stringify(x) === JSON.stringify(y)) return true;
  if (typeof x !== 'object' && typeof y !== 'object' && x !== null && y !== null) {
    const sx = String(x);
    const sy = String(y);
    if (sx === sy) return true;
    const soData = /^\d{4}-\d{2}-\d{2}$/;
    if (soData.test(sx) && sy.startsWith(sx + 'T00:00:00')) return true;
    if (soData.test(sy) && sx.startsWith(sy + 'T00:00:00')) return true;
  }
  return false;
}

const LIMITE_VALOR = 500;
const LIMITE_ALTERACOES = 20_000;

function valorAuditoria(v: unknown): unknown {
  const j = comoJson(v);
  return typeof j === 'string' && j.length > LIMITE_VALOR ? j.slice(0, LIMITE_VALOR) + '…' : j;
}

/**
 * De/para de uma escrita, ou null. Prioridade: o de/para pronto da rota
 * (registrarAlteracoes); senão compara o registro anterior (registrarAntes)
 * com o corpo enviado — só os campos que vieram no corpo. No DELETE, o
 * registro anterior inteiro com para: null. Campos sensíveis saem, ocultos
 * viram ***, e pares sem mudança real (ver `iguais`) são descartados.
 */
export function calcularAlteracoes(
  method: string,
  body: unknown,
  antes: unknown,
  prontas: unknown,
  ocultos: ReadonlySet<string> = new Set(),
): Alteracoes | null {
  let pares: [string, unknown, unknown][] = [];
  if (ehObjeto(prontas)) {
    for (const [k, v] of Object.entries(prontas)) {
      if (ehObjeto(v) && ('de' in v || 'para' in v)) pares.push([k, v.de, v.para]);
    }
  } else if (ehObjeto(antes)) {
    if (method === 'DELETE') pares = Object.entries(antes).map(([k, v]) => [k, v, null]);
    else if (ehObjeto(body)) pares = Object.entries(body).map(([k, v]) => [k, antes[k], v]);
  }

  const out: Alteracoes = {};
  let tamanho = 0;
  for (const [campo, de, para] of pares) {
    const c = campo.toLowerCase();
    if (CAMPOS_SENSIVEIS.has(c) || iguais(de, para)) continue;
    const item = ocultos.has(c)
      ? { de: de == null || de === '' ? null : OCULTO, para: para == null || para === '' ? null : OCULTO }
      : { de: valorAuditoria(de), para: valorAuditoria(para) };
    tamanho += JSON.stringify(item).length + campo.length;
    if (tamanho > LIMITE_ALTERACOES) {
      out._truncado = { de: null, para: true };
      break;
    }
    out[campo] = item;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Extrai o usuário dos formatos usados no parque: `request.user` (Fastify,
 * Express com JWT próprio) ou `req.auth` (Express com requireAuth), com
 * `email`/`preferred_username`/`username` e `name`/`nome`.
 */
export function usuarioPadrao(u: unknown): Usuario | null {
  if (!u || typeof u !== 'object') return null;
  const o = u as Record<string, unknown>;
  const email = o.email ?? o.preferred_username ?? o.username;
  if (!email) return null;
  const nome = o.name ?? o.nome ?? o.preferred_username ?? o.username ?? null;
  return { email: String(email), nome: nome == null ? null : String(nome) };
}

const corta = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** true se o caminho bate com alguma regra (string = exata ou prefixo de segmento; RegExp = test). */
export function criarFiltroRotas(regras: (string | RegExp)[]): (caminho: string) => boolean {
  const testes = regras.map((r) => {
    if (r instanceof RegExp) return (c: string) => r.test(c);
    const base = r.replace(/\/+$/, '');
    return (c: string) => c === base || c.startsWith(base + '/');
  });
  return (caminho) => testes.some((t) => t(caminho));
}

/**
 * Decide se uma chamada abre uma visita nova de página: a mesma página do
 * mesmo usuário grava NO MÁXIMO uma vez por janela, contada da última vez
 * que gravou. Ir e voltar entre páginas dentro da janela não repete, e uma
 * aba parada que consulta a API sozinha (polling) gera uma linha por janela —
 * antes (só a última página por usuário) duas abas alternando viravam uma
 * visita a cada consulta.
 * Em memória, por processo: um restart do app conta uma visita a mais, só.
 */
export function criarControleVisitas(janelaMs: number) {
  // chave usuário + página → quando a visita foi gravada
  const gravadas = new Map<string, number>();
  let ultimaLimpeza = 0;

  return {
    visitaNova(usuario: string, pagina: string, agora = Date.now()): boolean {
      // Limpa o que venceu, no máximo uma vez por janela (o Map não cresce sem fim).
      if (agora - ultimaLimpeza > janelaMs) {
        for (const [k, quando] of gravadas) if (agora - quando >= janelaMs) gravadas.delete(k);
        ultimaLimpeza = agora;
      }
      const chave = `${usuario}\u0000${pagina}`;
      const quando = gravadas.get(chave);
      if (quando !== undefined && agora - quando < janelaMs) return false;
      gravadas.set(chave, agora);
      return true;
    },
  };
}

export function criarLogAcessos(opcoes: OpcoesLogAcessos): LogAcessos {
  const {
    aplicacao, acesso = true, auditoria = true, erros = true,
    agruparPorPagina = true, janelaVisitaMin = 30, janelaErroMin = 10,
  } = opcoes;
  const visitas = criarControleVisitas(janelaVisitaMin * 60_000);
  // Mesmo controle das visitas, com a chave rota + status no lugar da página:
  // uma tela que repete a chamada que falha (polling, retry) não inunda.
  const errosGravados = criarControleVisitas(janelaErroMin * 60_000);
  const auditoriaIgnorada = criarFiltroRotas(opcoes.ignorarAuditoria ?? []);
  const erroIgnorado = criarFiltroRotas(opcoes.ignorarErros ?? []);
  const ocultos = new Set((opcoes.ocultarCampos ?? []).map((c) => c.toLowerCase()));
  const url = opcoes.connectionString ?? process.env.DATABASE_OPERATIONAL_URL;
  let pool: pg.Pool | null = null;
  let ultimoErro = 0;

  // Erro de log não pode virar ruído: no máximo uma linha por minuto.
  function avisar(msg: string, err?: unknown) {
    const agora = Date.now();
    if (agora - ultimoErro < 60_000) return;
    ultimoErro = agora;
    console.error(`[log-acessos] ${aplicacao}: ${msg}`, err instanceof Error ? err.message : err ?? '');
  }

  function obterPool(): pg.Pool | null {
    if (pool) return pool;
    if (!url) {
      avisar('DATABASE_OPERATIONAL_URL não definida — log desligado');
      return null;
    }
    const u = new URL(url);
    // Parâmetros do Prisma: o pg os repassaria como parâmetro de sessão.
    u.searchParams.delete('schema');
    u.searchParams.delete('connection_limit');
    pool = new pg.Pool({
      connectionString: u.toString(),
      // 1 conexão que fecha quando ociosa: o log não disputa o
      // max_connections do pgDrogamais com o pool do app.
      max: 1,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // created_at = DEFAULT CURRENT_TIMESTAMP da coluna (timestamp sem fuso):
      // a sessão em São Paulo garante o mesmo horário em todos os apps.
      options: '-c timezone=America/Sao_Paulo',
    });
    pool.on('error', (e) => avisar('conexão ociosa caiu', e));
    return pool;
  }

  function gravar(sql: string, valores: unknown[]) {
    const p = obterPool();
    if (!p) return;
    p.query(sql, valores).catch((e) => avisar('falha ao gravar', e));
  }

  return {
    registrar(r) {
      try {
        if (!r.usuario?.email || r.method === 'OPTIONS') return;
        const caminho = normalizarCaminho(r.url);
        if (EXT_IGNORAR.test(caminho)) return;

        const email = corta(r.usuario.email, 100);
        const nome = corta(r.usuario.nome || r.usuario.email, 150);

        const paginaFrontend = caminhoFrontend(r.headers);
        // fat_log_acesso é uso de TELA: sem página do frontend (script,
        // integração, chamada direta) não há o que registrar. A rota da API
        // não é gravada (a coluna path saiu em 2026-10-27).
        const gravarAcesso =
          acesso && !!paginaFrontend && (!agruparPorPagina || visitas.visitaNova(email, paginaFrontend));

        // Rota da API com os IDs (qual registro deu 404), sem query (pode
        // trazer CPF/termos de busca).
        const rotaApi = corta(r.url.split('?')[0], 255);
        const gravarErro =
          erros && r.method === 'GET' && r.statusCode >= 400 && !erroIgnorado(caminho) &&
          errosGravados.visitaNova(email, `${rotaApi}\u0000${r.statusCode}`);

        // Só a classe do aparelho (o User-Agent bruto não é guardado).
        const ap = gravarAcesso || gravarErro || (auditoria && METODOS_ESCRITA.has(r.method))
          ? classificarAparelho(r.headers)
          : null;

        if (gravarAcesso) {
          gravar(
            `INSERT INTO log_acessos.fat_log_acesso
               (user_email, user_name, aplicacao, method, path_frontend, dispositivo, sistema, navegador)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [email, nome, aplicacao, r.method, paginaFrontend, ap?.dispositivo ?? null, ap?.sistema ?? null, ap?.navegador ?? null],
          );
        }
        if (gravarErro) {
          gravar(
            `INSERT INTO log_acessos.fat_erro_acesso
               (user_email, user_name, aplicacao, method, path, path_frontend, status_code,
                dispositivo, sistema, navegador)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              email, nome, aplicacao, r.method, rotaApi, paginaFrontend, r.statusCode,
              ap?.dispositivo ?? null, ap?.sistema ?? null, ap?.navegador ?? null,
            ],
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
              email, nome, aplicacao, r.method, rotaApi, r.statusCode,
              corpoAuditoria(r.body, ocultos), alteracoes ? JSON.stringify(alteracoes) : null,
              ap?.dispositivo ?? null, ap?.sistema ?? null, ap?.navegador ?? null,
            ],
          );
        }
      } catch (e) {
        avisar('erro inesperado', e);
      }
    },
    async fechar() {
      if (pool) await pool.end();
      pool = null;
    },
  };
}
