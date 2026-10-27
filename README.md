# @drogamais/log-acessos

Log de acesso e de auditoria dos portais Drogamais, num lugar só.

| Tabela (pgDrogamais, schema `log_acessos`) | O que grava |
|---|---|
| `fat_log_acesso` | uma linha por **visita de página** do usuário logado: `path_frontend` (página do frontend, pelo `Referer`), mais `path`/método da primeira chamada de API da visita |
| `fat_log_portal` | escritas (POST/PUT/PATCH/DELETE) com o corpo, sem campos sensíveis |

- **Visita de página, não chamada de API:** uma tela que dispara 7 GETs grava 1 linha. As chamadas seguintes da mesma página são ignoradas enquanto o usuário segue nela; trocar de página (ou voltar depois de 30 min parado) conta de novo. Chamadas sem `Referer` (scripts, integrações) contam uma a uma. A auditoria (`fat_log_portal`) grava toda escrita, sempre.
- `pg` puro, **1 conexão** por app que fecha quando ociosa (não disputa o `max_connections` do banco com o app).
- Sessão em `America/Sao_Paulo`: o `created_at` (DEFAULT do banco) sai no mesmo horário em todos os apps.
- Nunca lança nem atrasa a resposta; erros vão para o console, no máximo um por minuto.
- ESM + CommonJS + tipos: serve para apps TS e JS, `type: module` ou não.
- IDs na URL viram `:id` (`/api/lojas/123` → `/api/lojas/:id`); assets estáticos e `OPTIONS` são ignorados.

## Instalação

Sem npm registry: o app instala o tarball da tag (não precisa de git nem token na imagem Docker).

```bash
npm install https://github.com/drogamais/log-acessos/archive/refs/tags/v0.2.0.tar.gz
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
| `agruparPorPagina` | `true` | `false` volta a gravar toda chamada de API |
| `janelaVisitaMin` | `30` | minutos parado na página para contar visita nova |
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
