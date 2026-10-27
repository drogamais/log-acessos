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
type Alteracoes = Record<string, {
    de: unknown;
    para: unknown;
}>;
/**
 * Na rota de PUT/PATCH/DELETE, informa o registro como estava ANTES da
 * escrita: a auditoria grava em `alteracoes` só os campos do corpo enviado
 * que mudaram ({campo: {de, para}}); no DELETE, o registro apagado (para: null).
 *
 *   const atual = await prisma.loja.findUnique({ where: { idLoja } })
 *   registrarAntes(request, atual)
 */
declare function registrarAntes(req: object, registro: unknown): void;
/**
 * Para quando o app já sabe o de/para (ex.: comparou antes e depois de
 * salvar, pegando o que o próprio backend mudou). Tem prioridade sobre o
 * registrarAntes.
 */
declare function registrarAlteracoes(req: object, alteracoes: Alteracoes): void;
/** Lê o que a rota registrou (usado pelos adaptadores Fastify/Express). */
declare function lerRegistrado(req: object): {
    antes?: unknown;
    alteracoes?: unknown;
};
/** O que os adaptadores (Fastify/Express) extraem de cada requisição. */
interface Requisicao {
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
 *
 * Mantém os IDs (`/campanha/123`), ao contrário do `path` da API: saber QUAL
 * campanha/loja foi aberta é o que interessa. Para agrupar por tela, a view
 * log_acessos.vw_acesso_paginas normaliza. Query string e `#` saem (podem
 * trazer termos de busca e filtros).
 */
declare function caminhoFrontend(headers: Requisicao['headers']): string | null;
/** Corpo para auditoria: sem campos sensíveis, ocultos como ***, JSON truncado em 2000. */
declare function corpoAuditoria(body: unknown, ocultos?: ReadonlySet<string>): string | null;
/**
 * Igualdade "de negócio": null, undefined e "" são o mesmo vazio; 73 e "73"
 * são iguais; "2026-10-23" e "2026-10-23T00:00:00.000Z" também. Evita
 * de/para falso (o formulário manda "" onde o banco tem null, número como
 * texto etc.).
 */
declare function iguais(a: unknown, b: unknown): boolean;
/**
 * De/para de uma escrita, ou null. Prioridade: o de/para pronto da rota
 * (registrarAlteracoes); senão compara o registro anterior (registrarAntes)
 * com o corpo enviado — só os campos que vieram no corpo. No DELETE, o
 * registro anterior inteiro com para: null. Campos sensíveis saem, ocultos
 * viram ***, e pares sem mudança real (ver `iguais`) são descartados.
 */
declare function calcularAlteracoes(method: string, body: unknown, antes: unknown, prontas: unknown, ocultos?: ReadonlySet<string>): Alteracoes | null;
/**
 * Extrai o usuário dos formatos usados no parque: `request.user` (Fastify,
 * Express com JWT próprio) ou `req.auth` (Express com requireAuth), com
 * `email`/`preferred_username`/`username` e `name`/`nome`.
 */
declare function usuarioPadrao(u: unknown): Usuario | null;
/** true se o caminho bate com alguma regra (string = exata ou prefixo de segmento; RegExp = test). */
declare function criarFiltroRotas(regras: (string | RegExp)[]): (caminho: string) => boolean;
/**
 * Decide se uma chamada abre uma visita nova de página: a mesma página do
 * mesmo usuário grava NO MÁXIMO uma vez por janela, contada da última vez
 * que gravou. Ir e voltar entre páginas dentro da janela não repete, e uma
 * aba parada que consulta a API sozinha (polling) gera uma linha por janela —
 * antes (só a última página por usuário) duas abas alternando viravam uma
 * visita a cada consulta.
 * Em memória, por processo: um restart do app conta uma visita a mais, só.
 */
declare function criarControleVisitas(janelaMs: number): {
    visitaNova(usuario: string, pagina: string, agora?: number): boolean;
};
declare function criarLogAcessos(opcoes: OpcoesLogAcessos): LogAcessos;

export { type Alteracoes, type LogAcessos, type OpcoesLogAcessos, type Requisicao, type Usuario, calcularAlteracoes, caminhoFrontend, corpoAuditoria, criarControleVisitas, criarFiltroRotas, criarLogAcessos, iguais, lerRegistrado, normalizarCaminho, registrarAlteracoes, registrarAntes, usuarioPadrao };
