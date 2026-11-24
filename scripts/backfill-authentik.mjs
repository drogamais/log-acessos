// Carga ÚNICA do histórico de acessos do Authentik em log_acessos.fat_log_acesso.
//
// O pacote só grava desde 27/10/2026. Antes disso, o único registro de quem abriu qual
// portal é o Authentik (evento authorize_application), copiado para o pgAnalytics em
// authentik.fat_authentik_evento_acesso pelo job do app lojas. Este script leva esse
// histórico para a fat_log_acesso, para os relatórios de acesso terem uma fonte só.
//
// Regras:
//   - 1 linha por usuário × aplicação × dia (São Paulo), no horário do 1º acesso do dia;
//   - cada aplicação só ANTES da 1ª linha gravada pelo pacote nela (sem contar dia 2x);
//   - só os portais que gravam pelo pacote (DEPARA abaixo); o "Portal Drogamais" é o
//     próprio Authentik (login/tela inicial) e as ferramentas internas não usam o pacote;
//   - method = 'SSO' marca a linha (filtrar com method <> 'SSO' para ver só as visitas);
//     path_frontend e aparelho ficam NULL (o Authentik não sabe a página);
//   - user_email/user_name = a conta do Authentik (casa com a resolução e-mail + nome);
//     conta sem e-mail (excluída do Authentik ou com e-mail vazio): se for login de loja
//     (0116-...), o e-mail da loja em drogamais.dim_lojas; senão, fica de fora.
//
// Carga inicial: depois dela, nada lê o Authentik para relatório de acesso — o pacote
// segue gravando o que os apps registram.
//
// Uso (simulação por padrão; nada é gravado sem --gravar):
//   ORIGEM_URL=<pgAnalytics> DESTINO_URL=<pgDrogamais PRINCIPAL> node scripts/backfill-authentik.mjs
//   ... node scripts/backfill-authentik.mjs --gravar
//
// Se já houver linhas 'SSO' na tabela, o script para (carga única, não duplica).
// Desfazer: DELETE FROM log_acessos.fat_log_acesso WHERE method = 'SSO';

import pg from 'pg';

const GRAVAR = process.argv.includes('--gravar');
const { ORIGEM_URL, DESTINO_URL } = process.env;
if (!ORIGEM_URL || !DESTINO_URL) {
  console.error('Defina ORIGEM_URL (pgAnalytics) e DESTINO_URL (pgDrogamais principal).');
  process.exit(1);
}
// timestamp sem fuso (horário de São Paulo nas duas pontas) fica como texto: sem
// conversão pelo fuso da máquina que roda o script.
pg.types.setTypeParser(1114, (s) => s);
const semParamsPrisma =(url) => url.replace(/[?&](schema|connection_limit|pool_timeout)=[^&]*/g, '').replace(/\?$/, '');

// Nome do portal no Authentik → coluna aplicacao do pacote.
const DEPARA = {
  'Portal Associado': 'portal_associado',
  'Portal Lojista': 'portal_associado', // nome antigo (até 05/05/2026)
  'Lojas': 'lojas',
  'Campanhas': 'campanhas',
  'CD': 'cd',
  'Balcão Drogamais': 'balcao',
  'Raio X': 'raiox',
  'RH': 'rh',
  'Comercial': 'comercial',
  'Inventario Drogamais': 'inventario',
  'Cestao': 'cestao',
  'Universidade Corporativa': 'universidade_corporativa',
  'receitas': 'receitas',
  'CRM - Prospecção': 'prospeccao',
  'MaisCampanhas': 'maiscampanha',
  'Pesquisa Compra': 'pesquisacompra',
  'Balconista': 'balconista',
  'balconista': 'balconista',
  'Análise de Mercado': 'analise-de-mercado',
  'Pesquisa Preço': 'pesquisapreco',
  'Financeiro': 'financeiro',
  'Parceiros Drogamais': 'parceiros-drogamais',
  'Gestão de Lojas': 'gestao-de-lojas',
  'chamados-internos': 'chamados',
  'Chamados Internos': 'chamados',
  'SAC CD': 'sac-cd',
  'precifica': 'precifica',
  'Data Loja': 'data-loja',
  'Comprador': 'comprador',
};

const SQL_ORIGEM = `
WITH depara AS (SELECT * FROM unnest($1::text[], $2::text[]) AS d(portal, aplicacao)),
corte AS (SELECT * FROM unnest($3::text[], $4::timestamp[]) AS c(aplicacao, corte)),
ev AS (
  SELECT e.username, d.aplicacao, (e.created AT TIME ZONE 'America/Sao_Paulo') AS ts
    FROM authentik.fat_authentik_evento_acesso e
    JOIN depara d ON d.portal = e.portal
   WHERE e.action = 'authorize_application'),
dia AS (
  SELECT ev.username, ev.aplicacao, min(ev.ts) AS created_at
    FROM ev JOIN corte c ON c.aplicacao = ev.aplicacao
   WHERE ev.ts < c.corte
   GROUP BY ev.username, ev.aplicacao, ev.ts::date)
SELECT dia.created_at, dia.aplicacao, dia.username,
       coalesce(nullif(u.email, ''), l.email) AS email,
       coalesce(nullif(u.name, ''), dia.username) AS nome,
       (coalesce(u.email, '') = '' AND l.email IS NOT NULL) AS email_da_loja
  FROM dia
  LEFT JOIN authentik.dim_authentik_usuario u ON u.username = dia.username
  LEFT JOIN drogamais.dim_lojas l
         ON coalesce(u.email, '') = ''
        AND l.loja_numero = (substring(dia.username FROM '^([0-9]{1,5})-'))::int
 ORDER BY dia.created_at`;

const origem = new pg.Client({ connectionString: semParamsPrisma(ORIGEM_URL) });
const destino = new pg.Client({ connectionString: semParamsPrisma(DESTINO_URL) });
await origem.connect();
await destino.connect();

try {
  await origem.query('SET default_transaction_read_only = on');

  const { rows: [{ n: jaTem }] } = await destino.query(
    `SELECT count(*)::int AS n FROM log_acessos.fat_log_acesso WHERE method = 'SSO'`,
  );
  if (jaTem > 0) {
    console.error(`Já existem ${jaTem} linhas 'SSO' na fat_log_acesso: a carga já foi feita. Nada a fazer.`);
    process.exit(1);
  }

  // Corte por aplicação = 1ª linha gravada pelo pacote.
  const { rows: cortes } = await destino.query(
    `SELECT aplicacao, min(created_at) AS corte FROM log_acessos.fat_log_acesso GROUP BY aplicacao`,
  );
  const portais = Object.keys(DEPARA);
  const { rows } = await origem.query(SQL_ORIGEM, [
    portais, portais.map((p) => DEPARA[p]),
    cortes.map((c) => c.aplicacao), cortes.map((c) => c.corte),
  ]);

  const gravaveis = rows.filter((r) => r.email);
  const descartadas = rows.length - gravaveis.length;

  // Resumo
  const mes = (s) => s.slice(0, 7);
  const porMes = new Map();
  const porApp = new Map();
  for (const r of gravaveis) {
    porMes.set(mes(r.created_at), (porMes.get(mes(r.created_at)) ?? 0) + 1);
    porApp.set(r.aplicacao, (porApp.get(r.aplicacao) ?? 0) + 1);
  }
  console.log(`Linhas: ${gravaveis.length} a gravar, ${descartadas} sem e-mail (conta excluída, fora).`);
  console.log(`  com o e-mail da loja (conta sem e-mail no Authentik): ${gravaveis.filter((r) => r.email_da_loja).length}`);
  console.table([...porMes].sort().map(([m, n]) => ({ mes: m, linhas: n })));
  console.table([...porApp].sort((a, b) => b[1] - a[1]).map(([a, n]) => ({ aplicacao: a, linhas: n, corte: cortes.find((c) => c.aplicacao === a)?.corte })));

  if (!GRAVAR) {
    console.log('Simulação: nada gravado. Rode com --gravar para gravar.');
    process.exit(0);
  }

  // Partições dos meses que ainda não existem (a procedure do pg_cron só cria o mês
  // atual e o seguinte). Os índices do pai propagam sozinhos.
  const meses = [...porMes.keys()].sort();
  await destino.query('BEGIN');
  for (const m of meses) {
    const inicio = `${m}-01`;
    await destino.query(
      `DO $$ BEGIN
         EXECUTE format('CREATE TABLE IF NOT EXISTS log_acessos.%I PARTITION OF log_acessos.fat_log_acesso FOR VALUES FROM (%L) TO (%L)',
                        'fat_log_acesso_' || to_char(DATE '${inicio}', 'YYYY_MM'), DATE '${inicio}', DATE '${inicio}' + interval '1 month');
       END $$`,
    );
  }
  const LOTE = 2000;
  let gravadas = 0;
  for (let i = 0; i < gravaveis.length; i += LOTE) {
    const l = gravaveis.slice(i, i + LOTE);
    const r = await destino.query(
      `INSERT INTO log_acessos.fat_log_acesso (created_at, user_email, user_name, aplicacao, method)
       SELECT c, left(e, 100), left(n, 150), a, 'SSO'
         FROM unnest($1::timestamp[], $2::text[], $3::text[], $4::text[]) AS t(c, e, n, a)`,
      [l.map((x) => x.created_at), l.map((x) => x.email), l.map((x) => x.nome), l.map((x) => x.aplicacao)],
    );
    gravadas += r.rowCount ?? 0;
  }
  await destino.query('COMMIT');
  console.log(`Gravadas ${gravadas} linhas 'SSO'. Partições garantidas: ${meses.join(', ')}.`);
} catch (err) {
  await destino.query('ROLLBACK').catch(() => {});
  console.error('Falhou (nada gravado):', err.message);
  process.exitCode = 1;
} finally {
  await origem.end();
  await destino.end();
}
