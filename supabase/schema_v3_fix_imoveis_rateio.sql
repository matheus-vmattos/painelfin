-- ═══════════════════════════════════════════════════════════════════════
-- Painel Valoriza — correção de estrutura (rodar ANTES de schema.sql,
-- só se você já rodou uma versão antiga do schema.sql antes)
--
-- As tabelas imoveis e rateio mudaram de desenho (ver comentários em
-- schema.sql: id passa a ser bigint técnico, ganham id_planilha).
-- "CREATE TABLE IF NOT EXISTS" não atualiza tabela que já existe com
-- estrutura antiga — por isso este passo apaga só essas duas (elas
-- ainda estão vazias, nenhum dado real foi carregado) para o
-- schema.sql seguinte recriar do jeito certo.
--
-- Seguro rodar mesmo se as tabelas já estiverem no formato novo (o
-- "if exists" evita erro).
-- ═══════════════════════════════════════════════════════════════════════
drop table if exists rateio cascade;
drop table if exists imoveis cascade;
