-- Debrief — tabela das tabelas do simulador de taxas e incentivos (só com login).
-- Os DADOS (taxas, incentivos, fatores de ruído e tipos de aeronave) NÃO ficam neste repositório público:
-- são carregados com um ficheiro à parte (04_simulador_dados.sql), corrido no SQL Editor do Supabase do Portal.
-- Só quem tem a permissão «reunioes_companhias» consegue ler. Ninguém consegue escrever pela app.

create table if not exists public.crm_referencia (
  chave text primary key,          -- 'tarifas' | 'incentivos' | 'aeronaves'
  versao text,
  dados jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.crm_referencia enable row level security;
drop policy if exists crm_referencia_ler on public.crm_referencia;
create policy crm_referencia_ler on public.crm_referencia for select to authenticated using (public.crm_tem_acesso());
