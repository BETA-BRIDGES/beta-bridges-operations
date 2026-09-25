-- Each Job assignment owns one Technician Task.
-- Assignment remains authoritative for who receives the job; the linked task
-- becomes the technician's actionable workspace item.

CREATE OR REPLACE FUNCTION public.assign_job_to_technician(p_job_id uuid, p_technician_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_job public.jobs%rowtype;
  v_tech public.profiles%rowtype;
  v_previous_technician_id uuid;
  v_previous_task_assignee uuid;
  v_task_id uuid;
  v_task_status public.record_status;
  v_action text;
  v_client_name text;
  v_due_at timestamptz;
  v_next_task_number integer;
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

  SELECT c.name INTO v_client_name
  FROM public.clients c
  WHERE c.id = v_job.client_id;

  v_due_at := CASE
    WHEN v_job.scheduled_date IS NULL THEN NULL
    ELSE (v_job.scheduled_date + COALESCE(v_job.scheduled_time, time '17:00'))::timestamp
         AT TIME ZONE current_setting('TIMEZONE')
  END;

  UPDATE public.jobs
  SET assigned_technician_id = p_technician_id,
      status = CASE
        WHEN p_technician_id IS NULL AND status = 'Acknowledged'::record_status THEN 'Pending'::record_status
        WHEN p_technician_id IS NOT NULL AND status = 'Pending'::record_status THEN 'Acknowledged'::record_status
        ELSE status
      END,
      updated_at = now()
  WHERE id = p_job_id;

  SELECT id, assigned_to, status
  INTO v_task_id, v_previous_task_assignee, v_task_status
  FROM public.tasks
  WHERE related_job_id = p_job_id
  FOR UPDATE;

  IF p_technician_id IS NULL THEN
    IF v_task_id IS NOT NULL THEN
      UPDATE public.tasks
      SET assigned_to = NULL,
          status = CASE
            WHEN status IN ('Completed'::record_status, 'Cancelled'::record_status) THEN status
            ELSE 'Pending'::record_status
          END,
          completed_at = CASE
            WHEN status = 'Completed'::record_status THEN completed_at
            ELSE NULL
          END,
          updated_at = now()
      WHERE id = v_task_id;
    END IF;
  ELSE
    IF v_task_id IS NULL THEN
      PERFORM pg_advisory_xact_lock(41025001);

      SELECT COALESCE(MAX((substring(task_id from 6))::integer), 0) + 1
      INTO v_next_task_number
      FROM public.tasks
      WHERE task_id ~ '^TASK-[0-9]+$';

      INSERT INTO public.tasks(
        task_id, title, description, assigned_to, created_by,
        department, priority, due_at, status, related_job_id
      )
      VALUES(
        'TASK-' || lpad(v_next_task_number::text, 3, '0'),
        'Technician Job: ' || v_job.job_id,
        concat_ws(
          E'\n',
          CASE WHEN v_client_name IS NOT NULL THEN 'Client: ' || v_client_name END,
          CASE WHEN v_job.location IS NOT NULL AND v_job.location <> '' THEN 'Location: ' || v_job.location END,
          'Vehicles: ' || COALESCE(v_job.number_of_vehicles, 1)::text,
          CASE WHEN v_job.description IS NOT NULL AND v_job.description <> '' THEN 'Instructions: ' || v_job.description END
        ),
        p_technician_id,
        auth.uid(),
        'Field Operations',
        COALESCE(v_job.priority, 'Normal'),
        v_due_at,
        'Pending'::record_status,
        p_job_id
      )
      RETURNING id INTO v_task_id;
    ELSE
      UPDATE public.tasks
      SET assigned_to = p_technician_id,
          status = CASE
            WHEN status IN ('Completed'::record_status, 'Cancelled'::record_status) THEN status
            WHEN v_previous_task_assignee IS DISTINCT FROM p_technician_id THEN 'Pending'::record_status
            ELSE status
          END,
          completed_at = CASE
            WHEN status = 'Completed'::record_status
                 AND v_previous_task_assignee IS NOT DISTINCT FROM p_technician_id
              THEN completed_at
            ELSE NULL
          END,
          due_at = COALESCE(due_at, v_due_at),
          updated_at = now()
      WHERE id = v_task_id;
    END IF;
  END IF;

  IF v_previous_technician_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id,title,message,notification_type,related_task_id)
    VALUES (
      v_previous_technician_id,
      CASE WHEN p_technician_id IS NULL THEN 'Job unassigned' ELSE 'Job reassigned' END,
      CASE
        WHEN p_technician_id IS NULL THEN 'Operational Job ' || v_job.job_id || ' is no longer assigned to you.'
        ELSE 'Operational Job ' || v_job.job_id || ' has been reassigned to another Field Technician.'
      END,
      'job_assignment',
      v_task_id
    );
  END IF;

  IF p_technician_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id,title,message,notification_type,related_task_id)
    VALUES (
      p_technician_id,
      CASE WHEN v_previous_technician_id IS NULL THEN 'New job assigned' ELSE 'Job reassigned to you' END,
      'Operational Job ' || v_job.job_id || ' is ready in your Technician Tasks workspace' ||
      CASE WHEN v_job.location IS NOT NULL AND v_job.location <> '' THEN ' for ' || v_job.location ELSE '' END || '.',
      'job_assignment',
      v_task_id
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
      'technician_id',p_technician_id,
      'task_id',v_task_id
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.assign_job_to_technician(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_task_field_restrictions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  IF public.current_app_role()='Field Technician'::public.app_role THEN
    IF NEW.title IS DISTINCT FROM OLD.title
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.department IS DISTINCT FROM OLD.department
      OR NEW.priority IS DISTINCT FROM OLD.priority
      OR NEW.due_at IS DISTINCT FROM OLD.due_at
      OR NEW.task_id IS DISTINCT FROM OLD.task_id
      OR NEW.related_job_id IS DISTINCT FROM OLD.related_job_id
    THEN
      RAISE EXCEPTION 'Field Technician may only update task status';
    END IF;

    IF OLD.status='Pending'::public.record_status
       AND NEW.status NOT IN ('Acknowledged'::public.record_status,'Cancelled'::public.record_status)
    THEN
      RAISE EXCEPTION 'Task must be acknowledged before it can be started';
    END IF;

    IF OLD.status='Acknowledged'::public.record_status
       AND NEW.status NOT IN ('In Progress'::public.record_status,'Cancelled'::public.record_status)
    THEN
      RAISE EXCEPTION 'Acknowledged task must be started or cancelled';
    END IF;

    IF OLD.status='In Progress'::public.record_status
       AND NEW.status NOT IN ('Completed'::public.record_status,'Cancelled'::public.record_status)
    THEN
      RAISE EXCEPTION 'In-progress task must be completed or cancelled';
    END IF;

    IF OLD.status='Completed'::public.record_status
       AND NEW.status IS DISTINCT FROM OLD.status
    THEN
      RAISE EXCEPTION 'Completed task cannot be reopened by a Field Technician';
    END IF;

    IF NEW.status='Completed'::public.record_status AND OLD.status<>'Completed'::public.record_status THEN
      IF NEW.completed_at IS NULL THEN NEW.completed_at:=now(); END IF;
    ELSIF NEW.status<>'Completed'::public.record_status THEN
      NEW.completed_at:=NULL;
    END IF;

    IF NEW.related_job_id IS NOT NULL AND NEW.status='In Progress'::public.record_status THEN
      UPDATE public.jobs
      SET status=CASE
        WHEN status IN ('Pending'::public.record_status,'Acknowledged'::public.record_status)
          THEN 'In Progress'::public.record_status
        ELSE status
      END,
      updated_at=now()
      WHERE id=NEW.related_job_id
        AND assigned_technician_id=auth.uid()
        AND status NOT IN ('Completed'::public.record_status,'Cancelled'::public.record_status);
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS task_field_restrictions ON public.tasks;
CREATE TRIGGER task_field_restrictions
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.enforce_task_field_restrictions();
