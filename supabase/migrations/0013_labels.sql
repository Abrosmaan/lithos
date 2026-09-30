-- ============================================================================
-- LITHOS — 0013 таблица меток (T7.1, поток A). Заготовка данных под будущую свою модель:
-- обучения нет и не будет в этой задаче, копим только подтверждённые метки пород.
-- Идемпотентно, schema-qualified, RLS включён. Контекст и решения —
-- docs/tasks/T7.1-own-model-groundwork.md, docs/tasks/T7.1-A-labels-server.md.
-- ============================================================================

-- ---- источник метки ---------------------------------------------------------------
do $$ begin
  create type lithos.label_source as enum ('user_confirm', 'user_correct', 'expert', 'golden');
exception when duplicate_object then null; end $$;

-- ---- labels -------------------------------------------------------------------------
-- rock_class хранится строкой, как lithos.cards.rock_class (0001) — источник истины по перечислению пород
-- остаётся в packages/shared, отдельный SQL-enum для пород сознательно не заводим (T7.1-A артефакт).
--
-- Уникальный ключ (scan_id, source, author_id), не (scan_id, source): источник и автор — разные измерения.
-- У пользовательских источников (user_confirm/user_correct) автор всегда один — единственный владелец скана,
-- поэтому для них ключ на практике схлопывается к «один скан — одна метка на источник», как и просили. Но
-- у 'expert' в будущем разные эксперты независимо оценивают одну и ту же находку — это два разных наблюдения,
-- схлопывать их в одну запись на (scan_id, source) значило бы терять данные. Ключ с author_id корректен для
-- обоих случаев одной и той же формой, без отдельного enum-специфичного правила.
-- author_id NOT NULL: для 'golden' (импорт эталонного набора, поток C) это требует завести реальный
-- идентификатор импортёра (например отдельная служебная строка lithos.users), иначе повторный запуск не
-- продедуплицируется через unique — решение и код импортёра оставлены потоку C, здесь только схема.
create table if not exists lithos.labels (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references lithos.scans(id) on delete cascade,
  rock_class text not null check (char_length(rock_class) > 0),
  source lithos.label_source not null,
  author_id uuid not null references lithos.users(id) on delete cascade,
  matched_model boolean not null,
  created_at timestamptz not null default now(),
  unique (scan_id, source, author_id)
);
create index if not exists labels_scan_idx on lithos.labels(scan_id);
create index if not exists labels_rock_class_idx on lithos.labels(rock_class);

comment on table lithos.labels is
  'Заготовка под собственную модель (T7.1) — подтверждённые метки пород, НЕ обучение само по себе. Согласие '
  'на обучение (lithos.users.training_opt_in, 0009) НИКАК не влияет на запись метки в этой таблице: метка — '
  'это подтверждение/исправление вердикта, нужное пользователю независимо от согласия на обучение. Фильтр по '
  'training_opt_in применяется только при выгрузке обучающего набора (поток C, docs/tasks/T7.1 §3), не здесь.';
comment on column lithos.labels.rock_class is
  'Строка, как lithos.cards.rock_class (0001) — источник истины по перечислению пород в packages/shared, не в БД.';
comment on column lithos.labels.source is
  'user_confirm/user_correct пишет lithos.record_label (эта миграция) от лица владельца скана. expert/golden '
  'зарезервированы под будущие потоки (экспертная разметка, импорт golden set) — эта функция их не принимает.';
comment on column lithos.labels.matched_model is
  'true, если rock_class метки совпал с lithos.cards.rock_class на момент записи — такие метки в первую очередь '
  'ценны для будущей обучающей выборки (T7.1 §1 «Осторожно»).';

alter table lithos.labels enable row level security;
-- Политик нет: читают только security definer функции и service_role (default privileges схемы 0001) —
-- по образцу lithos.limits (0005) и lithos.reports (0007). Прямого доступа authenticated к таблице нет:
-- authenticated не получает ни одного table-level гранта на lithos.labels ни в этой, ни в других миграциях.

-- ---- RPC: запись метки владельцем скана ----------------------------------------------
-- Принимает только user_confirm/user_correct — единственные источники, доступные из приложения сейчас
-- (T7.1 §1). expert/golden уже в enum под будущие потоки, но эта функция их отклоняет: нет смысла открывать
-- поверхность для того, что ещё не построено (экспертный доступ, импорт golden set — отдельная авторизация).
--
-- Подтверждение (user_confirm) переводит cards.verification из 'ai' в 'community' — единственное автоматическое
-- изменение карточки, которое делает эта функция; повторное подтверждение идемпотентно (конфликт по
-- уникальному ключу обновляет ту же метку, verification не трогается повторно).
--
-- Исправление (user_correct) НЕ подменяет вердикт карточки — ни rock_class, ни verification не меняются.
-- Это осознанное решение продукта (T7.1 §1 «Осторожно»), не миграции: пользователь ошибается не реже модели,
-- молча доверять единичной правке нельзя. Что должен делать клиент (поток B):
--   1. этим вызовом метка уже сохранена с происхождением 'user_correct' и rock_class из справочника;
--   2. показать пользователю нейтральный текст («метка сохранена, спасибо») — не «карточка исправлена»,
--      вердикт карточки не поменялся;
--   3. отдельно решить (это экранный/продуктовый выбор, не серверный), вызывать ли следом
--      lithos.enqueue_scan(p_scan_id, 'scan_dispute') для переанализа — очередь в воркере уже умеет
--      перезапускать скан с переопределением (T7.1 «Что уже сделано»), к ней просто пока ничего не
--      подключено со стороны приложения.
create or replace function lithos.record_label(p_scan_id uuid, p_source lithos.label_source, p_rock_class text)
returns table(id uuid, matched_model boolean, verification lithos.card_verification)
language plpgsql security definer set search_path = lithos, public as $$
declare
  v_user uuid := lithos.current_user_id();
  v_card lithos.cards;
  v_matched boolean;
  v_label_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_source not in ('user_confirm', 'user_correct') then
    raise exception 'unsupported_source' using errcode = 'P0001';
  end if;
  if p_rock_class is null or char_length(p_rock_class) = 0 then
    raise exception 'rock_class required';
  end if;
  if not exists (select 1 from lithos.scans where id = p_scan_id and user_id = v_user) then
    raise exception 'scan % not found or not owned', p_scan_id;
  end if;

  select * into v_card from lithos.cards where scan_id = p_scan_id;
  if not found then
    raise exception 'card_not_ready' using errcode = 'P0001';
  end if;
  if v_card.hidden then
    raise exception 'card_hidden' using errcode = 'P0001';
  end if;
  if v_card.verification = 'pending_review' then
    raise exception 'card_pending_review' using errcode = 'P0001';
  end if;

  v_matched := (p_rock_class = v_card.rock_class);

  insert into lithos.labels (scan_id, rock_class, source, author_id, matched_model)
  values (p_scan_id, p_rock_class, p_source, v_user, v_matched)
  on conflict (scan_id, source, author_id)
  do update set rock_class = excluded.rock_class, matched_model = excluded.matched_model, created_at = now()
  returning lithos.labels.id into v_label_id;

  if p_source = 'user_confirm' and v_card.verification = 'ai' then
    update lithos.cards set verification = 'community' where id = v_card.id;
    v_card.verification := 'community';
  end if;

  return query select v_label_id, v_matched, v_card.verification;
end $$;

revoke all on function lithos.record_label(uuid, lithos.label_source, text) from public;
grant execute on function lithos.record_label(uuid, lithos.label_source, text) to authenticated;
