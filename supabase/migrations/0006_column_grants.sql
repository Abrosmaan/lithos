-- ============================================================================
-- LITHOS — 0006 (T3.4, ревью M1/m1/m10). Клиент (authenticated) не должен менять stage/error/cost и обходить лимит.
-- Колоночные права: RLS оставляет «свои строки», grant — «свои колонки». Воркер (service_role/postgres) не затронут.
-- Идемпотентно, schema-qualified.
-- ============================================================================

-- ---- scans: клиент правит только поля своей заявки (T1.4 submitScan шаг 1) ----------
revoke update on lithos.scans from authenticated;
grant update (lat, lng, accuracy_m, user_tests, parent_card_id) on lithos.scans to authenticated;

-- ---- users: только имя (T3.3 profile) ---------------------------------------------
revoke update on lithos.users from authenticated;
grant update (display_name) on lithos.users to authenticated;

-- ---- cards: только пользовательское имя карточки ------------------------------------
revoke update on lithos.cards from authenticated;
grant update (user_name) on lithos.cards to authenticated;

-- ---- триггер лимита: только клиентские вставки (auth.uid() есть) ------------------------
-- Воркер/скрипты/тесты под postgres/service_role вставляют scans без JWT — лимит к ним не применяется.
create or replace function lithos.scans_apply_limit() returns trigger
language plpgsql security definer set search_path = lithos, public as $$
begin
  if new.stage = 'preflight' and auth.uid() is not null then
    perform pg_advisory_xact_lock(1279872340, ('x' || substr(md5(new.user_id::text), 1, 8))::bit(32)::int);
    if lithos.scan_limit_exceeded(new.user_id, new.id) then
      new.stage := 'failed';
      new.error := 'rate_limited';
    end if;
  end if;
  return new;
end $$;

-- ---- enqueue_scan: -1 = «уже в очереди / в конвейере / терминален», второе сообщение не шлётся ----
-- Возврат: msg_id > 0 — поставлен; -1 — идемпотентный повтор (не ошибка, лимит не тратится).
-- Ошибки: 'rate_limited' (P0001) — лимит; 'scan … not found or not owned'; 'unknown queue …'.
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
      return -1;
    end if;
    -- Страховка (скан вставлен до триггера/без JWT): та же проверка перед отправкой.
    if lithos.scan_limit_exceeded(v_user, p_scan_id) then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  end if;
  select pgmq.send(p_queue, jsonb_build_object('scan_id', p_scan_id, 'enqueued_at', now())) into v_msg;
  update lithos.scans set enqueued_at = coalesce(enqueued_at, now()) where id = p_scan_id;
  return v_msg;
end $$;
grant execute on function lithos.enqueue_scan(uuid, text) to authenticated;
