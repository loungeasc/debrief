-- Debrief · base de dados partilhada no Supabase do Portal do Lounge
-- Correr uma vez no SQL Editor do projeto "Gestão de Stocks". Só ADICIONA objetos; não altera nada do Portal.

create table if not exists public.crm_registos (
  id text not null,
  tipo text not null check (tipo in ('meeting','contact','photo','settings')),
  dados jsonb not null default '{}'::jsonb,
  apagado boolean not null default false,
  atualizado_cliente bigint not null default 0,
  atualizado_em timestamptz not null default clock_timestamp(),
  atualizado_por uuid default auth.uid(),
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  primary key (tipo, id)
);
create index if not exists crm_registos_atualizado_em_idx on public.crm_registos (atualizado_em);

create or replace function public.crm_tem_acesso()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.permissoes_utilizador
    where user_id = auth.uid() and seccao = 'reunioes_companhias' and permitido
  );
$$;
revoke all on function public.crm_tem_acesso() from public, anon;
grant execute on function public.crm_tem_acesso() to authenticated;

create or replace function public.crm_registos_guarda()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.atualizado_cliente < old.atualizado_cliente then
      return old; -- chegou uma versão mais antiga: mantém a atual
    end if;
    new.criado_por := old.criado_por;
    new.criado_em := old.criado_em;
  end if;
  new.atualizado_em := clock_timestamp();
  new.atualizado_por := auth.uid();
  return new;
end $$;

drop trigger if exists crm_registos_guarda on public.crm_registos;
create trigger crm_registos_guarda before insert or update on public.crm_registos
  for each row execute function public.crm_registos_guarda();

alter table public.crm_registos enable row level security;
revoke all on public.crm_registos from anon;
create policy crm_select on public.crm_registos for select to authenticated using (public.crm_tem_acesso());
create policy crm_insert on public.crm_registos for insert to authenticated with check (public.crm_tem_acesso());
create policy crm_update on public.crm_registos for update to authenticated using (public.crm_tem_acesso()) with check (public.crm_tem_acesso());
-- Sem política de DELETE: apagar = marcar como apagado.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crm-fotos', 'crm-fotos', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

create policy crm_fotos_select on storage.objects for select to authenticated
  using (bucket_id = 'crm-fotos' and public.crm_tem_acesso());
create policy crm_fotos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'crm-fotos' and public.crm_tem_acesso());
create policy crm_fotos_update on storage.objects for update to authenticated
  using (bucket_id = 'crm-fotos' and public.crm_tem_acesso())
  with check (bucket_id = 'crm-fotos' and public.crm_tem_acesso());
create policy crm_fotos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'crm-fotos' and public.crm_tem_acesso());

alter publication supabase_realtime add table public.crm_registos;
