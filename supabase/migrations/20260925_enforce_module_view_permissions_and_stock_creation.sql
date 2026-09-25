create or replace function public.viewer_has_module(p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.role = 'Viewer'::app_role
      and (p.module_access is null or p_module = any(p.module_access))
  );
$$;

drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
for select to authenticated
using (
  is_super_admin()
  or current_app_role() = 'TSS Officer'::app_role
  or (
    current_app_role() = 'Finance'::app_role
    and exists (
      select 1 from public.miscellaneous_charges c
      where c.client_id = clients.id
    )
  )
  or (
    current_app_role() = 'Field Technician'::app_role
    and exists (
      select 1 from public.jobs j
      where j.client_id = clients.id
    )
  )
  or viewer_has_module('Client Data')
  or (
    viewer_has_module('Daily Job Listing')
    and exists (
      select 1 from public.jobs j
      where j.client_id = clients.id
    )
  )
  or (
    viewer_has_module('Miscellaneous Charges')
    and exists (
      select 1 from public.miscellaneous_charges c
      where c.client_id = clients.id
    )
  )
);

drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs
for select to authenticated
using (
  is_super_admin()
  or current_app_role() in ('TSS Officer'::app_role, 'Field Technician'::app_role)
  or viewer_has_module('Daily Job Listing')
);

drop policy if exists completions_select on public.job_completions;
create policy completions_select on public.job_completions
for select to authenticated
using (
  is_super_admin()
  or current_app_role() in ('Operations'::app_role, 'TSS Officer'::app_role)
  or viewer_has_module('Daily Job Done')
);

drop policy if exists stock_select on public.stock_transactions;
create policy stock_select on public.stock_transactions
for select to authenticated
using (
  is_super_admin()
  or current_app_role() in ('Operations'::app_role, 'Finance'::app_role)
  or viewer_has_module('Used Stock')
);

drop policy if exists weekly_select on public.technician_weekly_activity;
create policy weekly_select on public.technician_weekly_activity
for select to authenticated
using (
  is_super_admin()
  or current_app_role() = 'Operations'::app_role
  or current_app_role() = 'Field Technician'::app_role and technician_id = auth.uid()
  or viewer_has_module('Techie Weekly Activity')
);

drop policy if exists charges_select on public.miscellaneous_charges;
create policy charges_select on public.miscellaneous_charges
for select to authenticated
using (
  is_super_admin()
  or current_app_role() in ('TSS Officer'::app_role, 'Finance'::app_role)
  or viewer_has_module('Miscellaneous Charges')
);

drop policy if exists vehicles_select on public.vehicles;
create policy vehicles_select on public.vehicles
for select to authenticated
using (
  is_super_admin()
  or current_app_role() in ('TSS Officer'::app_role, 'Field Technician'::app_role)
  or viewer_has_module('Daily Job Listing')
);

drop policy if exists stock_insert on public.stock_transactions;
create policy stock_insert on public.stock_transactions
for insert to authenticated
with check (is_super_admin());
