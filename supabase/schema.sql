-- ═══════════════════════════════════════════════════════════════════════
-- Painel Valoriza — schema Postgres (Supabase)
-- Substitui as abas do Google Sheets usadas hoje pelo apps-script/Code.gs.
--
-- Cobre os 11 módulos ativos do painel:
--   Proprietários, Imóveis, Fornecedores, Guias, Rateio, RateioStatus,
--   Repasses, RotinaDiaria, Usuarios, Grupos + kv_store (config/contadores)
--
-- NÃO migra os módulos já desativados (Auditoria, Checklist, Locatários,
-- BoletosSimulados, Devolucoes, CaixaMov, APA/INO) — eles continuam só na
-- planilha Google e no xlsx de backup. Dá pra trazer depois se precisar.
--
-- Segurança: RLS ligado em tudo, SEM policy nenhuma para anon/authenticated
-- (= acesso negado por padrão pra quem usa a publishable key). Só a
-- service_role (usada de dentro da Edge Function, nunca no navegador)
-- enxerga essas tabelas — exatamente como hoje só o Apps Script enxerga
-- a planilha, nunca o navegador direto.
--
-- Como rodar: cole este arquivo inteiro no SQL Editor do Supabase e
-- execute (RUN). É seguro rodar mais de uma vez (usa IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════

-- ── Proprietários ──────────────────────────────────────────────────────
create table if not exists proprietarios (
  id            text primary key,           -- ex: P-0001
  proprietario  text,
  cpf           text,
  qtd_imoveis   integer default 0,           -- mantido em sincronia por trigger (ver abaixo)
  forma_pagto   text,
  banco         text,
  agencia       text,
  conta         text,
  nominal       text,
  chave_pix     text,
  email         text,
  telefone      text,
  cod_p         text,                        -- coluna "Cód (P)" da planilha
  observacoes   text,
  criado_em     timestamptz default now(),
  atualizado_em timestamptz default now()
);
create index if not exists idx_proprietarios_cpf on proprietarios (cpf);

-- ── Imóveis ────────────────────────────────────────────────────────────
-- id é uma chave tecnica (o Postgres gera sozinho, nunca colide) em vez
-- de texto tipo "IM-0001". Motivo: nos dados reais da planilha, tanto o
-- "ID" quanto o "Cód Imóvel" tem casos de colisao (imoveis DIFERENTES
-- que acabaram com o mesmo codigo por erro de digitacao historico) -
-- usar qualquer um dos dois como chave unica arriscaria misturar ou
-- sobrescrever imoveis de verdade na migracao. id_planilha guarda o
-- "IM-0001" antigo so como referencia, sem exigir que seja unico.
create table if not exists imoveis (
  id                  bigint generated always as identity primary key,
  id_planilha         text,                  -- ex: IM-0001 (legado, so referencia)
  cod_imovel          text,                  -- NAO é unique de propósito (ver comentário acima)
  endereco            text,
  proprietario        text,
  cpf_prop            text,
  pct_recibo          numeric,
  forma_pagto         text,
  banco               text,
  agencia             text,
  conta               text,
  nominal             text,
  contrato_locatario  text,
  status              text,                  -- 'Locado' | 'Vazio' | 'Indisponível'
  grupo               text,
  nao_cobrar          text,                  -- mantido como texto (compat com !!String(x).trim() do frontend)
  criado_em           timestamptz default now(),
  atualizado_em       timestamptz default now()
);
create index if not exists idx_imoveis_cpf_prop on imoveis (cpf_prop);
create index if not exists idx_imoveis_grupo on imoveis (grupo);
create index if not exists idx_imoveis_cod_imovel on imoveis (cod_imovel);

-- trigger: mantém proprietarios.qtd_imoveis sempre correto
-- (na planilha isso era uma fórmula/atualização manual; aqui é automático)
create or replace function _sync_qtd_imoveis() returns trigger as $$
begin
  -- CPF em branco não é uma chave real: sem essa guarda, todo imóvel sem
  -- CPF Prop. preenchido conta como se fosse do mesmo "proprietário ''",
  -- inflando a contagem de qualquer proprietário cujo CPF também esteja
  -- em branco (achado durante a migração real: 2 proprietários com CPF
  -- vazio ganharam uma contagem de imóveis de estranhos por causa disso)
  if (tg_op = 'DELETE') then
    if old.cpf_prop is not null and old.cpf_prop <> '' then
      update public.proprietarios set qtd_imoveis = (select count(*) from public.imoveis where cpf_prop = old.cpf_prop) where cpf = old.cpf_prop;
    end if;
    return old;
  end if;
  if new.cpf_prop is not null and new.cpf_prop <> '' then
    update public.proprietarios set qtd_imoveis = (select count(*) from public.imoveis where cpf_prop = new.cpf_prop) where cpf = new.cpf_prop;
  end if;
  if (tg_op = 'UPDATE' and old.cpf_prop is distinct from new.cpf_prop and old.cpf_prop is not null and old.cpf_prop <> '') then
    update public.proprietarios set qtd_imoveis = (select count(*) from public.imoveis where cpf_prop = old.cpf_prop) where cpf = old.cpf_prop;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sync_qtd_imoveis on imoveis;
create trigger trg_sync_qtd_imoveis
  after insert or update of cpf_prop or delete on imoveis
  for each row execute function _sync_qtd_imoveis();

-- cobre o caso de transferir um imóvel para um CPF que ainda não tem
-- cadastro em proprietarios (o app permite isso) — sem isso, quando o
-- cadastro fosse criado depois, qtd_imoveis nasceria em 0 mesmo já
-- tendo imóveis vinculados
create or replace function _init_qtd_imoveis() returns trigger as $$
begin
  if new.cpf is null or new.cpf = '' then
    new.qtd_imoveis := 0;
  else
    new.qtd_imoveis := coalesce((select count(*) from public.imoveis where cpf_prop = new.cpf), 0);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_init_qtd_imoveis on proprietarios;
create trigger trg_init_qtd_imoveis
  before insert on proprietarios
  for each row execute function _init_qtd_imoveis();

-- ── Fornecedores ───────────────────────────────────────────────────────
create table if not exists fornecedores (
  id                text primary key,        -- ex: F-0001
  fornecedor        text,
  tipo              text,
  cpf_cnpj          text,
  categoria         text,
  contato           text,
  email             text,
  telefone          text,
  chave_pix_banco   text,
  observacoes       text,
  criado_em         timestamptz default now(),
  atualizado_em     timestamptz default now()
);

-- ── Grupos (condomínios) ───────────────────────────────────────────────
create table if not exists grupos (
  grupo text primary key,
  observacao text  -- nota livre do condomínio (ex: regra fixa de zelador), ver schema_v4_obs_grupo.sql
);

-- ── Rateio (lançamentos) ───────────────────────────────────────────────
-- id também é chave técnica pelo mesmo motivo do Imóveis: nos dados
-- reais, 191 grupos de lançamentos (516 linhas) compartilham o mesmo
-- "ID" composto (competência|grupo|cód|serviço) sendo LANÇAMENTOS
-- DIFERENTES (valores e complementos distintos) — ex: duas cobranças de
-- "Manutenção" no mesmo imóvel/mês, uma "Limpeza e conservação" outra
-- "Material de limpeza". Usar esse composto como chave única apagaria
-- ~180 lançamentos financeiros reais na migração. id_planilha guarda o
-- texto antigo só como referência.
create table if not exists rateio (
  id                bigint generated always as identity primary key,
  id_planilha       text,                    -- ex: "09/2026|Ed. Central|101|Água" (legado, so referencia)
  competencia       text not null,           -- 'MM/AAAA'
  grupo             text not null,
  cod_imovel        text,
  endereco          text,
  servico           text,
  data_referencia   text,
  valor             numeric default 0,
  complemento       text,
  nao_cobrar        text,
  copiado           text,                    -- 'Sim' | ''
  criado_em         timestamptz default now(),
  atualizado_em     timestamptz default now()
);
create index if not exists idx_rateio_grupo_comp on rateio (grupo, competencia);
create index if not exists idx_rateio_cod_imovel on rateio (cod_imovel);

-- ── RateioStatus ───────────────────────────────────────────────────────
-- na planilha podia duplicar (grupo,competência) — aqui a unique constraint
-- torna isso impossível estruturalmente (repararRateioStatus() deixa de ser necessário)
create table if not exists rateio_status (
  id             bigint generated always as identity primary key,
  grupo          text not null,
  competencia    text not null,
  status         text default 'Em andamento',   -- 'Em andamento' | 'Finalizado'
  finalizado_em  text,
  total          numeric,
  unique (grupo, competencia)
);

-- ── Repasses ───────────────────────────────────────────────────────────
create table if not exists repasses (
  id            text primary key,             -- ex: R-0001
  dia           text,
  proprietario  text
);

-- ── Rotina diária ──────────────────────────────────────────────────────
create table if not exists rotina_diaria (
  id        text primary key,                 -- ex: RD-1, RD-4a
  ordem     integer,
  texto     text,
  feito_em  text,                             -- 'dd/MM/yyyy' do dia em que foi marcado
  pai       text,                             -- id do item pai (perguntas sim/não com sub-passos)
  tipo      text default 'chk',               -- 'chk' | 'sn'
  resposta  text                              -- formato 'dd/MM/yyyy|Sim' ou '...|Não'
);

-- ── Guias ──────────────────────────────────────────────────────────────
create table if not exists guias (
  id          text primary key,               -- ex: GU-0001
  titulo      text,
  conteudo    text,
  mapa        text,                           -- JSON do mapa mental, se usado
  atualizado  text
);

-- ── Usuários (login/permissões do painel) ─────────────────────────────
create table if not exists usuarios (
  usuario     text primary key,               -- normalizado em minúsculas
  senha_hash  text not null,
  cargo       text default '',                -- '' (pendente) | 'admin' | 'assistencia' | 'leitor'
  token       text,
  token_ts    bigint,
  criado_em   text
);

-- ── kv_store ───────────────────────────────────────────────────────────
-- substitui DUAS coisas do Apps Script:
--  1) a aba "Config" (contadores de ID sequenciais: seqP, seqIM, seqF, seqGU, seqR)
--  2) o PropertiesService (SAL do hash de senha, EMAIL_LEMBRETE, divisores por
--     grupo/serviço tipo "DIV_Ed. Central|Água")
-- tudo é só chave/valor, não precisa de duas tabelas separadas.
create table if not exists kv_store (
  chave  text primary key,
  valor  text
);

-- ═══════════════════════════════════════════════════════════════════════
-- Segurança: RLS ligado, zero policy pra anon/authenticated.
-- Só service_role (Edge Function) acessa. O navegador nunca fala direto
-- com essas tabelas — igual hoje ele nunca fala direto com o Sheets.
-- ═══════════════════════════════════════════════════════════════════════
alter table proprietarios  enable row level security;
alter table imoveis        enable row level security;
alter table fornecedores   enable row level security;
alter table grupos         enable row level security;
alter table rateio         enable row level security;
alter table rateio_status  enable row level security;
alter table repasses       enable row level security;
alter table rotina_diaria  enable row level security;
alter table guias          enable row level security;
alter table usuarios       enable row level security;
alter table kv_store       enable row level security;
