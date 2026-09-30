create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('staff', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;
revoke all on public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "users read own role" on public.user_roles;
create policy "users read own role"
on public.user_roles
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "staff insert custom products" on public.products;
create policy "staff insert custom products"
on public.products
for insert
to authenticated
with check (
  code like 'CUSTOM-%'
  and nullif(btrim(label), '') is not null
  and nullif(btrim(category), '') is not null
  and exists (
    select 1
    from public.product_categories pc
    where pc.category = products.category
  )
);

drop policy if exists "admins update custom products" on public.products;
create policy "admins update custom products"
on public.products
for update
to authenticated
using (public.is_admin() and code like 'CUSTOM-%')
with check (
  public.is_admin()
  and code like 'CUSTOM-%'
  and nullif(btrim(label), '') is not null
  and exists (
    select 1
    from public.product_categories pc
    where pc.category = products.category
  )
);

drop policy if exists "admins delete custom products" on public.products;
create policy "admins delete custom products"
on public.products
for delete
to authenticated
using (public.is_admin() and code like 'CUSTOM-%');

-- After applying this migration, bootstrap the first admin for an existing auth user:
-- insert into public.user_roles (user_id, role)
-- select id, 'admin' from auth.users where lower(email) = lower('ADMIN_EMAIL_HERE')
-- on conflict (user_id) do update set role = excluded.role;