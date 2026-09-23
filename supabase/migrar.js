// Aplica o schema + os dados migrados direto no seu Supabase, sem precisar
// colar nada no SQL Editor do navegador.
//
// COMO USAR (no terminal, dentro da pasta do projeto "painelfin"):
//
//   1) npm install pg
//   2) set DATABASE_URL=postgresql://postgres.jkmgrwtsdusrwbkuvovm:SUA_SENHA@aws-0-us-east-2.pooler.supabase.com:5432/postgres
//      (troque SUA_SENHA pela senha real do banco — sem colchetes, sem espaço)
//   3) node supabase/migrar.js
//
// O arquivo supabase/dados_migrados.sql (que te mandei por download) precisa
// estar na pasta supabase/ do projeto, do lado deste script.
//
// É seguro rodar de novo se der erro no meio: schema.sql e schema_v2_funcs.sql
// usam "IF NOT EXISTS"/"CREATE OR REPLACE" e não duplicam nada. Só não rode
// dados_migrados.sql duas vezes (ele não tem essa proteção) — se precisar
// refazer, me avisa antes.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DIR = __dirname;
const PASSOS = [
  { nome: 'schema.sql', arquivo: path.join(DIR, 'schema.sql'), obrigatorio: true },
  { nome: 'schema_v2_funcs.sql', arquivo: path.join(DIR, 'schema_v2_funcs.sql'), obrigatorio: true },
  { nome: 'dados_migrados.sql', arquivo: path.join(DIR, 'dados_migrados.sql'), obrigatorio: true },
];

async function main() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.error('\n❌ Faltou definir a variável DATABASE_URL. Veja as instruções no topo deste arquivo.\n');
    process.exit(1);
  }

  for (const p of PASSOS) {
    if (!fs.existsSync(p.arquivo)) {
      console.error(`\n❌ Não achei o arquivo: ${p.arquivo}`);
      console.error('   Confirme que está rodando "node supabase/migrar.js" de dentro da pasta do projeto,');
      console.error('   e que dados_migrados.sql foi salvo dentro da pasta supabase/.\n');
      process.exit(1);
    }
  }

  const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  console.log('Conectando...');
  await client.connect();
  console.log('✅ Conectado.\n');

  try {
    for (const p of PASSOS) {
      console.log(`── Aplicando ${p.nome} ──`);
      const sql = fs.readFileSync(p.arquivo, 'utf8');
      await client.query(sql);
      console.log(`✅ ${p.nome} aplicado com sucesso.\n`);
    }

    // dados_migrados.sql (gerado pelo pg_dump) zera o search_path da sessão
    // por segurança — precisa religar antes das consultas de conferência
    await client.query('set search_path to public');

    console.log('── Conferências ──');
    const r1 = await client.query('select count(*)::int as n, sum(valor) as total from public.rateio');
    console.log(`Rateio: ${r1.rows[0].n} linhas, soma R$ ${r1.rows[0].total} (esperado: 1661 linhas, R$ 92426.45)`);

    const r2 = await client.query('select count(*)::int as n from public.imoveis');
    console.log(`Imóveis: ${r2.rows[0].n} linhas (esperado: 864)`);

    const r3 = await client.query('select count(*)::int as n from public.proprietarios');
    console.log(`Proprietários: ${r3.rows[0].n} linhas (esperado: 244)`);

    console.log('\n🎉 Migração concluída. Copie esta saída inteira e cole de volta na conversa.');
  } catch (err) {
    console.error('\n❌ ERRO durante a migração:');
    console.error(err.message);
    console.error('\nCopie esta mensagem de erro inteira e cole na conversa antes de tentar de novo.');
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
