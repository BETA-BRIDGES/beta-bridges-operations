create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  requested_role text;
  safe_role app_role;
begin
  requested_role := coalesce(new.raw_user_meta_data->>'role','Viewer');
  if requested_role not in ('Operations','TSS Officer','Field Technician','Finance','Viewer') then
    safe_role := 'Viewer';
  else
    safe_role := requested_role::app_role;
  end if;
  insert into public.profiles(id,full_name,email,role,active)
  values(
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''), split_part(coalesce(new.email,''),'@',1)),
    coalesce(new.email,''),
    safe_role,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user_profile();

create or replace function public.bootstrap_first_super_admin(p_full_name text,p_email text)
returns profiles
language plpgsql
security definer
set search_path=public
as $$
declare
  p profiles;
  session_email text;
  existing_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  session_email := coalesce(auth.jwt()->>'email','');
  if lower(coalesce(p_email,'')) <> lower(session_email) then raise exception 'Email must match the authenticated account'; end if;
  if length(trim(coalesce(p_full_name,''))) < 2 then raise exception 'Full name is required'; end if;
  if exists(select 1 from public.profiles where role='Super Admin' and active=true) then
    raise exception 'A Super Admin already exists';
  end if;
  select count(*) into existing_count from public.profiles;
  if existing_count = 0 then
    insert into public.profiles(id,full_name,email,role,active)
    values(auth.uid(),trim(p_full_name),session_email,'Super Admin',true)
    returning * into p;
    return p;
  end if;
  if existing_count = 1 and exists(select 1 from public.profiles where id=auth.uid() and active=false) then
    update public.profiles
    set full_name=trim(p_full_name),email=session_email,role='Super Admin',active=true,updated_at=now()
    where id=auth.uid()
    returning * into p;
    return p;
  end if;
  raise exception 'Initial Super Admin has already been created or another account is already registered';
end;
$$;

revoke all on function public.handle_new_user_profile() from public;
revoke all on function public.bootstrap_first_super_admin(text,text) from public;
grant execute on function public.bootstrap_first_super_admin(text,text) to authenticated;
