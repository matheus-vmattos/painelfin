// ═══════════════════════════════════════════════════════════════════════
// Painel Valoriza — API (Edge Function)
// Substitui apps-script/Code.gs. Mesmo protocolo de ação (?action=X ou
// {action:'X',...} no corpo), mesmas permissões, mesmas respostas —
// só o transporte muda (Postgres em vez de Google Sheets).
//
// Deploy: supabase functions deploy api --no-verify-jwt
//   (--no-verify-jwt porque a autenticação é a nossa própria, por token
//   custom guardado em `usuarios`, igual ao Code.gs — não é o login do
//   Supabase. Sem essa flag, o gateway do Supabase rejeitaria a chamada
//   antes mesmo de chegar aqui.)
//
// Variáveis de ambiente: nenhuma para configurar. SUPABASE_DB_URL já
// vem injetada automaticamente pelo Supabase em toda Edge Function.
// ═══════════════════════════════════════════════════════════════════════
import postgres from "npm:postgres@3";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 3 });

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
function json(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Mapa de tabelas: nome lógico (como o frontend já usa) -> tabela real
// + tradução de colunas Postgres (snake_case) <-> chaves originais da
// planilha (as que o index.html já espera, tipo "Cód Imóvel", "CPF Prop.")
// Trocar só isso aqui é o que deixa o frontend inalterado.
// ─────────────────────────────────────────────────────────────────────
type ColMap = Record<string, string>; // pg_col -> chave original
const TABLES: Record<string, { table: string; prefixo?: string; cols: ColMap }> = {
  "Proprietários": {
    table: "proprietarios", prefixo: "P",
    cols: { id: "ID", proprietario: "Proprietário", cpf: "CPF", qtd_imoveis: "Qtd Imóveis",
      forma_pagto: "Forma Pagto", banco: "Banco", agencia: "Agência", conta: "Conta",
      nominal: "Nominal", chave_pix: "Chave Pix", email: "E-mail", telefone: "Telefone",
      cod_p: "Cód (P)", observacoes: "Observações" },
  },
  "Imóveis": {
    table: "imoveis", // sem prefixo: id é bigint auto-gerado pelo Postgres (ver schema.sql)
    cols: { id: "ID", cod_imovel: "Cód Imóvel", endereco: "Endereço", proprietario: "Proprietário",
      cpf_prop: "CPF Prop.", pct_recibo: "% Recibo", forma_pagto: "Forma Pagto", banco: "Banco",
      agencia: "Agência", conta: "Conta", nominal: "Nominal",
      contrato_locatario: "Contrato (locatário)", status: "Status", grupo: "Grupo",
      nao_cobrar: "Não cobrar" },
  },
  "Fornecedores": {
    table: "fornecedores", prefixo: "F",
    cols: { id: "ID", fornecedor: "Fornecedor", tipo: "Tipo", cpf_cnpj: "CPF/CNPJ",
      categoria: "Categoria", contato: "Contato", email: "E-mail", telefone: "Telefone",
      chave_pix_banco: "Chave Pix / Banco", observacoes: "Observações" },
  },
  "Guias": {
    table: "guias", prefixo: "GU",
    cols: { id: "ID", titulo: "Título", conteudo: "Conteúdo", mapa: "Mapa", atualizado: "Atualizado" },
  },
  "Repasses": {
    table: "repasses",
    cols: { id: "ID", dia: "Dia", proprietario: "Proprietário" },
  },
};
const RATEIO_COLS: ColMap = {
  id: "ID", competencia: "Competência", grupo: "Grupo", cod_imovel: "Cód Imóvel",
  endereco: "Endereço", servico: "Serviço", data_referencia: "Data Referência",
  valor: "Valor", complemento: "Complemento", nao_cobrar: "Não cobrar", copiado: "Copiado",
};

function rowToApi(cols: ColMap, row: Record<string, unknown>) {
  const o: Record<string, unknown> = {};
  for (const [pg, orig] of Object.entries(cols)) o[orig] = row[pg] ?? "";
  return o;
}
function apiToRow(cols: ColMap, dados: Record<string, unknown>) {
  const inv: Record<string, string> = {};
  for (const [pg, orig] of Object.entries(cols)) inv[orig] = pg;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dados || {})) {
    const pg = inv[k];
    if (pg) o[pg] = v;
  }
  return o;
}

// ─────────────────────────────────────────────────────────────────────
// kv_store — substitui a aba Config + o PropertiesService do Apps Script
// ─────────────────────────────────────────────────────────────────────
async function kvGet(chave: string): Promise<string | null> {
  const r = await sql`select valor from kv_store where chave=${chave}`;
  return r.length ? r[0].valor : null;
}
async function kvSet(chave: string, valor: string) {
  await sql`insert into kv_store(chave,valor) values (${chave},${valor})
            on conflict (chave) do update set valor=excluded.valor`;
}
async function nextId(prefixo: string): Promise<string> {
  const r = await sql`select next_id(${prefixo}) as id`;
  return r[0].id as string;
}

// ─────────────────────────────────────────────────────────────────────
// Autenticação — mesmo algoritmo do Code.gs (SHA-256 salgado, hex),
// pra permitir migrar os usuários existentes copiando SAL + SenhaHash
// sem precisar redefinir senha de ninguém.
// ─────────────────────────────────────────────────────────────────────
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function getSal(): Promise<string> {
  let sal = await kvGet("SAL");
  if (!sal) { sal = crypto.randomUUID(); await kvSet("SAL", sal); }
  return sal;
}
async function hash(senha: string): Promise<string> {
  return sha256Hex((await getSal()) + String(senha));
}
function uNorm(u: string): string { return String(u || "").trim().toLowerCase(); }

async function temUsuarios(): Promise<boolean> {
  const r = await sql`select 1 from usuarios where cargo='admin' limit 1`;
  return r.length > 0;
}
async function uFind(usuario: string) {
  const u = uNorm(usuario);
  const r = await sql`select * from usuarios where lower(usuario)=${u} limit 1`;
  return r.length ? r[0] : null;
}
async function registrar(usuario: string, senha: string) {
  usuario = uNorm(usuario);
  if (!usuario || usuario.length < 3) return { erro: "usuário precisa de ao menos 3 caracteres" };
  if (!senha || String(senha).length < 4) return { erro: "senha precisa de ao menos 4 caracteres" };
  if (!/^[a-z0-9._-]+$/.test(usuario)) return { erro: "use só letras, números, ponto, hífen ou underline" };
  if (await uFind(usuario)) return { erro: "este usuário já existe" };
  const primeiro = !(await temUsuarios());
  await sql`insert into usuarios (usuario, senha_hash, cargo, criado_em)
            values (${usuario}, ${await hash(senha)}, ${primeiro ? "admin" : ""}, ${hojeStr()})`;
  return { ok: true, pendente: !primeiro, admin: primeiro, msg: primeiro ? "Cadastrado como admin." : "Aguarde aprovação de um admin." };
}
async function login(usuario: string, senha: string) {
  const u = await uFind(usuario);
  if (!u || (await hash(senha)) !== u.senha_hash) return { erro: "usuário ou senha incorretos" };
  if (!u.cargo) return { erro: "cadastro ainda não aprovado", pendente: true };
  const tok = crypto.randomUUID();
  await sql`update usuarios set token=${tok}, token_ts=${Date.now()} where usuario=${u.usuario}`;
  return { ok: true, token: tok, usuario: u.usuario, cargo: u.cargo };
}
async function sessaoDe(tok?: string) {
  if (!tok || String(tok).trim().length < 10) return null;
  const r = await sql`select * from usuarios where token=${tok} limit 1`;
  if (!r.length) return null;
  const u = r[0];
  if (Date.now() - Number(u.token_ts || 0) > 1000 * 60 * 60 * 24 * 30) return null;
  if (!u.cargo) return null;
  return { usuario: u.usuario, cargo: u.cargo as string };
}
function podeAcao(sess: { cargo: string }, a: string): boolean {
  if (sess.cargo === "admin") return true;
  const escrita = /^(salvar|adicionar|excluir|setGrupo|addGrupo|transferir|lancarRateio|toggleCopiado|toggleCopiadoLote|finalizarRateio|reabrirRateio|excluirRateioComp|addRepasse|limparGrupos|initRepasses|initGuias|initIDs|rotina|setEmail)/;
  const exclusao = /^(excluir|excluirRateioComp|limpar|rotinaDel)/;
  if (sess.cargo === "leitor") return !escrita.test(a);
  if (sess.cargo === "assistencia") return !exclusao.test(a);
  return false;
}
async function listarUsuarios() {
  const rs = await sql`select usuario, cargo, criado_em from usuarios order by criado_em`;
  return { ok: true, usuarios: rs.map((u) => ({ usuario: u.usuario, cargo: u.cargo || "", pendente: !u.cargo, criadoEm: u.criado_em || "" })) };
}
async function setCargo(usuario: string, cargo: string) {
  cargo = String(cargo || "").trim();
  if (!["admin", "assistencia", "leitor", ""].includes(cargo)) return { erro: "cargo inválido" };
  const u = await uFind(usuario);
  if (!u) return { erro: "usuário não encontrado" };
  await sql`update usuarios set cargo=${cargo} where usuario=${u.usuario}`;
  return { ok: true, usuario: u.usuario, cargo };
}
async function excluirUsuario(usuario: string, quemPede: string) {
  const u = await uFind(usuario);
  if (!u) return { erro: "usuário não encontrado" };
  if (uNorm(usuario) === uNorm(quemPede)) return { erro: "você não pode excluir a si mesmo" };
  if (u.cargo === "admin") {
    const admins = await sql`select count(*)::int as n from usuarios where cargo='admin'`;
    if (admins[0].n <= 1) return { erro: "não dá para excluir o último admin" };
  }
  await sql`delete from usuarios where usuario=${u.usuario}`;
  return { ok: true };
}
async function trocaSenhaSess(tok: string, atual: string, nova: string) {
  const sess = await sessaoDe(tok);
  if (!sess) return { erro: "sessão inválida" };
  const u = await uFind(sess.usuario);
  if (!u || (await hash(atual)) !== u.senha_hash) return { erro: "senha atual incorreta" };
  if (!nova || String(nova).length < 4) return { erro: "nova senha precisa de ao menos 4 caracteres" };
  const novoTok = crypto.randomUUID();
  await sql`update usuarios set senha_hash=${await hash(nova)}, token=${novoTok}, token_ts=${Date.now()} where usuario=${u.usuario}`;
  return { ok: true, token: novoTok };
}

// ─────────────────────────────────────────────────────────────────────
// CRUD genérico (Proprietários, Imóveis, Fornecedores, Guias, Repasses)
// ─────────────────────────────────────────────────────────────────────
function hojeStr(): string {
  return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
async function listar(aba: string) {
  const t = TABLES[aba];
  if (!t) return { ok: false, erro: "aba desconhecida: " + aba };
  const rows = await sql`select * from ${sql(t.table)} order by criado_em nulls last`.catch(
    async () => await sql`select * from ${sql(t.table)}`, // repasses não tem criado_em
  );
  const itens = rows.map((r) => rowToApi(t.cols, r));
  return { ok: true, cabecalhos: Object.values(t.cols), itens };
}
async function salvar(aba: string, chaveCol: string, chave: string, dados: Record<string, unknown>) {
  const t = TABLES[aba];
  if (!t) return { ok: false, erro: "aba desconhecida: " + aba };
  const invCols: Record<string, string> = {};
  for (const [pg, orig] of Object.entries(t.cols)) invCols[orig] = pg;
  const pgChaveCol = invCols[chaveCol];
  if (!pgChaveCol) return { ok: false, erro: "coluna chave inexistente: " + chaveCol };
  const row = apiToRow(t.cols, dados);
  if (!Object.keys(row).length) return { ok: true, linha: 0 };
  const sets = Object.entries(row).map(([k, v]) => sql`${sql(k)} = ${v as never}`);
  // atualiza só UMA linha (a de id mais baixo), mesmo que chaveCol tenha
  // colisão nos dados (ex: Cód Imóvel duplicado por erro histórico na
  // planilha) — nunca sobrescreve várias linhas de uma vez por engano
  const r = await sql`update ${sql(t.table)} set ${sets.reduce((a, b) => sql`${a}, ${b}`)}, atualizado_em = now()
                       where id = (select id from ${sql(t.table)} where ${sql(pgChaveCol)} = ${chave} order by id limit 1)
                       returning id`;
  if (!r.length) return { ok: false, erro: "chave nao encontrada" };
  return { ok: true, linha: 1 };
}
async function adicionar(aba: string, dados: Record<string, unknown>) {
  const t = TABLES[aba];
  if (!t) return { ok: false, erro: "aba desconhecida: " + aba };
  const row = apiToRow(t.cols, dados);
  if (!row.id && t.prefixo) row.id = await nextId(t.prefixo);
  // "returning id" também cobre Imóveis (sem prefixo): o Postgres gera o
  // bigint sozinho e devolvemos ele pro frontend usar em seguida
  const r = await sql`insert into ${sql(t.table)} ${sql(row)} returning id`;
  return { ok: true, id: String(row.id ?? r[0]?.id ?? "") };
}
async function excluir(aba: string, id: string) {
  const t = TABLES[aba];
  if (!t) return { ok: false, erro: "aba desconhecida: " + aba };
  const r = await sql`delete from ${sql(t.table)} where id::text=${String(id)} returning id`;
  if (!r.length) return { ok: false, erro: "id nao encontrado" };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────
// Grupos (condomínios)
// ─────────────────────────────────────────────────────────────────────
function pareceCompetencia(s: string): boolean { return /^\d{1,2}\s*[/-]\s*\d{4,5}$/.test(String(s || "").trim()); }
async function addGrupo(grupo: string) {
  grupo = String(grupo || "").trim();
  if (!grupo) return { ok: false, erro: "grupo vazio" };
  if (pareceCompetencia(grupo)) return { ok: false, erro: "nome invalido (parece competencia)" };
  await sql`insert into grupos (grupo) values (${grupo}) on conflict (grupo) do nothing`;
  return { ok: true, grupo };
}
async function setGrupo(codigos: string[], grupo: string) {
  await addGrupo(grupo);
  const r = await sql`update imoveis set grupo=${grupo}, atualizado_em=now() where cod_imovel = any(${codigos}) returning id`;
  return { ok: true, atualizados: r.length };
}
async function imoveisGrupo(grupo: string) {
  const rows = await sql`select id, cod_imovel, endereco, status, nao_cobrar from imoveis where grupo=${grupo}`;
  const itens = rows.map((r) => ({ id: r.id, cod: r.cod_imovel, endereco: r.endereco, status: r.status, naoCobrar: !!String(r.nao_cobrar || "").trim() }));
  return { ok: true, grupo, itens, total: itens.length };
}
async function limparGrupos() {
  // no schema novo, addGrupo() já bloqueia nome vazio/tipo-competência e
  // a PK evita duplicata — não existe mais "lixo" pra limpar aqui
  return { ok: true, removidas: 0 };
}

// ─────────────────────────────────────────────────────────────────────
// Rateio
// ─────────────────────────────────────────────────────────────────────
function compKey(x: unknown): string {
  const t = String(x ?? "").trim();
  let m = t.match(/^(\d{1,2})\s*[/-]\s*(\d{4})$/);
  if (m) return m[1].padStart(2, "0") + "/" + m[2];
  m = t.match(/^(\d{4})\s*[/-]\s*(\d{1,2})$/);
  if (m) return m[2].padStart(2, "0") + "/" + m[1];
  return t;
}
async function rateioFinalizado(grupo: string, comp: string): Promise<boolean> {
  const r = await sql`select status from rateio_status where grupo=${grupo} and competencia=${comp}`;
  return r.length > 0 && r[0].status === "Finalizado";
}
async function resumoGrupoComp(grupo: string, comp: string) {
  const r = await sql`select count(*)::int as n, coalesce(sum(valor),0) as total,
                       count(distinct cod_imovel)::int as imoveis,
                       count(distinct cod_imovel) filter (where copiado='Sim')::int as copiados
                       from rateio where grupo=${grupo} and competencia=${comp}`;
  const row = r[0];
  return { lancamentos: row.n, total: Math.round(Number(row.total) * 100) / 100, imoveis: row.imoveis, copiados: row.copiados };
}
async function resumoRateios(comp: string) {
  comp = compKey(comp);
  const rows = await sql`select grupo, count(*)::int as n, coalesce(sum(valor),0) as total,
                          count(distinct cod_imovel)::int as imoveis,
                          count(distinct cod_imovel) filter (where copiado='Sim')::int as copiados
                          from rateio where competencia=${comp} group by grupo`;
  const fin = await sql`select grupo, status, finalizado_em from rateio_status where competencia=${comp}`;
  const finMap: Record<string, { status: string; em: string }> = {};
  for (const f of fin) finMap[f.grupo] = { status: f.status, em: f.finalizado_em || "" };
  const grupos: Record<string, unknown> = {};
  for (const r of rows) {
    const f = finMap[r.grupo];
    grupos[r.grupo] = {
      lancamentos: r.n, total: Math.round(Number(r.total) * 100) / 100, imoveis: r.imoveis, copiados: r.copiados,
      status: f?.status === "Finalizado" ? "Finalizado" : "Em andamento", finalizadoEm: f?.em || "",
    };
  }
  for (const [g, f] of Object.entries(finMap)) {
    if (!grupos[g]) grupos[g] = { lancamentos: 0, total: 0, imoveis: 0, copiados: 0, status: f.status, finalizadoEm: f.em };
  }
  return { ok: true, competencia: comp, grupos };
}
async function lancarRateio(linhas: Record<string, unknown>[], divisores?: Record<string, number>) {
  if (!linhas?.length) return { ok: false, erro: "sem linhas" };
  for (const d of linhas) d["Competência"] = compKey(d["Competência"]);
  const comp = linhas[0]["Competência"] as string;
  const grupo = String(linhas[0]["Grupo"] || "").trim();
  if (!/^\d{2}\/\d{4}$/.test(comp)) return { ok: false, erro: "competencia invalida: " + comp };
  if (await rateioFinalizado(grupo, comp)) return { ok: false, erro: `rateio ${comp} de ${grupo} está FINALIZADO. Reabra para alterar.` };

  let inseridas = 0, atualizadas = 0;
  await sql.begin(async (tx) => {
    for (const d of linhas) {
      // "ID" que o frontend manda é a chave de negócio (competência|grupo|cód|serviço),
      // recalculada a cada "Gerar por imóvel" — não é a chave técnica da linha (essa
      // é o id bigint, que o frontend nunca vê nem precisa ver aqui). Guardamos essa
      // chave em id_planilha e fazemos upsert por ela: se já existe uma linha com essa
      // combinação, atualiza em vez de duplicar (preserva o "copiado" já marcado).
      // Se por acaso houver mais de uma linha com o mesmo id_planilha (dado histórico
      // migrado com colisão), atualiza a mais recente — nunca todas de uma vez.
      const idPlanilha = String(d["ID"] || "").trim() || `${comp}|${grupo}|${d["Cód Imóvel"]}|${d["Serviço"]}`;
      const row = apiToRow(RATEIO_COLS, d);
      delete row.id; delete row.copiado; // "copiado" nunca é sobrescrito por aqui
      const r = await tx`update rateio set ${tx(row)}, atualizado_em=now()
                          where id = (select id from rateio where id_planilha=${idPlanilha} order by id desc limit 1)
                          returning id`;
      if (r.length) { atualizadas++; continue; }
      const full = apiToRow(RATEIO_COLS, d);
      delete full.id;
      full.id_planilha = idPlanilha;
      await tx`insert into rateio ${tx(full)}`;
      inseridas++;
    }
    if (divisores) {
      const pares: Record<string, string> = {};
      for (const [sv, val] of Object.entries(divisores)) if (Number(val) > 0) pares[`DIV_${grupo}|${sv}`] = String(Number(val));
      for (const [k, v] of Object.entries(pares)) {
        await tx`insert into kv_store(chave,valor) values (${k},${v}) on conflict (chave) do update set valor=excluded.valor`;
      }
    }
    await tx`insert into rateio_status (grupo,competencia,status) values (${grupo},${comp},'Em andamento')
              on conflict (grupo,competencia) do update set status='Em andamento' where rateio_status.status <> 'Finalizado'`;
  });
  return { ok: true, inseridas, atualizadas };
}
async function toggleCopiado(id: string, valor: boolean) {
  const r = await sql`update rateio set copiado=${valor ? "Sim" : ""} where id::text=${String(id)} returning id`;
  if (!r.length) return { ok: false, erro: "id nao encontrado" };
  return { ok: true };
}
async function toggleCopiadoLote(ids: string[], valor: boolean) {
  if (!ids?.length) return { ok: false, erro: "sem ids" };
  const idsStr = ids.map(String);
  const r = await sql`update rateio set copiado=${valor ? "Sim" : ""} where id::text = any(${idsStr}) returning id`;
  const achados = new Set(r.map((x) => String(x.id)));
  const sumidos = idsStr.filter((i) => !achados.has(i));
  return { ok: true, marcadas: r.length, naoAchados: sumidos.length, idsSumidos: sumidos.slice(0, 5) };
}
async function divisoresGrupo(grupo: string) {
  const out: Record<string, number> = {};
  for (const s of ["Água", "Luz", "Manutenção", "Gás", "Outro"]) {
    const v = await kvGet(`DIV_${grupo}|${s}`);
    if (v) out[s] = Number(v) || 0;
  }
  return { ok: true, grupo, divisores: out };
}
async function duplicarCompetencia(grupo: string, de: string, para: string) {
  grupo = String(grupo || "").trim(); de = compKey(de); para = compKey(para);
  if (!grupo || !/^\d{2}\/\d{4}$/.test(de) || !/^\d{2}\/\d{4}$/.test(para)) return { ok: false, erro: "parâmetros inválidos" };
  if (de === para) return { ok: false, erro: "competências iguais" };
  if (await rateioFinalizado(grupo, para)) return { ok: false, erro: "destino finalizado; reabra antes" };
  const existeDestino = await sql`select 1 from rateio where grupo=${grupo} and competencia=${para} limit 1`;
  if (existeDestino.length) return { ok: false, erro: `já há lançamentos em ${para} para este grupo` };
  const origem = await sql`select * from rateio where grupo=${grupo} and competencia=${de}`;
  if (!origem.length) return { ok: false, erro: `sem lançamentos em ${de} para copiar` };
  await sql.begin(async (tx) => {
    for (const row of origem) {
      await tx`insert into rateio (id_planilha, competencia, grupo, cod_imovel, endereco, servico, data_referencia, valor, complemento, nao_cobrar, copiado)
                values (${`${para}|${grupo}|${row.cod_imovel}|${row.servico}`}, ${para}, ${grupo}, ${row.cod_imovel}, ${row.endereco},
                        ${row.servico}, ${row.data_referencia}, ${row.valor}, ${"CÓPIA de " + de + " (revisar)"}, ${row.nao_cobrar}, '')`;
    }
    await tx`insert into rateio_status (grupo,competencia,status) values (${grupo},${para},'Em andamento') on conflict (grupo,competencia) do nothing`;
  });
  return { ok: true, copiadas: origem.length, de, para };
}
async function salvarLancamentoRateio(id: string, dados: { valor?: number; compl?: string; serv?: string }) {
  if (!id) return { ok: false, erro: "sem id" };
  id = String(id);
  const r0 = await sql`select grupo, competencia from rateio where id::text=${id}`;
  if (!r0.length) return { ok: false, erro: "lançamento não encontrado" };
  if (await rateioFinalizado(r0[0].grupo, r0[0].competencia)) return { ok: false, erro: "rateio finalizado: reabra antes de editar" };
  const sets: Record<string, unknown> = {};
  if (dados?.valor != null) sets.valor = Number(dados.valor) || 0;
  if (dados?.compl != null) sets.complemento = String(dados.compl);
  if (dados?.serv != null) sets.servico = String(dados.serv);
  if (Object.keys(sets).length) await sql`update rateio set ${sql(sets)}, atualizado_em=now() where id::text=${id}`;
  return { ok: true };
}
async function excluirLancamentoRateio(id: string) {
  if (!id) return { ok: false, erro: "sem id" };
  id = String(id);
  const r0 = await sql`select grupo, competencia from rateio where id::text=${id}`;
  if (!r0.length) return { ok: false, erro: "lançamento não encontrado" };
  if (await rateioFinalizado(r0[0].grupo, r0[0].competencia)) return { ok: false, erro: "rateio finalizado: reabra antes de excluir" };
  await sql`delete from rateio where id::text=${id}`;
  return { ok: true, removidas: 1 };
}
async function finalizarRateio(grupo: string, comp: string) {
  grupo = String(grupo || "").trim(); comp = compKey(comp);
  if (!grupo || !comp) return { ok: false, erro: "grupo/competencia obrigatorios" };
  const res = await resumoGrupoComp(grupo, comp);
  if (!res.lancamentos) return { ok: false, erro: "sem lancamentos para finalizar" };
  const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  await sql`insert into rateio_status (grupo,competencia,status,finalizado_em,total) values (${grupo},${comp},'Finalizado',${agora},${res.total})
            on conflict (grupo,competencia) do update set status='Finalizado', finalizado_em=${agora}, total=${res.total}`;
  return { ok: true, grupo, competencia: comp, total: res.total };
}
async function reabrirRateio(grupo: string, comp: string) {
  const r = await sql`update rateio_status set status='Em andamento', finalizado_em='' where grupo=${grupo} and competencia=${compKey(comp)} returning grupo`;
  if (!r.length) return { ok: false, erro: "sem registro para reabrir" };
  return { ok: true, reabertas: r.length };
}
async function excluirRateioComp(grupo: string, comp: string) {
  comp = compKey(comp);
  if (await rateioFinalizado(grupo, comp)) return { ok: false, erro: "rateio finalizado — reabra antes de excluir" };
  const r = await sql`delete from rateio where grupo=${grupo} and competencia=${comp} returning id`;
  return { ok: true, removidas: r.length };
}
async function historicoRateio(grupo: string) {
  const rows = await sql`select * from rateio where grupo=${grupo} order by competencia`;
  const linhas = rows.map((r) => rowToApi(RATEIO_COLS, r));
  const comps: string[] = [];
  for (const l of linhas) { const c = String(l["Competência"] || ""); if (c && !comps.includes(c)) comps.push(c); }
  return { ok: true, competencias: comps, linhas };
}
async function repararRateioStatus() {
  // no schema novo (UNIQUE grupo+competencia) duplicata é estruturalmente
  // impossível — mantido só por compatibilidade com o botão já existente
  const r = await sql`select count(*)::int as n from rateio_status`;
  return { ok: true, removidas: 0, restantes: r[0].n };
}

// ─────────────────────────────────────────────────────────────────────
// Repasses
// ─────────────────────────────────────────────────────────────────────
async function addRepasse(dia: string, proprietario: string) {
  const id = await nextId("R");
  await sql`insert into repasses (id, dia, proprietario) values (${id}, ${dia}, ${proprietario})`;
  return { ok: true, id };
}

// ─────────────────────────────────────────────────────────────────────
// Rotina diária
// ─────────────────────────────────────────────────────────────────────
function respHoje(v: string | null, hoje: string): string {
  const s = String(v || ""); const i = s.indexOf("|");
  if (i < 0) return "";
  return s.slice(0, i) === hoje ? s.slice(i + 1) : "";
}
async function rotinaDia() {
  const rows = await sql`select * from rotina_diaria order by ordem`;
  const hoje = hojeStr();
  type Item = { id: string; ordem: number; texto: string; tipo: string; pai: string; feito?: boolean; resposta?: string; filhos?: Item[]; concluido?: boolean };
  const brutos: Item[] = rows.map((r) => {
    const tipo = r.tipo || "chk";
    const base: Item = { id: String(r.id), ordem: Number(r.ordem) || 0, texto: r.texto, tipo, pai: r.pai || "" };
    if (tipo === "sn") base.resposta = respHoje(r.resposta, hoje);
    else base.feito = String(r.feito_em || "") === hoje;
    return base;
  });
  const porId: Record<string, Item> = {}; for (const o of brutos) porId[o.id] = o;
  const topo: Item[] = [];
  for (const o of brutos) {
    if (o.pai && porId[o.pai]) { const p = porId[o.pai]; (p.filhos ??= []).push(o); }
    else topo.push(o);
  }
  let feitos = 0, total = 0;
  for (const o of topo) {
    if (o.tipo === "sn") {
      total++;
      if (o.resposta === "Não") { feitos++; o.concluido = true; }
      else if (o.resposta === "Sim") {
        const fs = o.filhos || [];
        total += fs.length; feitos += fs.filter((f) => f.feito).length;
        o.concluido = fs.length > 0 && fs.every((f) => f.feito);
      } else o.concluido = false;
    } else { total++; if (o.feito) feitos++; o.concluido = o.feito; }
  }
  return { ok: true, itens: topo, feitos, total };
}
async function rotinaMarcar(id: string, feito: boolean) {
  const r0 = await sql`select tipo from rotina_diaria where id=${id}`;
  if (!r0.length) return { erro: "item nao encontrado: " + id };
  if (r0[0].tipo === "sn") return { erro: "este item é uma pergunta sim/não; use rotinaResponder" };
  await sql`update rotina_diaria set feito_em=${feito ? hojeStr() : ""} where id=${id}`;
  return { ok: true, gravado: feito ? hojeStr() : "" };
}
async function rotinaResponder(id: string, resposta: string) {
  resposta = String(resposta || "").trim();
  if (resposta !== "Sim" && resposta !== "Não") return { erro: "resposta deve ser Sim ou Não" };
  const r0 = await sql`select tipo from rotina_diaria where id=${id}`;
  if (!r0.length) return { erro: "item nao encontrado: " + id };
  if (r0[0].tipo !== "sn") return { erro: "este item não é uma pergunta sim/não" };
  await sql`update rotina_diaria set resposta=${hojeStr() + "|" + resposta} where id=${id}`;
  return { ok: true, resposta };
}
async function rotinaAdd(texto: string) {
  texto = String(texto || "").trim();
  if (!texto) return { erro: "texto vazio" };
  const m = await sql`select coalesce(max(ordem),0)::int as m from rotina_diaria`;
  await sql`insert into rotina_diaria (id, ordem, texto, tipo) values (${"RD-" + crypto.randomUUID().slice(0, 6)}, ${m[0].m + 1}, ${texto}, 'chk')`;
  return { ok: true };
}
async function rotinaDel(id: string) {
  const r = await sql`delete from rotina_diaria where id=${id} or pai=${id} returning id`;
  if (!r.length) return { erro: "nao encontrado" };
  return { ok: true, removidas: r.length };
}
async function rotinaMover(id: string, dir: number) {
  const lin = await sql`select id, ordem from rotina_diaria order by ordem`;
  const i = lin.findIndex((x) => String(x.id) === String(id));
  if (i < 0) return { erro: "nao encontrado" };
  const j = i + (dir < 0 ? -1 : 1);
  if (j < 0 || j >= lin.length) return { ok: true };
  await sql`update rotina_diaria set ordem=${lin[j].ordem} where id=${lin[i].id}`;
  await sql`update rotina_diaria set ordem=${lin[i].ordem} where id=${lin[j].id}`;
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────
// Proprietários — extras
// ─────────────────────────────────────────────────────────────────────
async function imoveisProp(cpf: string) {
  const cpfNum = String(cpf || "").replace(/\D/g, "");
  const rows = await sql`select id, cod_imovel, endereco, status, grupo from imoveis where regexp_replace(cpf_prop,'\\D','','g')=${cpfNum}`;
  const grupos: Record<string, number> = {};
  for (const r of rows) { const g = String(r.grupo || "").trim(); if (g) grupos[g] = (grupos[g] || 0) + 1; }
  return {
    ok: true,
    imoveis: rows.map((r) => ({ id: r.id, cod: r.cod_imovel, endereco: r.endereco, status: r.status, grupo: r.grupo })),
    grupos: Object.entries(grupos).map(([grupo, qtd]) => ({ grupo, qtd })),
  };
}
async function transferir(idImovel: string, novoProp: string, novoCpf: string) {
  const r = await sql`update imoveis set proprietario=${novoProp}, cpf_prop=${novoCpf || ""}, atualizado_em=now() where id::text=${String(idImovel)} returning id`;
  if (!r.length) return { ok: false, erro: "imovel nao encontrado" };
  return { ok: true };
}
function nrm(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
async function duplicados() {
  const props = await sql`select id, proprietario, cpf from proprietarios`;
  const imoveis = await sql`select id, cod_imovel, endereco, proprietario from imoveis`;
  function grupoPor<T>(rows: T[], keyFn: (r: T) => string) {
    const m: Record<string, T[]> = {};
    for (const r of rows) { const k = keyFn(r); if (!k) continue; (m[k] ??= []).push(r); }
    return Object.values(m).filter((g) => g.length > 1);
  }
  return {
    ok: true,
    dup: {
      proprietarios: grupoPor(props, (r) => nrm(r.cpf)).map((g) => g.map((r) => ({ id: r.id, nome: r.proprietario, cpf: r.cpf }))),
      imoveis: grupoPor(imoveis, (r) => nrm(r.endereco)).map((g) => g.map((r) => ({ id: r.id, cod: r.cod_imovel, endereco: r.endereco, prop: r.proprietario }))),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Bootstrap — as leituras são independentes, então rodam em paralelo
// (isso sozinho já é mais rápido que o Apps Script, que só conseguia
// uma leitura de sheet por vez dentro da mesma execução)
// ─────────────────────────────────────────────────────────────────────
async function bootstrap(competencia: string | undefined, sess: { usuario: string; cargo: string }) {
  // junta TUDO que o boot() do frontend precisa numa chamada só, inclusive
  // a sessão (usuario/cargo) e a rotina do dia (aba "Hoje", sempre a
  // primeira que abre) — antes eram 2 chamadas separadas (eu + rotinaDia)
  // depois do bootstrap, cada uma um round-trip a mais no carregamento inicial
  const [imoveis, grupos, repasses, proprietarios, fornecedores, rateios, rotina] = await Promise.all([
    listar("Imóveis").then((r) => r.itens).catch(() => []),
    sql`select grupo from grupos order by grupo`.then((r) => r.map((x) => x.grupo)).catch(() => []),
    listar("Repasses").then((r) => r.itens).catch(() => []),
    listar("Proprietários").then((r) => r.itens).catch(() => []),
    listar("Fornecedores").then((r) => r.itens).catch(() => []),
    competencia ? resumoRateios(competencia).then((r) => r.grupos).catch(() => ({})) : Promise.resolve(undefined),
    rotinaDia().catch(() => null),
  ]);
  const out: Record<string, unknown> = {
    ok: true, imoveis, grupos, repasses, proprietarios, fornecedores,
    usuario: sess.usuario, cargo: sess.cargo,
  };
  if (competencia) out.rateios = rateios;
  if (rotina) { out.rotinaItens = rotina.itens; out.rotinaFeitos = rotina.feitos; out.rotinaTotal = rotina.total; }
  return out;
}

async function setEmailLembrete(email: string) {
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { erro: "e-mail inválido" };
  await kvSet("EMAIL_LEMBRETE", email || "");
  return { ok: true, email: email || "" };
}

// ─────────────────────────────────────────────────────────────────────
// Dispatch — espelha handle(e) do Code.gs
// ─────────────────────────────────────────────────────────────────────
async function readParams(req: Request) {
  const url = new URL(req.url);
  const q = Object.fromEntries(url.searchParams.entries());
  let b: Record<string, unknown> = {};
  if (req.method === "POST") { try { b = await req.json(); } catch { b = {}; } }
  return { q, b };
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const { q, b } = await readParams(req);
    const a = (b.action || q.action) as string | undefined;
    const aba = (b.aba || q.aba) as string | undefined;

    if (a === "ping") return json({ ok: true, versao: "SUPABASE-1.0", protegido: await temUsuarios() });
    if (a === "login") return json(await login((b.usuario || b.senha) as string, b.senha as string));
    if (a === "registrar") return json(await registrar(b.usuario as string, b.senha as string));
    if (a === "trocaSenha") return json(await trocaSenhaSess((b.token || q.token) as string, b.atual as string, b.nova as string));

    const tok = (b.token || q.token) as string | undefined;
    const sess = await sessaoDe(tok);
    if (!sess) return json({ erro: "nao_autorizado", precisaLogin: true });
    if (a === "eu") return json({ ok: true, usuario: sess.usuario, cargo: sess.cargo });
    if (a === "listarUsuarios") return json(sess.cargo === "admin" ? await listarUsuarios() : { erro: "apenas admin" });
    if (a === "setCargo" || a === "aprovarUsuario") return json(sess.cargo === "admin" ? await setCargo(b.usuario as string, b.cargo as string) : { erro: "apenas admin" });
    if (a === "excluirUsuario") return json(sess.cargo === "admin" ? await excluirUsuario(b.usuario as string, sess.usuario) : { erro: "apenas admin" });

    if (!a || !podeAcao(sess, a)) return json({ erro: "sem_permissao", cargo: sess.cargo, precisaPermissao: true });

    if (a === "initIDs") return json({ ok: true, resultado: "não necessário no Postgres (IDs sempre gerados na criação)" });
    if (a === "initGuias" || a === "initRepasses") return json({ ok: true, criadas: ["já existia"] });
    if (a === "listar") return json(await listar(aba!));
    if (a === "salvar") return json(await salvar(aba!, b.chaveCol as string, b.chave as string, b.dados as Record<string, unknown>));
    if (a === "adicionar") return json(await adicionar(aba!, b.dados as Record<string, unknown>));
    if (a === "excluir") return json(await excluir(aba!, b.id as string));
    if (a === "setGrupo") return json(await setGrupo(b.codigos as string[], b.grupo as string));
    if (a === "addGrupo") return json(await addGrupo(b.grupo as string));
    if (a === "imoveisGrupo") return json(await imoveisGrupo(b.grupo as string));
    if (a === "duplicados") return json(await duplicados());
    if (a === "imoveisProp") return json(await imoveisProp(b.cpf as string));
    if (a === "transferir") return json(await transferir(b.id as string, b.proprietario as string, b.cpf as string));
    if (a === "historicoRateio") return json(await historicoRateio(b.grupo as string));
    if (a === "limparGrupos") return json(await limparGrupos());
    if (a === "listarRepasses") return json(await listar("Repasses"));
    if (a === "addRepasse") return json(await addRepasse(b.dia as string, b.proprietario as string));
    if (a === "excluirRepasse") return json(await excluir("Repasses", b.id as string));
    if (a === "lancarRateio") return json(await lancarRateio(b.linhas as Record<string, unknown>[], b.divisores as Record<string, number>));
    if (a === "toggleCopiado") return json(await toggleCopiado(b.id as string, !!b.valor));
    if (a === "toggleCopiadoLote") return json(await toggleCopiadoLote(b.ids as string[], !!b.valor));
    if (a === "salvarLancamentoRateio") return json(await salvarLancamentoRateio(b.id as string, b.dados as never));
    if (a === "excluirLancamentoRateio") return json(await excluirLancamentoRateio(b.id as string));
    if (a === "resumoRateios") return json(await resumoRateios(b.competencia as string));
    if (a === "bootstrap") return json(await bootstrap(b.competencia as string | undefined, sess));
    if (a === "finalizarRateio") return json(await finalizarRateio(b.grupo as string, b.competencia as string));
    if (a === "reabrirRateio") return json(await reabrirRateio(b.grupo as string, b.competencia as string));
    if (a === "excluirRateioComp") return json(await excluirRateioComp(b.grupo as string, b.competencia as string));
    if (a === "repararRateioStatus") return json(sess.cargo === "admin" ? await repararRateioStatus() : { erro: "apenas admin" });
    if (a === "divisoresGrupo") return json(await divisoresGrupo(b.grupo as string));
    if (a === "duplicarCompetencia") return json(await duplicarCompetencia(b.grupo as string, b.de as string, b.para as string));
    if (a === "rotinaDia") return json(await rotinaDia());
    if (a === "rotinaMarcar") return json(await rotinaMarcar(b.id as string, !!b.feito));
    if (a === "rotinaAdd") return json(await rotinaAdd(b.texto as string));
    if (a === "rotinaDel") return json(await rotinaDel(b.id as string));
    if (a === "rotinaMover") return json(await rotinaMover(b.id as string, Number(b.dir)));
    if (a === "rotinaResponder") return json(await rotinaResponder(b.id as string, b.resposta as string));
    if (a === "setEmailLembrete") return json(sess.cargo === "admin" ? await setEmailLembrete(b.email as string) : { erro: "apenas admin" });
    if (a === "getEmailLembrete") return json({ ok: true, email: (await kvGet("EMAIL_LEMBRETE")) || "" });

    return json({ ok: false, erro: "acao invalida" });
  } catch (err) {
    return json({ ok: false, erro: String(err) });
  }
}

Deno.serve(handleRequest);
