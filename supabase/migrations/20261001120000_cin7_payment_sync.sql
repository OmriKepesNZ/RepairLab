do $$
declare
  payment_status_attnum smallint;
  old_constraint record;
begin
  select attnum into payment_status_attnum
  from pg_attribute
  where attrelid = 'public.repairs'::regclass
    and attname = 'payment_status'
    and not attisdropped;

  if payment_status_attnum is null then
    raise exception 'public.repairs.payment_status was not found';
  end if;

  for old_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.repairs'::regclass
      and contype = 'c'
      and conkey = array[payment_status_attnum]
      and pg_get_constraintdef(oid) ilike '%unpaid%'
      and pg_get_constraintdef(oid) ilike '%paid%'
      and pg_get_constraintdef(oid) ilike '%waived%'
      and pg_get_constraintdef(oid) not ilike '%partial%'
  loop
    execute format('alter table public.repairs drop constraint %I', old_constraint.conname);
  end loop;
end
$$;

do $$
declare
  payment_status_attnum smallint;
begin
  select attnum into payment_status_attnum
  from pg_attribute
  where attrelid = 'public.repairs'::regclass
    and attname = 'payment_status'
    and not attisdropped;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.repairs'::regclass
      and contype = 'c'
      and conkey @> array[payment_status_attnum]
      and pg_get_constraintdef(oid) ilike '%payment_status%'
      and pg_get_constraintdef(oid) ilike '%unpaid%'
      and pg_get_constraintdef(oid) ilike '%paid%'
      and pg_get_constraintdef(oid) ilike '%waived%'
      and pg_get_constraintdef(oid) not ilike '%partial%'
  ) then
    raise exception 'A legacy payment_status constraint remains; inspect public.repairs before applying Partial';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.repairs'::regclass
      and conname = 'repairs_payment_status_check'
  ) then
    alter table public.repairs
      add constraint repairs_payment_status_check
      check (payment_status in ('Unpaid', 'Partial', 'Paid', 'Waived'));
  end if;
end
$$;

create table if not exists public.cin7_payment_sync_state (
  singleton boolean primary key default true check (singleton),
  batch_offset integer not null default 0 check (batch_offset >= 0),
  updated_at timestamptz not null default now()
);

alter table public.cin7_payment_sync_state enable row level security;
revoke all on public.cin7_payment_sync_state from anon, authenticated;
grant all on public.cin7_payment_sync_state to service_role;

insert into public.cin7_payment_sync_state (singleton, batch_offset)
values (true, 0)
on conflict (singleton) do nothing;

create or replace function public.sync_cin7_payment_status(p_repair_id text, p_payment_status text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  repair_row public.repairs%rowtype;
begin
  if p_payment_status not in ('Unpaid', 'Partial', 'Paid', 'Waived') then
    raise exception 'Invalid payment status';
  end if;

  select * into repair_row
  from public.repairs
  where id::text = p_repair_id
  for update;

  if not found or repair_row.payment_status is not distinct from p_payment_status then
    return false;
  end if;

  update public.repairs
  set payment_status = p_payment_status
  where id = repair_row.id;

  insert into public.repair_events (repair_id, type, text, by_name, source)
  values (
    repair_row.id,
    'event',
    format('Payment: %s -> %s (Cin7 Omni)', coalesce(repair_row.payment_status, '-'), p_payment_status),
    'Cin7 Omni',
    'cin7-omni'
  );

  return true;
end
$$;

revoke all on function public.sync_cin7_payment_status(text, text) from public;
grant execute on function public.sync_cin7_payment_status(text, text) to service_role;

create or replace function public.prevent_manual_cin7_payment_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.cin7_key is not null and current_user <> 'service_role' then
      raise exception 'Only the Cin7 sync can create Cin7-linked repairs';
    end if;
    return new;
  end if;

  if current_user <> 'service_role'
    and (
      new.cin7_key is distinct from old.cin7_key
      or (old.cin7_key is not null and new.payment_status is distinct from old.payment_status)
    ) then
    raise exception 'Cin7-linked payment status and link are managed by Cin7 Omni';
  end if;

  return new;
end
$$;

revoke all on function public.prevent_manual_cin7_payment_change() from public;

drop trigger if exists prevent_manual_cin7_payment_change on public.repairs;
create trigger prevent_manual_cin7_payment_change
before update of payment_status, cin7_key on public.repairs
for each row
execute function public.prevent_manual_cin7_payment_change();

drop trigger if exists prevent_manual_cin7_link_insert on public.repairs;
create trigger prevent_manual_cin7_link_insert
before insert on public.repairs
for each row
execute function public.prevent_manual_cin7_payment_change();