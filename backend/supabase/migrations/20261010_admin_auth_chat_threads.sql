-- UTAG admin auth + saved chat threads
-- Run in the Supabase dashboard SQL editor AFTER creating your admin user
-- (Authentication -> Users -> Add user).
--
-- STEP 1: put your login email below, run the whole file.
-- STEP 2: redeploy the utag-control function (updated index.ts).

-- Mark yourself as admin (replace the email address).
update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"is_admin": true}'::jsonb
where email = 'REPLACE_WITH_YOUR_EMAIL';

-- Saved Hermes chat threads.
create table if not exists hermes_threads (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'New chat',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists hermes_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references hermes_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

alter table hermes_threads enable row level security;
alter table hermes_messages enable row level security;

drop policy if exists "admin all" on hermes_threads;
create policy "admin all" on hermes_threads for all
  using ((auth.jwt() -> 'user_metadata' ->> 'is_admin') = 'true')
  with check ((auth.jwt() -> 'user_metadata' ->> 'is_admin') = 'true');

drop policy if exists "admin all" on hermes_messages;
create policy "admin all" on hermes_messages for all
  using ((auth.jwt() -> 'user_metadata' ->> 'is_admin') = 'true')
  with check ((auth.jwt() -> 'user_metadata' ->> 'is_admin') = 'true');

create index if not exists hermes_messages_thread_idx
  on hermes_messages(thread_id, created_at);
