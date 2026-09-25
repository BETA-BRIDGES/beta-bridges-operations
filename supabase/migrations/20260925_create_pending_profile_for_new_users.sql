-- Create a pending Beta Bridges profile automatically for every new Auth user.
-- Super Admin is never granted through public signup.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare requested_role public.app_role;
begin
  requested_role := case
    when coalesce(new.raw_user_meta_data->>'role','') = 'Operations' then 'Operations'::public.app_role
    when coalesce(new.raw_user_meta_data->>'role','') = 'TSS Officer' then 'TSS Officer'::public.app_role
    when coalesce(new.raw_user_meta_data->>'role','') = 'Finance' then 'Finance'::public.app_role
    when coalesce(new.raw_user_meta_data->>'role','') = 'Viewer' then 'Viewer'::public.app_role
    else 'Field Technician'::public.app_role
  end;

  insert into public.profiles(id, full_name, email, role, active, module_access)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''), split_part(coalesce(new.email,''),'@',1)),
    new.email,
    requested_role,
    false,
    null
  )
  on conflict (id) do update
  set full_name = excluded.full_name,
      email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public;
grant execute on function public.handle_new_user() to service_role;
