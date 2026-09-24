-- Field Technicians may update task status only and may comment only on
-- tasks assigned to themselves.
create or replace function public.enforce_task_field_restrictions()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if public.current_app_role()='Field Technician' then
    if new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.assigned_to is distinct from old.assigned_to
       or new.created_by is distinct from old.created_by
       or new.department is distinct from old.department
       or new.priority is distinct from old.priority
       or new.due_at is distinct from old.due_at
       or new.task_id is distinct from old.task_id
    then
      raise exception 'Field Technician may only update task status';
    end if;

    if new.status='Completed' and old.status<>'Completed' then
      if new.completed_at is null then
        new.completed_at := now();
      end if;
    elsif new.status<>'Completed' then
      new.completed_at := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists task_field_restrictions on public.tasks;
create trigger task_field_restrictions
before update on public.tasks
for each row execute function public.enforce_task_field_restrictions();

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select
  on public.task_comments
  for select
  to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role()='Viewer'
    or exists (
      select 1 from public.tasks t
      where t.id = task_comments.task_id
        and t.assigned_to = auth.uid()
    )
  );

drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert
  on public.task_comments
  for insert
  to authenticated
  with check (
    public.is_super_admin()
    or (
      user_id = auth.uid()
      and public.current_app_role()='Field Technician'
      and exists (
        select 1 from public.tasks t
        where t.id = task_comments.task_id
          and t.assigned_to = auth.uid()
      )
    )
  );
