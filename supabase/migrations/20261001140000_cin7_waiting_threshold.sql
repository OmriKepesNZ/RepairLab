alter table public.cin7_settings
  add column if not exists waiting_days integer not null default 36 check (waiting_days between 1 and 3650);

drop policy if exists "admins read cin7 settings" on public.cin7_settings;
drop policy if exists "authenticated read cin7 settings" on public.cin7_settings;
create policy "authenticated read cin7 settings"
on public.cin7_settings
for select
to authenticated
using (true);