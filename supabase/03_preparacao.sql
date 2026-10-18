-- Debrief — preparação de reuniões (notícias). Corre uma vez no SQL Editor do Supabase do Portal.
-- Acrescenta: arquivo de notícias, preparações guardadas e uma tarefa de hora a hora que lê os feeds.
-- Não mexe em nada do Portal. Só quem tem a permissão «reunioes_companhias» consegue ler.

-- 1) Arquivo de notícias (escrito só pela função debrief-noticias)
create table if not exists public.crm_noticias (
  id text primary key,                 -- sha1 do link
  fonte text not null,
  titulo text not null,
  resumo text,
  link text not null,
  publicado_em timestamptz,
  obtido_em timestamptz not null default now()
);
create index if not exists crm_noticias_data on public.crm_noticias (coalesce(publicado_em, obtido_em) desc);
alter table public.crm_noticias enable row level security;
drop policy if exists crm_noticias_ler on public.crm_noticias;
create policy crm_noticias_ler on public.crm_noticias for select to authenticated using (public.crm_tem_acesso());

create table if not exists public.crm_noticias_estado (
  id int primary key,
  recolhido_em timestamptz,
  estado jsonb
);
alter table public.crm_noticias_estado enable row level security;
drop policy if exists crm_noticias_estado_ler on public.crm_noticias_estado;
create policy crm_noticias_estado_ler on public.crm_noticias_estado for select to authenticated using (public.crm_tem_acesso());

-- 2) Preparações (uma por companhia, partilhada entre quem tem acesso)
create table if not exists public.crm_preparacoes (
  chave text primary key,
  companhia text,
  dados jsonb not null,
  gerado_em timestamptz not null default now(),
  gerado_por uuid
);
alter table public.crm_preparacoes enable row level security;
drop policy if exists crm_preparacoes_ler on public.crm_preparacoes;
create policy crm_preparacoes_ler on public.crm_preparacoes for select to authenticated using (public.crm_tem_acesso());

-- 3) Pesquisa no arquivo (usada pela função; não fica disponível na app)
create or replace function public.crm_noticias_procurar(padrao text, desde timestamptz, lim int default 160)
returns setof public.crm_noticias language sql stable set search_path = '' as $$
  select * from public.crm_noticias
  where (titulo ~* padrao or coalesce(resumo, '') ~* padrao)
    and coalesce(publicado_em, obtido_em) >= desde
  order by coalesce(publicado_em, obtido_em) desc
  limit lim
$$;
revoke execute on function public.crm_noticias_procurar(text, timestamptz, int) from public, anon, authenticated;
grant execute on function public.crm_noticias_procurar(text, timestamptz, int) to service_role;

-- 4) Código da tarefa automática: gerado aqui e guardado no Vault (não aparece em lado nenhum)
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'debrief_cron') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'debrief_cron', 'Debrief: tarefa de recolha de notícias');
  end if;
end $$;
create or replace function public.crm_cron_ok(t text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'debrief_cron' and decrypted_secret = t)
$$;
revoke execute on function public.crm_cron_ok(text) from public, anon, authenticated;
grant execute on function public.crm_cron_ok(text) to service_role;

-- 5) Tarefas: ler os feeds de hora a hora e limpar notícias com mais de 200 dias
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('debrief-noticias', '17 * * * *', $job$
  select net.http_post(
    url := 'https://uogrldgopqzdicrwcwir.supabase.co/functions/v1/debrief-noticias',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-debrief-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'debrief_cron')),
    body := '{"action":"recolher"}'::jsonb,
    timeout_milliseconds := 90000)
$job$);
select cron.schedule('debrief-noticias-limpeza', '40 3 * * *', $job$
  delete from public.crm_noticias where coalesce(publicado_em, obtido_em) < now() - interval '200 days'
$job$);
