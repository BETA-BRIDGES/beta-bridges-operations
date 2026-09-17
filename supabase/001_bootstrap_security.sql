create or replace function public.bootstrap_first_super_admin(p_full_name text,p_email text) returns profiles
language plpgsql security definer set search_path=public
as $$
declare p profiles; session_email text;
begin
  if exists(select 1 from public.profiles) then raise exception 'Initial Super Admin has already been created'; end if;
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  session_email := coalesce(auth.jwt()->>'email','');
  if lower(coalesce(p_email,'')) <> lower(session_email) then raise exception 'Email must match the authenticated account'; end if;
  if length(trim(coalesce(p_full_name,''))) < 2 then raise exception 'Full name is required'; end if;
  insert into public.profiles(id,full_name,email,role,active)
  values(auth.uid(),trim(p_full_name),session_email,'Super Admin',true)
  returning * into p;
  return p;
end $$;
revoke all on function public.bootstrap_first_super_admin(text,text) from public;
grant execute on function public.bootstrap_first_super_admin(text,text) to authenticated;
