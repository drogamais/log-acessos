# @drogamais/log-acessos

Log de acesso e de auditoria dos portais Drogamais, num lugar só.

| Tabela (pgDrogamais, schema `log_acessos`) | O que grava |
|---|---|
| `fat_log_acesso` | uma linha por **visita de página** do usuário logado: `path_frontend` (página do frontend, pelo `Referer`). Chamada sem página (script, integração) não é gravada |
| `fat_log_portal` | escritas (POST/PUT/PATCH/DELETE) com o corpo, sem campos sensíveis, e `alteracoes` (de/para, jsonb) quando a rota informa o antes |
| `fat_erro_acesso` | leituras (GET) que **falharam** (status ≥ 400): 403 sem permissão, 404 registro inexistente, 5xx a API quebrou — com a rota da API (`path`, com os IDs, sem query), a página (`path_frontend`) e o status. Escrita com erro fica na `fat_log_portal`. O mesmo usuário + rota + status grava no máximo **uma vez a cada 10 min** (0.11.0+) |

- **Visita de página, não chamada de API:** a mesma página do mesmo usuário grava no máximo **uma vez a cada 30 min** (contados da última gravação). Uma tela que dispara 7 GETs grava 1 linha; ir e voltar entre páginas dentro da janela não repete; uma aba parada que consulta a API sozinha (polling) gera 1 linha por janela. A auditoria (`fat_log_portal`) grava toda escrita, sempre.
- **Aparelho** (`dispositivo`, `sistema`, `navegador`) nas três tabelas, pelo `User-Agent` + Client Hints do Chrome/Edge: `computador`/`celular`/`tablet`, Windows/macOS/Android/iOS…, Chrome/Edge/Brave/Safari… (o navegador pela marca do `Sec-CH-UA` quando vem: o Brave copia o User-Agent do Chrome). Só a classe — o User-Agent bruto não é guardado e o modelo do aparelho não é conhecido (o Chrome esconde). O iPad se diz Mac: entra como computador/macOS.
- `pg` puro, **1 conexão** por app que fecha quando ociosa (não disputa o `max_connections` do banco com o app).
- Sessão em `America/Sao_Paulo`: o `created_at` (DEFAULT do banco) sai no mesmo horário em todos os apps.
- Nunca lança nem atrasa a resposta; erros vão para o console, no máximo um por minuto.
- ESM + CommonJS + tipos: serve para apps TS e JS, `type: module` ou não.
- `path_frontend` guarda a página **com o ID** (`/campanha/123`), sem query string nem `#` — dá para cruzar com o cadastro (qual campanha mais acessada). Para agrupar por tela, use a view `log_acessos.vw_acesso_paginas` (coluna `pagina`, IDs como `:id`). Assets estáticos e `OPTIONS` são ignorados.

## Instalação

Sem npm registry: o app instala o tarball da tag (não precisa de git nem token na imagem Docker).

```bash
npm install https://github.com/drogamais/log-acessos/archive/refs/tags/v0.11.0.tar.gz
```

Usa `DATABASE_OPERATIONAL_URL` (o pgDrogamais **principal** — a réplica não aceita escrita).

## Fastify

Depois do plugin de autenticação (que preenche `request.user`):

```ts
import { logAcessos } from '@drogamais/log-acessos/fastify';

await app.register(authPlugin);
await app.register(logAcessos, { aplicacao: 'lojas' });
```

## Express

Pode ir no topo, antes das rotas — o registro acontece quando a resposta termina, e aí o `requireAuth` de cada rota já preencheu `req.user`/`req.auth`:

```ts
import { logAcessos } from '@drogamais/log-acessos/express';

app.use(express.json());
app.use(logAcessos({ aplicacao: 'precifica' }));
```

CommonJS: `const { logAcessos } = require('@drogamais/log-acessos/express')`.

## De/para nas escritas (`alteracoes`)

Sem nada a fazer, a auditoria grava o corpo enviado. Para gravar também o que mudou, a rota de PUT/PATCH/DELETE informa o estado anterior — o pacote não sabe qual linha do banco a URL altera:

```ts
import { registrarAntes, registrarAlteracoes } from '@drogamais/log-acessos/fastify'; // ou /express

// 1) o registro antes da escrita (chaves com o MESMO nome do corpo): o pacote
//    compara com o corpo enviado e grava só o que mudou
registrarAntes(request, lojaAntes);

// 2) ou o de/para pronto (ex.: comparou antes e depois de salvar, pegando o
//    que o próprio backend mudou) — tem prioridade
registrarAlteracoes(request, { fonte_de_dados: { de: 'PLUGPHARMA', para: 'API_SID' } });
```

Resultado em `fat_log_portal.alteracoes`: `{"fonte_de_dados": {"de": "PLUGPHARMA", "para": "API_SID"}}`. No DELETE, o registro apagado (`para: null`). Pares sem mudança real são descartados (`""` x `null`, `73` x `"73"`, data x data-hora à meia-noite). Rota que não informa nada fica com `alteracoes = null` e o corpo de sempre.

## Opções

| Opção | Padrão | |
|---|---|---|
| `aplicacao` | — | nome gravado na coluna `aplicacao` |
| `connectionString` | `process.env.DATABASE_OPERATIONAL_URL` | |
| `acesso` | `true` | grava em `fat_log_acesso` |
| `auditoria` | `true` | grava escritas em `fat_log_portal` |
| `ignorarAuditoria` | `[]` | rotas que a auditoria (`fat_log_portal`) não grava — o acesso continua. String = rota exata ou prefixo (`'/api/lojas/preferences'`), ou RegExp |
| `erros` | `true` | grava leituras (GET) com status ≥ 400 em `fat_erro_acesso` |
| `janelaErroMin` | `10` | minutos até o mesmo usuário + rota + status poder gravar de novo |
| `ignorarErros` | `[]` | rotas cujo erro de leitura não é gravado — ex.: consulta em que o 404 é resposta normal ("ainda não cadastrado"). Mesmas regras do `ignorarAuditoria` |
| `agruparPorPagina` | `true` | `false` volta a gravar toda chamada de API |
| `janelaVisitaMin` | `30` | minutos até a mesma página do mesmo usuário poder gravar de novo (ex.: `60`) |
| `ocultarCampos` | `[]` | dado pessoal guardado como `***` no corpo e no de/para (ex.: `['cpf', 'rg']`): o log mostra que mudou, não o valor |
| `usuario` | `request.user` (Fastify) / `req.user ?? req.auth` (Express) | função que devolve `{ email, nome }` ou `null` |

O usuário padrão entende `email`/`preferred_username`/`username` e `name`/`nome`. Se o app guarda em outro lugar:

```ts
app.use(logAcessos({ aplicacao: 'sac-cd', usuario: (req) => req.user && { email: req.user.email ?? req.user.username, nome: req.user.username } }));
```

## Nova versão

```bash
npm test                 # build + testes
git add -A && git commit -m "..." && git tag vX.Y.Z && git push --follow-tags
```

`dist/` vai no commit (de propósito — é o que os apps instalam). Nos apps, trocar a versão na URL do tarball.
