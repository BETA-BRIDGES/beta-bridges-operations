-- Initial legacy Google Sheets import support.
alter table public.clients add column if not exists legacy_source_key text;
alter table public.jobs add column if not exists legacy_source_key text;
alter table public.jobs add column if not exists tss_officer_name text;
alter table public.job_completions add column if not exists legacy_source_key text;
alter table public.stock_transactions add column if not exists legacy_source_key text;
alter table public.miscellaneous_charges add column if not exists legacy_source_key text;
alter table public.technician_weekly_activity add column if not exists technician_name text;
alter table public.technician_weekly_activity add column if not exists legacy_source_key text;
alter table public.technician_weekly_activity alter column technician_id drop not null;

create unique index if not exists clients_legacy_source_key_uidx
  on public.clients(legacy_source_key);
create unique index if not exists jobs_legacy_source_key_uidx
  on public.jobs(legacy_source_key);
create unique index if not exists job_completions_legacy_source_key_uidx
  on public.job_completions(legacy_source_key);
create unique index if not exists stock_transactions_legacy_source_key_uidx
  on public.stock_transactions(legacy_source_key);
create unique index if not exists miscellaneous_charges_legacy_source_key_uidx
  on public.miscellaneous_charges(legacy_source_key);
create unique index if not exists technician_weekly_activity_legacy_source_key_uidx
  on public.technician_weekly_activity(legacy_source_key);
