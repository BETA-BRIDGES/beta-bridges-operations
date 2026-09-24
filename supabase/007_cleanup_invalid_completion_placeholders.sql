-- Remove stale Daily Job Done rows created from worksheet placeholder labels.
-- "DONE"/"COMPLETED"/"STATUS" are not physical tracker IDs.
delete from public.job_completions
where upper(trim(coalesce(device_id,'')))='DONE'
  and legacy_source_key like 'sheet|dailyJobDone|%';
