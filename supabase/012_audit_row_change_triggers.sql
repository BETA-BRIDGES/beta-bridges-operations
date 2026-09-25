-- Central audit trail for operational changes.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  actor uuid := auth.uid();
  actor_role text := public.current_app_role()::text;
  old_json jsonb;
  new_json jsonb;
  changed jsonb;
  record_uuid text;
begin
  if tg_op = 'INSERT' then
    new_json := to_jsonb(new);
    record_uuid := coalesce(new.id::text, null);
    insert into public.audit_logs(actor_id, action, module, record_id, details)
    values(
      actor,
      'INSERT',
      replace(initcap(replace(tg_table_name,'_',' ')),'Id','ID'),
      record_uuid,
      jsonb_build_object(
        'table', tg_table_name,
        'role', actor_role,
        'record', new_json
      )
    );
    return new;
  elsif tg_op = 'DELETE' then
    old_json := to_jsonb(old);
    record_uuid := coalesce(old.id::text, null);
    insert into public.audit_logs(actor_id, action, module, record_id, details)
    values(
      actor,
      'DELETE',
      replace(initcap(replace(tg_table_name,'_',' ')),'Id','ID'),
      record_uuid,
      jsonb_build_object(
        'table', tg_table_name,
        'role', actor_role,
        'record', old_json
      )
    );
    return old;
  else
    old_json := to_jsonb(old);
    new_json := to_jsonb(new);
    select coalesce(
      jsonb_object_agg(
        key,
        jsonb_build_object('old', old_json->key, 'new', new_json->key)
      ),
      '{}'::jsonb
    )
    into changed
    from jsonb_object_keys(old_json || new_json) as key
    where (old_json->key) is distinct from (new_json->key);

    record_uuid := coalesce(new.id::text, old.id::text, null);
    insert into public.audit_logs(actor_id, action, module, record_id, details)
    values(
      actor,
      'UPDATE',
      replace(initcap(replace(tg_table_name,'_',' ')),'Id','ID'),
      record_uuid,
      jsonb_build_object(
        'table', tg_table_name,
        'role', actor_role,
        'changed_fields', changed
      )
    );
    return new;
  end if;
end
$$;

drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles after insert or update or delete on public.profiles
for each row execute function public.audit_row_change();

drop trigger if exists audit_clients on public.clients;
create trigger audit_clients after insert or update or delete on public.clients
for each row execute function public.audit_row_change();

drop trigger if exists audit_jobs on public.jobs;
create trigger audit_jobs after insert or update or delete on public.jobs
for each row execute function public.audit_row_change();

drop trigger if exists audit_vehicles on public.vehicles;
create trigger audit_vehicles after insert or update or delete on public.vehicles
for each row execute function public.audit_row_change();

drop trigger if exists audit_job_completions on public.job_completions;
create trigger audit_job_completions after insert or update or delete on public.job_completions
for each row execute function public.audit_row_change();

drop trigger if exists audit_stock_transactions on public.stock_transactions;
create trigger audit_stock_transactions after insert or update or delete on public.stock_transactions
for each row execute function public.audit_row_change();

drop trigger if exists audit_miscellaneous_charges on public.miscellaneous_charges;
create trigger audit_miscellaneous_charges after insert or update or delete on public.miscellaneous_charges
for each row execute function public.audit_row_change();

drop trigger if exists audit_weekly_activity on public.technician_weekly_activity;
create trigger audit_weekly_activity after insert or update or delete on public.technician_weekly_activity
for each row execute function public.audit_row_change();

drop trigger if exists audit_tasks on public.tasks;
create trigger audit_tasks after insert or update or delete on public.tasks
for each row execute function public.audit_row_change();

drop trigger if exists audit_task_comments on public.task_comments;
create trigger audit_task_comments after insert or update or delete on public.task_comments
for each row execute function public.audit_row_change();

drop trigger if exists audit_reminders on public.reminders;
create trigger audit_reminders after insert or update or delete on public.reminders
for each row execute function public.audit_row_change();

drop trigger if exists audit_notifications on public.notifications;
create trigger audit_notifications after insert or update or delete on public.notifications
for each row execute function public.audit_row_change();

drop trigger if exists audit_google_connections on public.google_connections;
create trigger audit_google_connections after insert or update or delete on public.google_connections
for each row execute function public.audit_row_change();

revoke execute on function public.audit_row_change() from public;
grant execute on function public.audit_row_change() to authenticated;

create index if not exists audit_logs_module_created_idx
  on public.audit_logs(module, created_at desc);
create index if not exists audit_logs_actor_created_idx
  on public.audit_logs(actor_id, created_at desc);
