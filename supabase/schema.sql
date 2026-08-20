-- DTM diffusion-model evaluation study — Supabase schema.
--
-- Every table has RLS enabled and NO policies for anon/authenticated roles.
-- That is deliberate: the only access path is the Edge Functions in
-- supabase/functions/, which run with the service_role key and bypass RLS
-- entirely. Nothing here is ever readable or writable directly from the
-- browser with the public anon key. This is what actually keeps
-- checkpoint identity hidden from participants (see study/README.md,
-- "Why this isn't a client-side manifest").
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New
-- query → paste → Run) on a fresh project.

create table if not exists images (
  image_id     text primary key,
  source_type  text not null check (source_type in ('real','checkpoint1','checkpoint2','checkpoint3','checkpoint4')),
  storage_path text not null,               -- e.g. images/pool/ab12cd34ef.jpg — relative to study/, served by GitHub Pages
  active       boolean not null default true,
  times_shown  integer not null default 0,  -- incremented by start-session; keeps exposure roughly even across participants
  created_at   timestamptz not null default now()
);

create table if not exists participants (
  participant_id    text primary key,        -- e.g. P-7F3A92
  resume_code       text not null unique,     -- e.g. K8X4-M2Q9
  trial_sequence    jsonb not null,           -- [{trial_number, page, image_id, source_type, storage_path}, ...] — server-side only, never sent to the client verbatim
  trial_sequence_id text not null,            -- random id stamped onto every response row from this sequence
  experiment_version text not null default 'v1',
  created_at         timestamptz not null default now(),
  completed_at       timestamptz
);

create table if not exists responses (
  id                 bigserial primary key,
  participant_id     text not null references participants(participant_id),
  trial_number       integer not null,
  page               integer not null,
  image_id           text not null,
  image_source       text not null,           -- real / checkpoint1..4 — the ground truth, stamped server-side from trial_sequence, never trusted from the client
  response           text not null check (response in ('ai','real','not_sure')),
  response_time_ms   integer,
  trial_sequence_id  text not null,
  experiment_version text not null,
  submitted_at       timestamptz not null default now()
);
create index if not exists responses_participant_trial_idx
  on responses (participant_id, trial_number, submitted_at desc);

-- A participant answering a trial twice (going back and changing an
-- answer) inserts a new row rather than overwriting — that's the audit
-- trail Section 12 asked for. This view is "what actually counts": the
-- most recent row per (participant, trial). Every export and every stats
-- query should read from this view, not from responses directly.
create or replace view latest_responses as
  select distinct on (participant_id, trial_number) *
  from responses
  order by participant_id, trial_number, submitted_at desc;

-- Allow-list of Supabase Auth users who may use the admin Edge Functions.
-- After creating your login (Dashboard → Authentication → Users → Add
-- user), run:
--   insert into admin_users (user_id) select id from auth.users where email = 'you@example.com';
create table if not exists admin_users (
  user_id uuid primary key references auth.users(id)
);

alter table images        enable row level security;
alter table participants  enable row level security;
alter table responses     enable row level security;
alter table admin_users   enable row level security;

-- Called once per new participant by start-session, right after their
-- 48 images are chosen, so the next participant's "least shown" query
-- reflects this participant's draw.
create or replace function bump_times_shown(ids text[])
returns void
language sql
as $$
  update images set times_shown = times_shown + 1 where image_id = any(ids);
$$;
