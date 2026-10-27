# @drogamais/log-acessos

Log de acesso e de auditoria dos portais Drogamais, num lugar só.

| Tabela (pgDrogamais, schema `log_acessos`) | O que grava |
|---|---|
| `fat_log_acesso` | uma linha por **visita de página** do usuário logado: `path_frontend` (página do frontend, pelo `Referer`). Chamada sem página (script, integração) não é gravada |
| `fat_log_portal` | escritas (POST/PUT/PATCH/DELETE) com o corpo, sem campos sensíveis |

- **Visita de página, não chamada de API:** a mesma página do mesmo usuário grava no máximo **uma vez a cada 30 min** (contados da última gravação). Uma tela que dispara 7 GETs grava 1 linha; ir e voltar entre páginas dentro da janela não repete; uma aba parada que consulta a API sozinha (polling) gera 1 linha por janela. A auditoria (`fat_log_portal`) grava toda escrita, sempre.
- `pg` puro, **1 conexão** por app que fecha quando ociosa (não disputa o `max_connections` do banco com o app).
- Sessão em `America/Sao_Paulo`: o `created_at` (DEFAULT do banco) sai no mesmo horário em todos os apps.
- Nunca lança nem atrasa a resposta; erros vão para o console, no máximo um por minuto.
- ESM + CommonJS + tipos: serve para apps TS e JS, `type: module` ou não.
- `path_frontend` guarda a página **com o ID** (`/campanha/123`), sem query string nem `#` — dá para cruzar com o cadastro (qual campanha mais acessada). Para agrupar por tela, use a view `log_acessos.vw_acesso_paginas` (coluna `pagina`, IDs como `:id`). Assets estáticos e `OPTIONS` são ignorados.

## Instalação

Sem npm registry: o app instala o tarball da tag (não precisa de git nem token na imagem Docker).

```bash
npm install https://github.com/drogamais/log-acessos/archive/refs/tags/v0.7.0.tar.gz
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

## Opções

| Opção | Padrão | |
|---|---|---|
| `aplicacao` | — | nome gravado na coluna `aplicacao` |
| `connectionString` | `process.env.DATABASE_OPERATIONAL_URL` | |
| `acesso` | `true` | grava em `fat_log_acesso` |
| `auditoria` | `true` | grava escritas em `fat_log_portal` |
| `ignorarAuditoria` | `[]` | rotas que a auditoria (`fat_log_portal`) não grava — o acesso continua. String = rota exata ou prefixo (`'/api/lojas/preferences'`), ou RegExp |
| `agruparPorPagina` | `true` | `false` volta a gravar toda chamada de API |
| `janelaVisitaMin` | `30` | minutos até a mesma página do mesmo usuário poder gravar de novo (ex.: `60`) |
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
