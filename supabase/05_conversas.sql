-- Debrief — conversas do «Perguntar» (privadas: cada pessoa só vê as suas).
-- Corre uma vez no SQL Editor do Supabase do Portal. Não mexe em nada do Portal.

create table if not exists public.crm_conversas (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  titulo text,
  reuniao_id text,
  mensagens jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists crm_conversas_user on public.crm_conversas (user_id, atualizado_em desc);
alter table public.crm_conversas enable row level security;

drop policy if exists crm_conversas_ler on public.crm_conversas;
drop policy if exists crm_conversas_criar on public.crm_conversas;
drop policy if exists crm_conversas_mudar on public.crm_conversas;
drop policy if exists crm_conversas_apagar on public.crm_conversas;
create policy crm_conversas_ler on public.crm_conversas for select to authenticated
  using (user_id = auth.uid() and public.crm_tem_acesso());
create policy crm_conversas_criar on public.crm_conversas for insert to authenticated
  with check (user_id = auth.uid() and public.crm_tem_acesso());
create policy crm_conversas_mudar on public.crm_conversas for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.crm_tem_acesso());
create policy crm_conversas_apagar on public.crm_conversas for delete to authenticated
  using (user_id = auth.uid());

select 'crm_conversas pronta' as estado;
