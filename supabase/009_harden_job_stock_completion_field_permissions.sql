-- Harden role-level field permissions at the database layer.
-- UI permissions remain a convenience; these triggers enforce the same restrictions
-- for direct Supabase/API updates.

CREATE OR REPLACE FUNCTION public.enforce_role_field_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role_name app_role := current_app_role();
BEGIN
  IF role_name IS NULL OR role_name = 'Super Admin'::app_role THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME IN ('jobs','job_completions','stock_transactions') THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'System-managed fields cannot be changed.';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'jobs' AND role_name = 'TSS Officer'::app_role THEN
    IF NEW.job_id IS DISTINCT FROM OLD.job_id
       OR NEW.legacy_source_key IS DISTINCT FROM OLD.legacy_source_key
       OR NEW.legacy_client_name IS DISTINCT FROM OLD.legacy_client_name
       OR NEW.assigned_technician_id IS DISTINCT FROM OLD.assigned_technician_id THEN
      RAISE EXCEPTION 'TSS Officer cannot change Job ID, legacy source fields, or Techie Assigned.';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'job_completions' AND role_name = 'Operations'::app_role THEN
    IF NEW.job_id IS DISTINCT FROM OLD.job_id
       OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
       OR NEW.device_id IS DISTINCT FROM OLD.device_id
       OR NEW.completion_date IS DISTINCT FROM OLD.completion_date
       OR NEW.installer IS DISTINCT FROM OLD.installer
       OR NEW.location IS DISTINCT FROM OLD.location
       OR NEW.client IS DISTINCT FROM OLD.client
       OR NEW.vehicle_details IS DISTINCT FROM OLD.vehicle_details
       OR NEW.vehicle_make IS DISTINCT FROM OLD.vehicle_make
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.tss_officer IS DISTINCT FROM OLD.tss_officer
       OR NEW.legacy_source_key IS DISTINCT FROM OLD.legacy_source_key THEN
      RAISE EXCEPTION 'Operations may only add or change the Daily Job Done remark.';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'stock_transactions' AND role_name = 'Finance'::app_role THEN
    IF NEW.legacy_source_key IS DISTINCT FROM OLD.legacy_source_key
       OR NEW.network IS DISTINCT FROM OLD.network
       OR NEW.device_type IS DISTINCT FROM OLD.device_type
       OR NEW.device_status IS DISTINCT FROM OLD.device_status
       OR NEW.date_collected IS DISTINCT FROM OLD.date_collected
       OR NEW.operations_remark IS DISTINCT FROM OLD.operations_remark
       OR NEW.operations_correction IS DISTINCT FROM OLD.operations_correction
       OR NEW.date_installed IS DISTINCT FROM OLD.date_installed
       OR NEW.installer IS DISTINCT FROM OLD.installer
       OR NEW.location IS DISTINCT FROM OLD.location
       OR NEW.client IS DISTINCT FROM OLD.client
       OR NEW.vehicle_details IS DISTINCT FROM OLD.vehicle_details
       OR NEW.vehicle_make IS DISTINCT FROM OLD.vehicle_make
       OR NEW.other_issues IS DISTINCT FROM OLD.other_issues THEN
      RAISE EXCEPTION 'Finance may only change Device ID, SIM ID, and Date Issued.';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'stock_transactions' AND role_name = 'Operations'::app_role THEN
    IF NEW.legacy_source_key IS DISTINCT FROM OLD.legacy_source_key
       OR NEW.device_id IS DISTINCT FROM OLD.device_id
       OR NEW.sim_id IS DISTINCT FROM OLD.sim_id
       OR NEW.date_issued IS DISTINCT FROM OLD.date_issued THEN
      RAISE EXCEPTION 'Operations cannot change Device ID, SIM ID, Date Issued, or system source fields.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_role_field_permissions ON public.jobs;
CREATE TRIGGER jobs_role_field_permissions
BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.enforce_role_field_permissions();

DROP TRIGGER IF EXISTS job_completions_role_field_permissions ON public.job_completions;
CREATE TRIGGER job_completions_role_field_permissions
BEFORE UPDATE ON public.job_completions
FOR EACH ROW EXECUTE FUNCTION public.enforce_role_field_permissions();

DROP TRIGGER IF EXISTS stock_transactions_role_field_permissions ON public.stock_transactions;
CREATE TRIGGER stock_transactions_role_field_permissions
BEFORE UPDATE ON public.stock_transactions
FOR EACH ROW EXECUTE FUNCTION public.enforce_role_field_permissions();

DROP TRIGGER IF EXISTS tasks_role_field_permissions ON public.tasks;
