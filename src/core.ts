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
}

/** O que os adaptadores (Fastify/Express) extraem de cada requisição. */
export interface Requisicao {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  statusCode: number;
  usuario: Usuario | null;
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

/** Corpo para auditoria: sem campos sensíveis, JSON truncado em 2000. */
export function corpoAuditoria(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const copia: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const campo of Object.keys(copia)) {
    if (CAMPOS_SENSIVEIS.has(campo.toLowerCase())) delete copia[campo];
  }
  const json = JSON.stringify(copia);
  return json.length > 2000 ? json.slice(0, 2000) + '…' : json;
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
  const { aplicacao, acesso = true, auditoria = true, agruparPorPagina = true, janelaVisitaMin = 30 } = opcoes;
  const visitas = criarControleVisitas(janelaVisitaMin * 60_000);
  const auditoriaIgnorada = criarFiltroRotas(opcoes.ignorarAuditoria ?? []);
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

        if (gravarAcesso) {
          gravar(
            `INSERT INTO log_acessos.fat_log_acesso
               (user_email, user_name, aplicacao, method, path_frontend)
             VALUES ($1, $2, $3, $4, $5)`,
            [email, nome, aplicacao, r.method, paginaFrontend],
          );
        }
        if (auditoria && METODOS_ESCRITA.has(r.method) && !auditoriaIgnorada(caminho)) {
          gravar(
            `INSERT INTO log_acessos.fat_log_portal
               (user_email, user_name, aplicacao, method, path, status_code, body)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            // Sem query string: pode trazer CPF/termos de busca.
            [email, nome, aplicacao, r.method, corta(r.url.split('?')[0], 255), r.statusCode, corpoAuditoria(r.body)],
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
