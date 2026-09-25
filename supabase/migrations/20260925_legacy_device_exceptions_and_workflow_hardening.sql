-- Legacy Device-ID exception queue and workflow hardening.

create table if not exists public.legacy_device_exceptions (
  id uuid primary key default gen_random_uuid(),
  module text not null default 'dailyJobDone',
  legacy_source_key text not null unique,
  source_sheet text not null,
  source_row_number integer not null,
  exception_type text not null,
  status text not null default 'Open',
  device_id text,
  completion_date date,
  installer text,
  location text,
  client text,
  vehicle_details text,
  vehicle_make text,
  legacy_status text,
  tss_officer text,
  source_payload jsonb not null default '{}'::jsonb,
  resolution_note text,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legacy_device_exceptions_status_check
    check (status in ('Open','Ignored','Resolved'))
);

create index if not exists legacy_device_exceptions_status_idx
  on public.legacy_device_exceptions(status, created_at desc);

create index if not exists legacy_device_exceptions_type_idx
  on public.legacy_device_exceptions(exception_type, created_at desc);

alter table public.legacy_device_exceptions enable row level security;

drop policy if exists legacy_device_exceptions_select on public.legacy_device_exceptions;
create policy legacy_device_exceptions_select on public.legacy_device_exceptions
for select to authenticated
using (is_super_admin());

drop policy if exists legacy_device_exceptions_insert on public.legacy_device_exceptions;
create policy legacy_device_exceptions_insert on public.legacy_device_exceptions
for insert to authenticated
with check (is_super_admin());

drop policy if exists legacy_device_exceptions_update on public.legacy_device_exceptions;
create policy legacy_device_exceptions_update on public.legacy_device_exceptions
for update to authenticated
using (is_super_admin())
with check (is_super_admin());

drop policy if exists legacy_device_exceptions_delete on public.legacy_device_exceptions;
create policy legacy_device_exceptions_delete on public.legacy_device_exceptions
for delete to authenticated
using (is_super_admin());

-- Remove duplicate copies of the same role-field trigger. The canonical
-- enforce_role_field_permissions_* triggers remain in place.
drop trigger if exists jobs_role_field_permissions on public.jobs;
drop trigger if exists job_completions_role_field_permissions on public.job_completions;
drop trigger if exists stock_transactions_role_field_permissions on public.stock_transactions;

-- Use the Job's configured vehicle count when deciding whether all vehicles
-- are complete. Do not mark a 15-vehicle Job complete merely because the
-- first 2 recorded vehicles are complete.
create or replace function public.field_tech_submit_completion(
  p_job_id uuid,
  p_vehicle_id uuid,
  p_device_id text,
  p_completion_date date default current_date,
  p_installer text default null,
  p_location text default null,
  p_client text default null,
  p_vehicle_details text default null,
  p_vehicle_make text default null,
  p_tss_officer text default null,
  p_remarks text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
  v_vehicle public.vehicles%rowtype;
  v_completion_id uuid;
  v_completed_total integer;
  v_expected integer;
  v_installer text;
  v_client text;
  v_location text;
begin
  if current_app_role() <> 'Field Technician'::app_role then
    raise exception 'Only Field Technicians can submit field completions.';
  end if;

  if nullif(trim(coalesce(p_device_id,'')), '') is null then
    raise exception 'DEVICE ID is required.';
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
    and assigned_technician_id = auth.uid()
  for update;

  if not found then
    raise exception 'This job is not assigned to you.';
  end if;

  select * into v_vehicle
  from public.vehicles
  where id = p_vehicle_id
    and job_id = p_job_id;

  if not found then
    raise exception 'Selected vehicle does not belong to this job.';
  end if;

  select full_name into v_installer
  from public.profiles
  where id = auth.uid();

  select name into v_client
  from public.clients
  where id = v_job.client_id;

  v_client := coalesce(nullif(trim(p_client),''), v_client);
  v_location := coalesce(nullif(trim(p_location),''), v_job.location);
  v_installer := coalesce(nullif(trim(p_installer),''), v_installer);

  insert into public.job_completions(
    job_id, vehicle_id, device_id, completion_date, installer, location,
    client, vehicle_details, vehicle_make, status, tss_officer, remarks
  )
  values (
    p_job_id,
    p_vehicle_id,
    trim(p_device_id),
    coalesce(p_completion_date,current_date),
    v_installer,
    v_location,
    v_client,
    coalesce(nullif(trim(p_vehicle_details),''),v_vehicle.vehicle_details),
    coalesce(nullif(trim(p_vehicle_make),''),v_vehicle.vehicle_make),
    'Completed'::text,
    nullif(trim(p_tss_officer),''),
    nullif(trim(p_remarks),'')
  )
  returning id into v_completion_id;

  update public.vehicles
  set status = 'Completed'
  where id = p_vehicle_id;

  select number_of_vehicles into v_expected
  from public.jobs
  where id = p_job_id;

  select count(distinct vehicle_id) into v_completed_total
  from public.job_completions
  where job_id = p_job_id
    and vehicle_id is not null
    and status = 'Completed';

  update public.jobs
  set status = case
    when v_expected is not null and v_completed_total >= v_expected
      then 'Completed'::record_status
    when v_completed_total > 0
      then 'In Progress'::record_status
    else 'Pending'::record_status
  end,
  updated_at = now()
  where id = p_job_id;

  if v_job.tss_officer_id is not null then
    insert into public.notifications(user_id,title,message,notification_type)
    values (
      v_job.tss_officer_id,
      'Field completion submitted',
      'Operational Job ' || v_job.job_id || ' has a new completion for vehicle ' ||
      coalesce(v_vehicle.registration,'Vehicle') || '.',
      'job_completion'
    );
  end if;

  insert into public.audit_logs(actor_id,action,module,record_id,details)
  values (
    auth.uid(),
    'submit_completion',
    'Daily Job Done',
    v_completion_id::text,
    jsonb_build_object(
      'job_id',v_job.job_id,
      'vehicle_id',p_vehicle_id,
      'device_id',trim(p_device_id)
    )
  );

  return v_completion_id;
end;
$$;

-- Archive the currently imported legacy rows that have no Device ID before
-- removing them from the real completion table. Obvious summary/note rows are
-- retained as Ignored; other rows remain Open for source reconciliation.
insert into public.legacy_device_exceptions(
  module, legacy_source_key, source_sheet, source_row_number,
  exception_type, status, device_id, completion_date, installer, location,
  client, vehicle_details, vehicle_make, legacy_status, tss_officer,
  source_payload
)
select
  'dailyJobDone',
  jc.legacy_source_key,
  split_part(jc.legacy_source_key,'|',3),
  nullif(split_part(jc.legacy_source_key,'|',4),'')::integer,
  case
    when concat_ws(' ',jc.client,jc.installer,jc.location,jc.vehicle_details,jc.vehicle_make)
         ~* '\\b[0-9]+\\s*(JOB|JOBS|JBS)\\b.*(IMPLEMENT|IMPEL|IMLEM)'
      then 'SUMMARY_ROW'
    when concat_ws(' ',jc.client,jc.installer,jc.location,jc.vehicle_details,jc.vehicle_make)
         ~* '(APPEARED ON|CLIENT NAME MISSING)'
      then 'NOTE_ROW'
    else 'MISSING_DEVICE_ID'
  end,
  case
    when concat_ws(' ',jc.client,jc.installer,jc.location,jc.vehicle_details,jc.vehicle_make)
         ~* '(JOBS?|JBS).*(IMPLEMENT|IMPEL|IMLEM)'
         then 'Ignored'
    when concat_ws(' ',jc.client,jc.installer,jc.location,jc.vehicle_details,jc.vehicle_make)
         ~* '(APPEARED ON|CLIENT NAME MISSING)'
         then 'Ignored'
    else 'Open'
  end,
  jc.device_id,
  jc.completion_date,
  jc.installer,
  jc.location,
  jc.client,
  jc.vehicle_details,
  jc.vehicle_make,
  jc.status,
  jc.tss_officer,
  jsonb_build_object(
    'id',jc.id,
    'legacy_source_key',jc.legacy_source_key,
    'completion_date',jc.completion_date,
    'installer',jc.installer,
    'location',jc.location,
    'client',jc.client,
    'vehicle_details',jc.vehicle_details,
    'vehicle_make',jc.vehicle_make,
    'status',jc.status,
    'tss_officer',jc.tss_officer
  )
from public.job_completions jc
where jc.legacy_source_key is not null
  and nullif(trim(coalesce(jc.device_id,'')),'') is null
on conflict (legacy_source_key) do nothing;

delete from public.job_completions
where legacy_source_key is not null
  and nullif(trim(coalesce(device_id,'')),'') is null;

create or replace function public.touch_legacy_device_exception()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.status = 'Resolved' and old.status is distinct from 'Resolved' then
    new.resolved_at := coalesce(new.resolved_at, now());
    new.resolved_by := coalesce(new.resolved_by, auth.uid());
  elsif new.status <> 'Resolved' then
    new.resolved_at := null;
    new.resolved_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists legacy_device_exception_touch on public.legacy_device_exceptions;
create trigger legacy_device_exception_touch
before update on public.legacy_device_exceptions
for each row execute function public.touch_legacy_device_exception();
