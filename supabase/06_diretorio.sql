-- Debrief — Diretório Salesforce: cópia dos contactos do Salesforce, só para consulta (separada dos contactos do Debrief).
-- Os dados NÃO ficam neste repositório: são importados pela app (Definições → Diretório Salesforce → Importar CSV),
-- a partir do relatório «Contactos para o Debrief» exportado do Salesforce.
-- Só quem tem a permissão «reunioes_companhias» lê e importa.

create table if not exists public.crm_diretorio (
  id text primary key,                    -- Contact ID (003…)
  nome text not null default '',
  apelido text not null default '',
  conta text not null default '',         -- Account Name
  conta_id text not null default '',      -- Account ID (001…)
  cargo text not null default '',
  email text not null default '',
  telefone text not null default '',
  telemovel text not null default '',
  bu text not null default '',
  alterado_sf date,                       -- Last Modified Date no Salesforce
  lote text not null default '',          -- importação a que pertence (as linhas de importações antigas são apagadas)
  atualizado_em timestamptz not null default now()
);
create index if not exists crm_diretorio_atualizado on public.crm_diretorio (atualizado_em desc);

alter table public.crm_diretorio enable row level security;
drop policy if exists crm_diretorio_ler on public.crm_diretorio;
drop policy if exists crm_diretorio_inserir on public.crm_diretorio;
drop policy if exists crm_diretorio_alterar on public.crm_diretorio;
drop policy if exists crm_diretorio_apagar on public.crm_diretorio;
create policy crm_diretorio_ler on public.crm_diretorio for select to authenticated using (public.crm_tem_acesso());
create policy crm_diretorio_inserir on public.crm_diretorio for insert to authenticated with check (public.crm_tem_acesso());
create policy crm_diretorio_alterar on public.crm_diretorio for update to authenticated using (public.crm_tem_acesso()) with check (public.crm_tem_acesso());
create policy crm_diretorio_apagar on public.crm_diretorio for delete to authenticated using (public.crm_tem_acesso());

revoke all on public.crm_diretorio from anon;
grant select, insert, update, delete on public.crm_diretorio to authenticated;
