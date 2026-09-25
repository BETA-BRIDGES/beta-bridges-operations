-- Task acknowledgement, reminder delivery and end-to-end job workflow integrity.

ALTER TYPE public.record_status ADD VALUE IF NOT EXISTS 'Acknowledged' AFTER 'Pending';

CREATE OR REPLACE FUNCTION public.deliver_due_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.reminders%ROWTYPE; delivered integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  FOR r IN SELECT rr.* FROM public.reminders AS rr WHERE rr.user_id=auth.uid() AND rr.sent_at IS NULL AND rr.remind_at<=now() ORDER BY rr.remind_at FOR UPDATE SKIP LOCKED LOOP
    INSERT INTO public.notifications(user_id,title,message,notification_type,related_task_id)
    VALUES(r.user_id,'Reminder: '||r.title,COALESCE(NULLIF(r.details,''),'Scheduled reminder'),'reminder',NULL);
    UPDATE public.reminders SET sent_at=now() WHERE id=r.id AND sent_at IS NULL;
    delivered:=delivered+1;
  END LOOP;
  RETURN delivered;
END $$;

CREATE OR REPLACE FUNCTION public.deliver_reminder_now(p_reminder_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.reminders%ROWTYPE;
BEGIN
  IF public.current_app_role()<>'Super Admin'::public.app_role THEN RAISE EXCEPTION 'Only Super Admin can deliver reminders immediately'; END IF;
  SELECT * INTO r FROM public.reminders WHERE id=p_reminder_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reminder not found'; END IF;
  IF r.user_id IS NULL THEN RAISE EXCEPTION 'Reminder has no targeted user'; END IF;
  IF r.sent_at IS NOT NULL THEN RETURN false; END IF;
  INSERT INTO public.notifications(user_id,title,message,notification_type,related_task_id)
  VALUES(r.user_id,'Reminder: '||r.title,COALESCE(NULLIF(r.details,''),'Scheduled reminder'),'reminder',NULL);
  UPDATE public.reminders SET sent_at=now() WHERE id=r.id;
  RETURN true;
END $$;

GRANT EXECUTE ON FUNCTION public.deliver_due_reminders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_reminder_now(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_workflow_links()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE vehicle_job uuid;
BEGIN
  IF NEW.job_id IS NOT NULL OR NEW.vehicle_id IS NOT NULL THEN
    IF NEW.job_id IS NULL OR NEW.vehicle_id IS NULL THEN RAISE EXCEPTION 'Job and Vehicle must be linked together'; END IF;
    SELECT job_id INTO vehicle_job FROM public.vehicles WHERE id=NEW.vehicle_id;
    IF vehicle_job IS NULL OR vehicle_job<>NEW.job_id THEN RAISE EXCEPTION 'Selected Vehicle does not belong to the selected Job'; END IF;
  END IF;
  IF TG_TABLE_NAME='job_completions' AND NEW.legacy_source_key IS NULL THEN
    IF NEW.job_id IS NULL OR NEW.vehicle_id IS NULL THEN RAISE EXCEPTION 'A new Daily Job Done record must be linked to a Job and Vehicle'; END IF;
    IF NULLIF(trim(COALESCE(NEW.device_id,'')),'') IS NULL THEN RAISE EXCEPTION 'DEVICE ID is required for a new Daily Job Done record'; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS workflow_links_job_completions ON public.job_completions;
CREATE TRIGGER workflow_links_job_completions BEFORE INSERT OR UPDATE OF job_id,vehicle_id,device_id ON public.job_completions FOR EACH ROW EXECUTE FUNCTION public.enforce_workflow_links();
DROP TRIGGER IF EXISTS workflow_links_stock_transactions ON public.stock_transactions;
CREATE TRIGGER workflow_links_stock_transactions BEFORE INSERT OR UPDATE OF job_id,vehicle_id ON public.stock_transactions FOR EACH ROW EXECUTE FUNCTION public.enforce_workflow_links();

CREATE OR REPLACE FUNCTION public.enforce_vehicle_slot_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE expected integer; existing_count integer;
BEGIN
  SELECT number_of_vehicles INTO expected FROM public.jobs WHERE id=NEW.job_id;
  IF expected IS NULL THEN RAISE EXCEPTION 'Job not found for Vehicle'; END IF;
  SELECT count(*) INTO existing_count FROM public.vehicles WHERE job_id=NEW.job_id;
  IF existing_count>=expected THEN RAISE EXCEPTION 'All vehicle slots for this Job have already been recorded'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS vehicle_slot_limit ON public.vehicles;
CREATE TRIGGER vehicle_slot_limit BEFORE INSERT ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.enforce_vehicle_slot_limit();

CREATE OR REPLACE FUNCTION public.sync_job_vehicle_workflow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE affected_job uuid; affected_vehicle uuid; expected integer; completed_count integer;
BEGIN
  affected_vehicle:=COALESCE(NEW.vehicle_id,OLD.vehicle_id);
  IF affected_vehicle IS NOT NULL THEN
    UPDATE public.vehicles v SET status=CASE
      WHEN EXISTS(SELECT 1 FROM public.job_completions c WHERE c.vehicle_id=affected_vehicle AND c.status='Completed') THEN 'Completed'
      WHEN EXISTS(SELECT 1 FROM public.job_completions c WHERE c.vehicle_id=affected_vehicle) THEN 'In Progress'
      ELSE 'Pending' END
    WHERE v.id=affected_vehicle;
  END IF;
  FOR affected_job IN
    SELECT DISTINCT job_id FROM (
      SELECT NEW.job_id AS job_id WHERE TG_OP<>'DELETE'
      UNION
      SELECT OLD.job_id AS job_id WHERE TG_OP<>'INSERT'
    ) x WHERE job_id IS NOT NULL
  LOOP
    SELECT number_of_vehicles INTO expected FROM public.jobs WHERE id=affected_job;
    SELECT count(DISTINCT vehicle_id) INTO completed_count FROM public.job_completions WHERE job_id=affected_job AND vehicle_id IS NOT NULL AND status='Completed';
    UPDATE public.jobs SET status=CASE
      WHEN expected IS NOT NULL AND completed_count>=expected THEN 'Completed'::public.record_status
      WHEN completed_count>0 THEN 'In Progress'::public.record_status
      ELSE 'Pending'::public.record_status END,
      updated_at=now()
    WHERE id=affected_job;
  END LOOP;
  RETURN COALESCE(NEW,OLD);
END $$;

DROP TRIGGER IF EXISTS sync_job_vehicle_workflow ON public.job_completions;
CREATE TRIGGER sync_job_vehicle_workflow AFTER INSERT OR UPDATE OR DELETE ON public.job_completions FOR EACH ROW EXECUTE FUNCTION public.sync_job_vehicle_workflow();

CREATE UNIQUE INDEX IF NOT EXISTS job_completions_job_vehicle_unique ON public.job_completions(job_id,vehicle_id) WHERE job_id IS NOT NULL AND vehicle_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_task_field_restrictions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF public.current_app_role()='Field Technician'::public.app_role THEN
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.department IS DISTINCT FROM OLD.department OR NEW.priority IS DISTINCT FROM OLD.priority OR NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.task_id IS DISTINCT FROM OLD.task_id THEN
      RAISE EXCEPTION 'Field Technician may only update task status';
    END IF;
    IF OLD.status='Pending'::public.record_status AND NEW.status NOT IN ('Acknowledged'::public.record_status,'Cancelled'::public.record_status) THEN RAISE EXCEPTION 'Task must be acknowledged before it can be started'; END IF;
    IF OLD.status='Acknowledged'::public.record_status AND NEW.status NOT IN ('In Progress'::public.record_status,'Cancelled'::public.record_status) THEN RAISE EXCEPTION 'Acknowledged task must be started or cancelled'; END IF;
    IF OLD.status='In Progress'::public.record_status AND NEW.status NOT IN ('Completed'::public.record_status,'Cancelled'::public.record_status) THEN RAISE EXCEPTION 'In-progress task must be completed or cancelled'; END IF;
    IF OLD.status='Completed'::public.record_status AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'Completed task cannot be reopened by a Field Technician'; END IF;
    IF NEW.status='Completed'::public.record_status AND OLD.status<>'Completed'::public.record_status THEN
      IF NEW.completed_at IS NULL THEN NEW.completed_at:=now(); END IF;
    ELSIF NEW.status<>'Completed'::public.record_status THEN NEW.completed_at:=NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS task_field_restrictions ON public.tasks;
CREATE TRIGGER task_field_restrictions BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.enforce_task_field_restrictions();
