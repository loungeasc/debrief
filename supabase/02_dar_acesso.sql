-- Dar acesso às reuniões a uma conta do Portal (repetir para cada pessoa).
-- Troca o email e corre no SQL Editor.
insert into public.permissoes_utilizador (user_id, seccao, permitido, nota)
select u.id, 'reunioes_companhias', true, 'Debrief'
from auth.users u
where u.email = 'EMAIL@AQUI'
  and not exists (
    select 1 from public.permissoes_utilizador p
    where p.user_id = u.id and p.seccao = 'reunioes_companhias'
  );

-- Para retirar o acesso:
-- update public.permissoes_utilizador set permitido = false
-- where seccao = 'reunioes_companhias' and user_id = (select id from auth.users where email = 'EMAIL@AQUI');
