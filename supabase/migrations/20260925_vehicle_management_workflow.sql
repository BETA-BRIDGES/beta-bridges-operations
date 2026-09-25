-- Vehicle Management module access and per-job registration integrity.
drop policy if exists vehicles_select on public.vehicles;
create policy vehicles_select on public.vehicles
for select to authenticated
using (
  is_super_admin()
  or current_app_role() in ('Operations'::public.app_role, 'TSS Officer'::public.app_role)
  or (
    current_app_role() = 'Field Technician'::public.app_role
    and exists (
      select 1
      from public.jobs j
      where j.id = vehicles.job_id
        and j.assigned_technician_id = auth.uid()
    )
  )
  or viewer_has_module('Vehicle Management')
  or viewer_has_module('Daily Job Listing')
);

create unique index if not exists vehicles_job_registration_unique
on public.vehicles(job_id, registration)
where registration is not null and trim(registration) <> '';