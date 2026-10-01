create table if not exists public.cin7_settings (
  singleton boolean primary key default true check (singleton),
  repair_codes text[] not null default array['CA11001', 'CA11002'],
  updated_at timestamptz not null default now(),
  check (array_position(repair_codes, '') is null)
);

alter table public.cin7_settings enable row level security;
revoke all on public.cin7_settings from anon, authenticated;
grant select, insert, update on public.cin7_settings to authenticated;
grant all on public.cin7_settings to service_role;

drop policy if exists "admins read cin7 settings" on public.cin7_settings;
create policy "admins read cin7 settings"
on public.cin7_settings
for select
to authenticated
using (public.is_admin());

drop policy if exists "admins insert cin7 settings" on public.cin7_settings;
create policy "admins insert cin7 settings"
on public.cin7_settings
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "admins update cin7 settings" on public.cin7_settings;
create policy "admins update cin7 settings"
on public.cin7_settings
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

insert into public.cin7_settings (singleton, repair_codes)
values (true, array['CA11001', 'CA11002'])
on conflict (singleton) do nothing;