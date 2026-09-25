-- Enforce Viewer module access and prevent non-technicians from directly updating tasks.

drop policy if exists tasks_select on public.tasks;
create policy tasks_select
  on public.tasks
  for select
  to authenticated
  using (
    public.is_super_admin()
    or (assigned_to = auth.uid() and public.current_app_role() = 'Field Technician'::app_role)
    or (
      public.current_app_role() = 'Viewer'::app_role
      and exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and (p.module_access is null or 'Tasks'::text = any(p.module_access))
      )
    )
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update
  on public.tasks
  for update
  to authenticated
  using (
    public.is_super_admin()
    or (assigned_to = auth.uid() and public.current_app_role() = 'Field Technician'::app_role)
  )
  with check (
    public.is_super_admin()
    or (assigned_to = auth.uid() and public.current_app_role() = 'Field Technician'::app_role)
  );

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select
  on public.task_comments
  for select
  to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1
      from public.tasks t
      where t.id = task_comments.task_id
        and t.assigned_to = auth.uid()
        and public.current_app_role() = 'Field Technician'::app_role
    )
    or (
      public.current_app_role() = 'Viewer'::app_role
      and exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and (p.module_access is null or 'Tasks'::text = any(p.module_access))
      )
    )
  );

drop policy if exists weekly_select on public.technician_weekly_activity;
create policy weekly_select
  on public.technician_weekly_activity
  for select
  to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() = 'Operations'::app_role
    or (
      public.current_app_role() = 'Field Technician'::app_role
      and technician_id = auth.uid()
    )
    or (
      public.current_app_role() = 'Viewer'::app_role
      and exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and (p.module_access is null or 'Techie Weekly Activity'::text = any(p.module_access))
      )
    )
  );
