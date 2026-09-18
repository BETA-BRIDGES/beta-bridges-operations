create table if not exists public.google_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  refresh_token_ciphertext text not null,
  google_email text,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

alter table public.google_oauth_tokens enable row level security;
revoke all on table public.google_oauth_tokens from anon, authenticated;
create index if not exists google_oauth_tokens_user_id_idx on public.google_oauth_tokens(user_id);
