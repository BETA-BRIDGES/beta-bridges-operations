create table if not exists technician_weekly_activity(
 id uuid primary key default gen_random_uuid(),
 technician_id uuid not null references profiles(id) on delete cascade,
 week_start date not null,
 projects_completed integer not null default 0,
 vehicles_completed integer not null default 0,
 remarks text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(technician_id,week_start)
);

create table if not exists notifications(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references profiles(id) on delete cascade,
 title text not null,
 message text not null,
 notification_type text not null default 'info',
 related_task_id uuid references tasks(id) on delete set null,
 read_at timestamptz,
 created_at timestamptz not null default now()
);

create index if not exists technician_weekly_activity_tech_week_idx on technician_weekly_activity(technician_id,week_start desc);
create index if not exists notifications_user_created_idx on notifications(user_id,created_at desc);

alter table technician_weekly_activity enable row level security;
alter table notifications enable row level security;

drop policy if exists weekly_select on technician_weekly_activity;
drop policy if exists weekly_write on technician_weekly_activity;
drop policy if exists weekly_update on technician_weekly_activity;
drop policy if exists notifications_select on notifications;
drop policy if exists notifications_update on notifications;

create policy weekly_select on technician_weekly_activity for select to authenticated using (public.is_super_admin() or public.current_app_role() in ('Operations','Viewer') or technician_id=auth.uid());
create policy weekly_write on technician_weekly_activity for insert to authenticated with check (public.current_app_role() in ('Super Admin','Operations'));
create policy weekly_update on technician_weekly_activity for update to authenticated using (public.current_app_role() in ('Super Admin','Operations')) with check (public.current_app_role() in ('Super Admin','Operations'));

create policy notifications_select on notifications for select to authenticated using (user_id=auth.uid() or public.is_super_admin());
create policy notifications_update on notifications for update to authenticated using (user_id=auth.uid() or public.is_super_admin()) with check (user_id=auth.uid() or public.is_super_admin());

drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select to authenticated using (public.is_super_admin() or assigned_to=auth.uid() or public.current_app_role()='Viewer');

create or replace function public.notify_task_assignment() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.assigned_to is not null and (tg_op='INSERT' or new.assigned_to is distinct from old.assigned_to) then
    insert into public.notifications(user_id,title,message,notification_type,related_task_id)
    values(new.assigned_to,'New task assigned',format('You have been assigned: %s',new.title),'task',new.id);
  end if;
  return new;
end $$;

drop trigger if exists task_assignment_notification on tasks;
create trigger task_assignment_notification after insert or update of assigned_to on tasks for each row execute function public.notify_task_assignment();

revoke execute on function public.notify_task_assignment() from public;
revoke execute on function public.enforce_field_restrictions() from public;
revoke execute on function public.bootstrap_first_super_admin(text,text) from anon;
revoke execute on function public.current_app_role() from anon;
revoke execute on function public.is_super_admin() from anon;
