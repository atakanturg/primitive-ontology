-- Primitive Ontology — Supabase schema
-- Run this in your Supabase SQL editor

-- 1. Watchlist table
create table if not exists watchlist (
  id                   uuid default gen_random_uuid() primary key,
  user_id              uuid references auth.users(id) on delete cascade not null,
  ticker               text not null,
  status               text default 'idle',
  sentiment            text,
  reasoning            text,
  last_updated         timestamptz default now(),
  last_analyzed_at     timestamptz,
  analysis_count       integer default 0,
  experimental_mode    boolean default false,
  political_signal_data jsonb
);

alter table watchlist enable row level security;

create policy "Users manage their own watchlist"
  on watchlist for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. Realtime — enable postgres_changes for watchlist
-- In Supabase dashboard: Database → Replication → enable watchlist table
-- Or run:
alter publication supabase_realtime add table watchlist;

-- 3. Mailing list (optional)
create table if not exists mailing_list (
  id         uuid default gen_random_uuid() primary key,
  email      text unique not null,
  created_at timestamptz default now()
);

alter table mailing_list enable row level security;

create policy "Users manage their own email"
  on mailing_list for all
  using (auth.uid() = (select id from auth.users where email = mailing_list.email limit 1));
