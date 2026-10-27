/** Quem fez a requisição. `nome` cai no email quando não vier. */
interface Usuario {
    email: string;
    nome?: string | null;
}
interface OpcoesLogAcessos {
    /** Nome da aplicação gravado na coluna `aplicacao` (ex.: 'lojas'). */
    aplicacao: string;
    /** URL do pgDrogamais PRINCIPAL. Padrão: process.env.DATABASE_OPERATIONAL_URL. */
    connectionString?: string;
    /** Grava toda requisição de usuário logado em fat_log_acesso. Padrão: true. */
    acesso?: boolean;
    /** Grava escritas (POST/PUT/PATCH/DELETE) com o corpo em fat_log_portal. Padrão: true. */
    auditoria?: boolean;
}
/** O que os adaptadores (Fastify/Express) extraem de cada requisição. */
interface Requisicao {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body?: unknown;
    statusCode: number;
    usuario: Usuario | null;
}
interface LogAcessos {
    /** Fire-and-forget: nunca lança, nunca atrasa a resposta. */
    registrar(req: Requisicao): void;
    /** Fecha a conexão (chamar no shutdown, se o app fecha recursos). */
    fechar(): Promise<void>;
}
/** IDs viram `:id`, senão "mais acessado" nunca agrupa (CNPJ, matrícula, id, UUID). */
declare function normalizarCaminho(caminho: string): string;
/**
 * Página do frontend que originou a chamada: pathname do Referer, só quando
 * o Referer é do próprio domínio do app (Host ou X-Forwarded-Host). Fora
 * disso (outro site, dev com portas diferentes, sem Referer) → null.
 */
declare function caminhoFrontend(headers: Requisicao['headers']): string | null;
/** Corpo para auditoria: sem campos sensíveis, JSON truncado em 2000. */
declare function corpoAuditoria(body: unknown): string | null;
/**
 * Extrai o usuário dos formatos usados no parque: `request.user` (Fastify,
 * Express com JWT próprio) ou `req.auth` (Express com requireAuth), com
 * `email`/`preferred_username`/`username` e `name`/`nome`.
 */
declare function usuarioPadrao(u: unknown): Usuario | null;
declare function criarLogAcessos(opcoes: OpcoesLogAcessos): LogAcessos;

export { type LogAcessos, type OpcoesLogAcessos, type Requisicao, type Usuario, caminhoFrontend, corpoAuditoria, criarLogAcessos, normalizarCaminho, usuarioPadrao };
