-- ============================================================================
-- LITHOS — 0007 публичная витрина (T6.1, поток D). Идемпотентно, schema-qualified.
-- Модель (docs/tasks/T6.0-fixes-and-social.md §2): витрина = публикация. Точные координаты
-- наружу не отдаются никогда — только cell_id (geohash-6, ~1,2 км), центр считает клиент.
-- ============================================================================

-- ---- cards: флаг публикации -----------------------------------------------------
alter table lithos.cards add column if not exists published boolean not null default false;
alter table lithos.cards add column if not exists published_at timestamptz;
create index if not exists cards_published_idx on lithos.cards(published, published_at desc) where published;

comment on column lithos.cards.published is 'Витрина = публикация (T6.0 §2). Менять только через lithos.publish_card — прямой UPDATE авторизованному клиенту не выдан (см. грант ниже).';
comment on column lithos.cards.published_at is 'Время последней публикации; null у неопубликованных и после снятия/автоскрытия по жалобам.';

-- Прямое обновление cards.published(_at) клиенту не даём: 0006 уже снял общий UPDATE на lithos.cards
-- и выдал точечный грант только на user_name. Новые колонки НЕ добавляются в этот список — они остаются
-- недоступны для прямого UPDATE authenticated и меняются только через security definer RPC ниже.
-- (Явный revoke не нужен и был бы избыточен: после 0006 на таблице нет общего table-level UPDATE для
-- authenticated, которым можно было бы "случайно" покрыть новую колонку — только колоночные гранты.)

-- ---- публичное представление: только разрешённые колонки, без точных координат ----
-- Views в Postgres по умолчанию выполняются с правами владельца (создаётся под postgres, у которого есть
-- полный доступ к lithos.cards/users через default privileges 0001) — поэтому представление видит строки
-- ВСЕХ пользователей в обход RLS-политики cards_own, а наружу отдаёт только перечисленные ниже колонки.
-- lat/lng сюда не включены и не должны быть добавлены — это проверяется тестом на текст миграции
-- (apps/mobile/src/lib/publish.test.ts, по образцу apps/worker/src/limits/limits-migration.test.ts).
create or replace view lithos.public_finds as
select
  c.id,
  c.rock_class,
  c.tier,
  c.score,
  c.lore,
  c.name,
  c.user_name,
  c.cell_id,
  c.created_at,
  c.published_at,
  u.display_name as author_name
from lithos.cards c
join lithos.users u on u.id = c.user_id
where c.published
  and not c.hidden
  and c.verification <> 'pending_review';

comment on view lithos.public_finds is 'Публичная витрина (T6.0 §2.2). Никогда не добавлять lat/lng и другие колонки из data-map.md «не видно никому, кроме владельца».';

grant select on lithos.public_finds to authenticated;

-- ---- доступ к лицевому фото опубликованной карточки --------------------------------
-- Бакет lithos-photos приватный (0002). Клиенту нужно: (1) узнать storage_path лицевого фото чужой
-- опубликованной карточки — public_finds его не содержит (scan_id туда сознательно не включён, чтобы не
-- расширять поверхность представления), поэтому путь отдаёт RPC public_photo_path; (2) получить право
-- на createSignedUrl по этому пути — это отдельная проверка на уровне storage.objects (Storage API сам
-- проверяет RLS перед подписью), поэтому политика ниже нужна в любом случае, даже вместе с RPC.
create or replace function lithos.public_photo_path(p_card_id uuid) returns text
language sql stable security definer set search_path = lithos, public as $$
  select sp.storage_path
  from lithos.cards c
  join lithos.scan_photos sp on sp.scan_id = c.scan_id and sp.is_primary
  where c.id = p_card_id
    and c.published
    and not c.hidden
    and c.verification <> 'pending_review'
  limit 1
$$;
grant execute on function lithos.public_photo_path(uuid) to authenticated;

drop policy if exists "lithos photos select public" on storage.objects;
create policy "lithos photos select public" on storage.objects for select to authenticated
  using (
    bucket_id = 'lithos-photos'
    and exists (
      select 1
      from lithos.scan_photos sp
      join lithos.cards c on c.scan_id = sp.scan_id
      where sp.storage_path = storage.objects.name
        and sp.is_primary
        and c.published
        and not c.hidden
        and c.verification <> 'pending_review'
    )
  );
-- Политика дополняет (не заменяет) "lithos photos select own" (0002) — Postgres OR'ит permissive-политики
-- одной команды, свои фото остаются видны как раньше.

-- ---- RPC: публикация / снятие карточки владельцем -----------------------------------
-- Запрещает публиковать hidden (родитель после раскола) и pending_review (T6.0 §2.2).
-- Повторный вызов с тем же p_published — не ошибка (идемпотентно).
create or replace function lithos.publish_card(p_card_id uuid, p_published boolean)
returns lithos.cards
language plpgsql security definer set search_path = lithos, public as $$
declare v_row lithos.cards;
begin
  select * into v_row from lithos.cards
    where id = p_card_id and user_id = lithos.current_user_id()
    for update;
  if not found then
    raise exception 'card % not found or not owned', p_card_id;
  end if;

  if p_published then
    if v_row.hidden then
      raise exception 'card_hidden' using errcode = 'P0001';
    end if;
    if v_row.verification = 'pending_review' then
      raise exception 'card_pending_review' using errcode = 'P0001';
    end if;
    update lithos.cards set published = true, published_at = now()
      where id = p_card_id
      returning * into v_row;
  else
    update lithos.cards set published = false, published_at = null
      where id = p_card_id
      returning * into v_row;
  end if;
  return v_row;
end $$;
grant execute on function lithos.publish_card(uuid, boolean) to authenticated;

-- ---- жалобы -------------------------------------------------------------------------
-- Как lithos.limits (0005): RLS включён, политик нет — читают только security definer функции
-- и service_role (default privileges схемы). Клиент не видит чужие жалобы и не видит, сколько их на карточке.
create table if not exists lithos.reports (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references lithos.cards(id) on delete cascade,
  reporter_id uuid not null references lithos.users(id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  unique (card_id, reporter_id)
);
alter table lithos.reports enable row level security;
create index if not exists reports_card_idx on lithos.reports(card_id);

-- ---- RPC: жалоба на опубликованную находку -------------------------------------------
-- Порог автоскрытия — константа REPORT_HIDE_THRESHOLD ниже (3 жалобы). Сознательно не в packages/shared:
-- это не балансовое число score/тиров (CLAUDE.md «Правила»), а серверный порог модерации без клиентской
-- логики вокруг него; выбор описан в docs/tasks/T6.1-D-publish-server.md. При достижении порога карточка
-- снимается с публикации (published=false), НЕ трогая cards.hidden — это поле зарезервировано за расколом
-- (0001: «родитель после раскола») и означает другое: скрытие от самого владельца, а не от витрины.
-- Повторная жалоба того же пользователя (unique card_id+reporter_id) не считается дважды и не ошибка —
-- возвращает 'already_reported', отличая этот случай от первой жалобы ('reported') для текста на экране
-- (docs/legal/consent-copy.md §7).
create or replace function lithos.report_card(p_card_id uuid, p_reason text default null)
returns text
language plpgsql security definer set search_path = lithos, public as $$
declare
  v_user uuid := lithos.current_user_id();
  v_threshold constant int := 3; -- REPORT_HIDE_THRESHOLD, см. артефакт задачи
  v_count int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from lithos.cards
    where id = p_card_id and published and not hidden and verification <> 'pending_review'
  ) then
    raise exception 'card_not_public';
  end if;

  begin
    insert into lithos.reports (card_id, reporter_id, reason)
    values (p_card_id, v_user, nullif(left(coalesce(p_reason, ''), 500), ''));
  exception when unique_violation then
    return 'already_reported';
  end;

  select count(*) into v_count from lithos.reports where card_id = p_card_id;
  if v_count >= v_threshold then
    update lithos.cards set published = false, published_at = null where id = p_card_id and published;
  end if;
  return 'reported';
end $$;
grant execute on function lithos.report_card(uuid, text) to authenticated;
