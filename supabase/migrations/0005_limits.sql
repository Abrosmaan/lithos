-- ============================================================================
-- LITHOS — 0005 лимиты сканов (T3.4). ai-pipeline §4 «Лимиты», spec §11, §13.
-- Идемпотентно, schema-qualified. Балансовые числа — packages/shared/src/limits.ts (SCAN_LIMIT_SEED);
-- таблица lithos.limits сидится ими здесь (единственное разрешённое дублирование, сверяется тестом
-- apps/worker/src/limits/limits-migration.test.ts). Изменение числа = новая миграция + правка shared.
-- ============================================================================

-- ---- limits: значения для SQL-проверок ------------------------------------------
create table if not exists lithos.limits (
  key text primary key,
  value int not null,
  updated_at timestamptz not null default now()
);
alter table lithos.limits enable row level security;
-- Политик нет: читают только security definer функции и service_role (default privileges схемы).

-- on conflict do update: миграция — источник значений (при повторном прогоне/ручной правке таблица возвращается к shared).
insert into lithos.limits (key, value) values
  ('max_scans_per_day', 10),
  ('new_account_scans_per_day', 20),
  ('new_account_hours', 24)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- ---- scans.enqueued_at: идемпотентность enqueue_scan --------------------------------
alter table lithos.scans add column if not exists enqueued_at timestamptz;

create or replace function lithos.limit_value(p_key text) returns int
language plpgsql stable security definer set search_path = lithos, public as $$
declare v int;
begin
  select value into v from lithos.limits where key = p_key;
  if v is null then raise exception 'lithos.limits: missing key %', p_key; end if;
  return v;
end $$;
revoke all on function lithos.limit_value(text) from public;

-- Скользящее окно «сутки» = 24 ч. Не считаются сканы, отклонённые самим лимитом (они ничего не стоили).
-- Возраст аккаунта < new_account_hours → new_account_scans_per_day, иначе max_scans_per_day.
create or replace function lithos.scan_limit_exceeded(p_user_id uuid, p_scan_id uuid) returns boolean
language plpgsql stable security definer set search_path = lithos, public as $$
declare v_created timestamptz; v_limit int; v_count int;
begin
  select created_at into v_created from lithos.users where id = p_user_id;
  if v_created is null then return false; end if;
  if v_created > now() - make_interval(hours => lithos.limit_value('new_account_hours')) then
    v_limit := lithos.limit_value('new_account_scans_per_day');
  else
    v_limit := lithos.limit_value('max_scans_per_day');
  end if;
  select count(*) into v_count
    from lithos.scans s
   where s.user_id = p_user_id
     and s.id <> p_scan_id
     and s.created_at > now() - interval '24 hours'
     and not (s.stage = 'failed' and s.error = 'rate_limited');
  return v_count >= v_limit;
end $$;
revoke all on function lithos.scan_limit_exceeded(uuid, uuid) from public;

-- ---- триггер: лимит применяется уже при insert скана ----------------------------------
-- raise exception в enqueue_scan откатил бы и запись stage/error; поэтому запись делает триггер при вставке
-- (клиент вставляет scans до фото и enqueue), а enqueue_scan по ней бросает 'rate_limited'.
-- Advisory xact-lock на пользователя: два параллельных insert не проскочат вдвоём через лимит.
-- classid 0x4c494d54 ('LIMT') ≠ 0x4c495448 ('LITH', locks воркера на scan_id).
create or replace function lithos.scans_apply_limit() returns trigger
language plpgsql security definer set search_path = lithos, public as $$
begin
  if new.stage = 'preflight' then
    perform pg_advisory_xact_lock(1279872340, ('x' || substr(md5(new.user_id::text), 1, 8))::bit(32)::int);
    if lithos.scan_limit_exceeded(new.user_id, new.id) then
      new.stage := 'failed';
      new.error := 'rate_limited';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists scans_apply_limit on lithos.scans;
create trigger scans_apply_limit before insert on lithos.scans
  for each row execute function lithos.scans_apply_limit();

-- ---- RPC: постановка в очередь с лимитом и идемпотентностью ----------------------------
-- rate_limited → SQLSTATE P0001, message 'rate_limited' (клиент показывает свой текст).
-- Повторный вызов для скана, который уже в очереди / в конвейере → 0, второе сообщение не шлётся, лимит не тратится.
-- Лимит и идемпотентность — только для scan_interactive (dispute/batch — переанализ, не новый скан).
create or replace function lithos.enqueue_scan(p_scan_id uuid, p_queue text default 'scan_interactive')
returns bigint
language plpgsql security definer set search_path = lithos, pgmq, public as $$
declare v_msg bigint; v_user uuid; v_stage lithos.scan_stage; v_error text; v_enqueued timestamptz;
begin
  if p_queue not in ('scan_interactive','scan_dispute','scan_batch') then
    raise exception 'unknown queue %', p_queue;
  end if;
  v_user := lithos.current_user_id();
  select s.stage, s.error, s.enqueued_at into v_stage, v_error, v_enqueued
    from lithos.scans s where s.id = p_scan_id and s.user_id = v_user for update;
  if not found then
    raise exception 'scan % not found or not owned', p_scan_id;
  end if;
  if p_queue = 'scan_interactive' then
    if v_stage = 'failed' and v_error = 'rate_limited' then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
    if v_enqueued is not null or v_stage <> 'preflight' then
      return 0;
    end if;
    -- Страховка (скан вставлен до триггера, stage вернули руками): та же проверка перед отправкой.
    if lithos.scan_limit_exceeded(v_user, p_scan_id) then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  end if;
  select pgmq.send(p_queue, jsonb_build_object('scan_id', p_scan_id, 'enqueued_at', now())) into v_msg;
  update lithos.scans set enqueued_at = coalesce(enqueued_at, now()) where id = p_scan_id;
  return v_msg;
end $$;
grant execute on function lithos.enqueue_scan(uuid, text) to authenticated;
