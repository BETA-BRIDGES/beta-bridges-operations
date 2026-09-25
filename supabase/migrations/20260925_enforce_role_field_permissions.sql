create or replace function public.enforce_role_field_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.app_role;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  r := public.current_app_role();

  if r = 'Super Admin' then
    return new;
  end if;

  if tg_table_name = 'jobs' and r = 'TSS Officer' then
    if new.assigned_technician_id is distinct from old.assigned_technician_id then
      raise exception 'TSS Officer cannot change Techie Assigned on Daily Job Listing';
    end if;
  end if;

  if tg_table_name = 'job_completions' and r = 'Operations' then
    if new.id is distinct from old.id
       or new.job_id is distinct from old.job_id
       or new.vehicle_id is distinct from old.vehicle_id
       or new.device_id is distinct from old.device_id
       or new.completion_date is distinct from old.completion_date
       or new.installer is distinct from old.installer
       or new.location is distinct from old.location
       or new.client is distinct from old.client
       or new.vehicle_details is distinct from old.vehicle_details
       or new.vehicle_make is distinct from old.vehicle_make
       or new.status is distinct from old.status
       or new.tss_officer is distinct from old.tss_officer
       or new.created_at is distinct from old.created_at
       or new.legacy_source_key is distinct from old.legacy_source_key
    then
      raise exception 'Operations may only change Remark on Daily Job Done';
    end if;
  end if;

  if tg_table_name = 'stock_transactions' then
    if r = 'Operations' then
      if new.device_id is distinct from old.device_id
         or new.sim_id is distinct from old.sim_id
         or new.date_issued is distinct from old.date_issued
      then
        raise exception 'Operations cannot change Device ID, SIM ID or Date Issued in Used Stock';
      end if;
    elsif r = 'Finance' then
      if new.id is distinct from old.id
         or new.job_id is distinct from old.job_id
         or new.vehicle_id is distinct from old.vehicle_id
         or new.network is distinct from old.network
         or new.device_type is distinct from old.device_type
         or new.device_status is distinct from old.device_status
         or new.date_collected is distinct from old.date_collected
         or new.operations_remark is distinct from old.operations_remark
         or new.operations_correction is distinct from old.operations_correction
         or new.date_installed is distinct from old.date_installed
         or new.installer is distinct from old.installer
         or new.location is distinct from old.location
         or new.client is distinct from old.client
         or new.vehicle_details is distinct from old.vehicle_details
         or new.vehicle_make is distinct from old.vehicle_make
         or new.other_issues is distinct from old.other_issues
         or new.created_at is distinct from old.created_at
         or new.updated_at is distinct from old.updated_at
         or new.legacy_source_key is distinct from old.legacy_source_key
      then
        raise exception 'Finance may only change Device ID, SIM ID or Date Issued in Used Stock';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_role_field_permissions_jobs on public.jobs;
create trigger enforce_role_field_permissions_jobs
before update on public.jobs
for each row execute function public.enforce_role_field_permissions();

drop trigger if exists enforce_role_field_permissions_completions on public.job_completions;
create trigger enforce_role_field_permissions_completions
before update on public.job_completions
for each row execute function public.enforce_role_field_permissions();

drop trigger if exists enforce_role_field_permissions_stock on public.stock_transactions;
create trigger enforce_role_field_permissions_stock
before update on public.stock_transactions
for each row execute function public.enforce_role_field_permissions();
