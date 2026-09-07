-- ============================================================================
-- LITHOS — 0001 schema init (T0.1). Общий Supabase, изоляция схемой lithos.
-- Идемпотентно, всё schema-qualified, RLS включён. dev-plan §3.
-- ============================================================================

create schema if not exists lithos;
grant usage on schema lithos to postgres, anon, authenticated, service_role;
alter default privileges in schema lithos grant all on tables to postgres, service_role;
alter default privileges in schema lithos grant all on sequences to postgres, service_role;
alter default privileges in schema lithos grant execute on functions to postgres, service_role;

-- pgmq: расширение живёт в своей схеме `pgmq` (ограничение расширения, не наш выбор).
-- Имена очередей — по dev-plan §3; других проектов с pgmq в этом инстансе нет.
create extension if not exists pgmq;

-- ---- enum-типы (нет CREATE TYPE IF NOT EXISTS → через DO/exception) -----------
do $$ begin
  create type lithos.scan_stage as enum ('preflight','gate','main','escalation','rules','done','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lithos.card_state as enum ('closed','opened');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lithos.card_verification as enum ('ai','community','expert','pending_review');
exception when duplicate_object then null; end $$;

-- ---- users --------------------------------------------------------------------
-- Anon-auth Supabase: auth_user_id = auth.uid(). device_id — для лимитов и scan_id (uuid v5).
create table if not exists lithos.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  device_id text unique,
  display_name text,
  created_at timestamptz not null default now()
);

-- ---- scans --------------------------------------------------------------------
-- id = idempotency key (uuid v5(device_id + timestamp), считает клиент).
create table if not exists lithos.scans (
  id uuid primary key,
  user_id uuid not null references lithos.users(id) on delete cascade,
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  user_tests jsonb,                       -- {weight, scratch, wet}
  parent_card_id uuid,                    -- раскол: ссылка на закрытую карточку
  stage lithos.scan_stage not null default 'preflight',
  attempt int not null default 0,
  provider text,
  prompt_version text,
  cost_usd numeric(10,6) not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scans_user_created_idx on lithos.scans(user_id, created_at desc);
create index if not exists scans_stage_idx on lithos.scans(stage);

-- ---- scan_photos --------------------------------------------------------------
create table if not exists lithos.scan_photos (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references lithos.scans(id) on delete cascade,
  storage_path text not null,
  phash text,
  is_primary boolean not null default false,
  width int,
  height int,
  created_at timestamptz not null default now()
);
create index if not exists scan_photos_scan_idx on lithos.scan_photos(scan_id);
create index if not exists scan_photos_phash_idx on lithos.scan_photos(phash);

-- ---- scan_results: один ряд на ступень (идемпотентность воркера) --------------
create table if not exists lithos.scan_results (
  scan_id uuid not null references lithos.scans(id) on delete cascade,
  stage lithos.scan_stage not null,
  provider text,
  model text,
  prompt_version text,
  raw_json jsonb not null,
  tokens_in int,
  tokens_out int,
  cost_usd numeric(10,6) not null default 0,
  latency_ms int,
  created_at timestamptz not null default now(),
  primary key (scan_id, stage)
);

-- ---- cards --------------------------------------------------------------------
create table if not exists lithos.cards (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null unique references lithos.scans(id) on delete cascade,
  user_id uuid not null references lithos.users(id) on delete cascade,
  rock_class text not null,               -- enum из packages/shared (источник истины — код)
  tier text not null,
  score int not null,
  score_breakdown jsonb not null,
  inclusions jsonb not null default '[]'::jsonb,
  shape jsonb not null default '{}'::jsonb,
  lore text,
  name text,
  user_name text,
  state lithos.card_state not null default 'closed',
  parent_card_id uuid references lithos.cards(id),
  verification lithos.card_verification not null default 'ai',
  provisional boolean not null default false,   -- fallback-провайдер: «предварительно»
  hidden boolean not null default false,        -- родитель после раскола
  cell_id text,                                 -- geohash-6
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cards_user_idx on lithos.cards(user_id, created_at desc);
create index if not exists cards_cell_idx on lithos.cards(user_id, cell_id);

-- ---- geo_cache: Macrostrat по geohash-6, 30 дней ------------------------------
create table if not exists lithos.geo_cache (
  cell_id text primary key,
  macrostrat_json jsonb,
  expected_rocks jsonb not null default '[]'::jsonb,
  wanderers jsonb not null default '[]'::jsonb,
  age_range text,
  setting text,
  fetched_at timestamptz not null default now()
);

-- ---- diary --------------------------------------------------------------------
create table if not exists lithos.diary (
  user_id uuid not null references lithos.users(id) on delete cascade,
  cell_id text not null,
  expected jsonb not null default '[]'::jsonb,
  found jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, cell_id)
);

-- ---- updated_at триггер --------------------------------------------------------
create or replace function lithos.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

do $$ begin
  create trigger scans_set_updated_at before update on lithos.scans
    for each row execute function lithos.set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger cards_set_updated_at before update on lithos.cards
    for each row execute function lithos.set_updated_at();
exception when duplicate_object then null; end $$;

-- ---- pgmq очереди (dev-plan §3) ------------------------------------------------
do $$ begin perform pgmq.create('scan_interactive'); exception when others then null; end $$;
do $$ begin perform pgmq.create('scan_dispute');     exception when others then null; end $$;
do $$ begin perform pgmq.create('scan_batch');       exception when others then null; end $$;

-- ---- RLS ------------------------------------------------------------------------
alter table lithos.users        enable row level security;
alter table lithos.scans        enable row level security;
alter table lithos.scan_photos  enable row level security;
alter table lithos.scan_results enable row level security;
alter table lithos.cards        enable row level security;
alter table lithos.geo_cache    enable row level security;
alter table lithos.diary        enable row level security;

grant select, insert, update on lithos.users, lithos.scans, lithos.scan_photos, lithos.cards, lithos.diary to authenticated;
grant select on lithos.scan_results, lithos.geo_cache to authenticated;

-- helper: id пользователя lithos по auth.uid()
create or replace function lithos.current_user_id() returns uuid
language sql stable security definer set search_path = lithos, public as $$
  select id from lithos.users where auth_user_id = auth.uid()
$$;
grant execute on function lithos.current_user_id() to authenticated, anon;

drop policy if exists users_self on lithos.users;
create policy users_self on lithos.users for all to authenticated
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

drop policy if exists scans_own on lithos.scans;
create policy scans_own on lithos.scans for all to authenticated
  using (user_id = lithos.current_user_id()) with check (user_id = lithos.current_user_id());

drop policy if exists scan_photos_own on lithos.scan_photos;
create policy scan_photos_own on lithos.scan_photos for all to authenticated
  using (exists (select 1 from lithos.scans s where s.id = scan_id and s.user_id = lithos.current_user_id()))
  with check (exists (select 1 from lithos.scans s where s.id = scan_id and s.user_id = lithos.current_user_id()));

drop policy if exists scan_results_own on lithos.scan_results;
create policy scan_results_own on lithos.scan_results for select to authenticated
  using (exists (select 1 from lithos.scans s where s.id = scan_id and s.user_id = lithos.current_user_id()));

drop policy if exists cards_own on lithos.cards;
create policy cards_own on lithos.cards for all to authenticated
  using (user_id = lithos.current_user_id()) with check (user_id = lithos.current_user_id());

drop policy if exists geo_cache_read on lithos.geo_cache;
create policy geo_cache_read on lithos.geo_cache for select to authenticated using (true);

drop policy if exists diary_own on lithos.diary;
create policy diary_own on lithos.diary for all to authenticated
  using (user_id = lithos.current_user_id()) with check (user_id = lithos.current_user_id());

-- ---- RPC: постановка скана в очередь (клиент не имеет прав на схему pgmq) -----
create or replace function lithos.enqueue_scan(p_scan_id uuid, p_queue text default 'scan_interactive')
returns bigint
language plpgsql security definer set search_path = lithos, pgmq, public as $$
declare v_msg bigint;
begin
  if p_queue not in ('scan_interactive','scan_dispute','scan_batch') then
    raise exception 'unknown queue %', p_queue;
  end if;
  if not exists (select 1 from lithos.scans s where s.id = p_scan_id and s.user_id = lithos.current_user_id()) then
    raise exception 'scan % not found or not owned', p_scan_id;
  end if;
  select pgmq.send(p_queue, jsonb_build_object('scan_id', p_scan_id, 'enqueued_at', now())) into v_msg;
  return v_msg;
end $$;
grant execute on function lithos.enqueue_scan(uuid, text) to authenticated;

-- ---- Realtime: клиент подписывается на scans/cards по scan_id -------------------
do $$ begin
  alter publication supabase_realtime add table lithos.scans;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table lithos.cards;
exception when duplicate_object then null; when undefined_object then null; end $$;
