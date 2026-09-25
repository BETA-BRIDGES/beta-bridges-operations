CREATE OR REPLACE FUNCTION public.assign_job_to_technician(p_job_id uuid, p_technician_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_job public.jobs%rowtype;
  v_tech public.profiles%rowtype;
  v_previous_technician_id uuid;
  v_action text;
BEGIN
  IF current_app_role() <> 'Super Admin'::app_role THEN
    RAISE EXCEPTION 'Only Super Admin can assign technicians.';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operational Job not found.';
  END IF;

  IF v_job.status IN ('Completed'::record_status, 'Cancelled'::record_status) THEN
    RAISE EXCEPTION 'Completed or cancelled jobs cannot be assigned or reassigned.';
  END IF;

  v_previous_technician_id := v_job.assigned_technician_id;

  IF p_technician_id IS NOT NULL THEN
    SELECT * INTO v_tech
    FROM public.profiles
    WHERE id = p_technician_id
      AND role = 'Field Technician'::app_role
      AND active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected technician is not an active Field Technician.';
    END IF;
  END IF;

  IF v_previous_technician_id IS NOT DISTINCT FROM p_technician_id THEN
    RETURN;
  END IF;

  UPDATE public.jobs
  SET assigned_technician_id = p_technician_id,
      status = CASE
        WHEN p_technician_id IS NULL AND status = 'Acknowledged'::record_status THEN 'Pending'::record_status
        WHEN p_technician_id IS NOT NULL AND status = 'Pending'::record_status THEN 'Acknowledged'::record_status
        ELSE status
      END,
      updated_at = now()
  WHERE id = p_job_id;

  IF v_previous_technician_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id,title,message,notification_type)
    VALUES (
      v_previous_technician_id,
      CASE WHEN p_technician_id IS NULL THEN 'Job unassigned' ELSE 'Job reassigned' END,
      CASE
        WHEN p_technician_id IS NULL
          THEN 'Operational Job ' || v_job.job_id || ' is no longer assigned to you.'
        ELSE
          'Operational Job ' || v_job.job_id || ' has been reassigned to another Field Technician.'
      END,
      'job_assignment'
    );
  END IF;

  IF p_technician_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id,title,message,notification_type)
    VALUES (
      p_technician_id,
      CASE WHEN v_previous_technician_id IS NULL THEN 'New job assigned' ELSE 'Job reassigned to you' END,
      'You have been assigned Operational Job ' || v_job.job_id ||
      CASE WHEN v_job.location IS NOT NULL AND v_job.location <> '' THEN ' at ' || v_job.location ELSE '' END || '.',
      'job_assignment'
    );
  END IF;

  v_action := CASE
    WHEN p_technician_id IS NULL THEN 'unassign'
    WHEN v_previous_technician_id IS NULL THEN 'assign'
    ELSE 'reassign'
  END;

  INSERT INTO public.audit_logs(actor_id,action,module,record_id,details)
  VALUES (
    auth.uid(),
    v_action,
    'Daily Job Listing',
    p_job_id::text,
    jsonb_build_object(
      'job_id',v_job.job_id,
      'previous_technician_id',v_previous_technician_id,
      'technician_id',p_technician_id
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.assign_job_to_technician(uuid,uuid) TO authenticated;

CREATE INDEX IF NOT EXISTS jobs_assigned_technician_idx
  ON public.jobs(assigned_technician_id);

CREATE INDEX IF NOT EXISTS jobs_scheduled_date_status_idx
  ON public.jobs(scheduled_date,status);
