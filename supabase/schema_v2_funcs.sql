-- ═══════════════════════════════════════════════════════════════════════
-- Painel Valoriza — funções auxiliares (rodar DEPOIS do schema.sql)
--
-- next_id(prefixo): gera IDs no mesmo formato de sempre (P-0001, IM-0001...)
-- usando kv_store como contador. No Apps Script isso precisava de um
-- LockService manual pra evitar dois usuários pegarem o mesmo número ao
-- mesmo tempo; aqui o próprio Postgres resolve isso sozinho (o UPDATE
-- trava a linha durante a transação, concorrência não é mais um problema
-- que o código precisa tratar).
--
-- Como rodar: cole no SQL Editor do Supabase e execute. Seguro rodar
-- de novo (create or replace).
-- ═══════════════════════════════════════════════════════════════════════

create or replace function next_id(p_prefixo text) returns text as $$
declare
  v_chave text := 'seq' || p_prefixo;
  v_n int;
begin
  insert into kv_store(chave, valor) values (v_chave, '1')
  on conflict (chave) do update set valor = (coalesce(kv_store.valor::int, 0) + 1)::text
  returning valor::int into v_n;
  return p_prefixo || '-' || lpad(v_n::text, 4, '0');
end;
$$ language plpgsql;
