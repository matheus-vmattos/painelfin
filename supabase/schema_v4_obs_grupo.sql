-- ═══════════════════════════════════════════════════════════════════════
-- Painel Valoriza — observação por condomínio (rodar depois dos anteriores)
--
-- Campo de texto livre por grupo, mostrado na tela de Rateio quando você
-- abre um condomínio (ex: "Zelador é fixo R$58 por morador, sem divisão").
--
-- Como rodar: cole no SQL Editor do Supabase e execute. Seguro rodar de
-- novo (IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════
alter table grupos add column if not exists observacao text;
