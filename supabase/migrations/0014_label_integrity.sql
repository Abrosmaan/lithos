-- ============================================================================
-- LITHOS — 0014 правки по ревью потока A (T7.1). Идемпотентно, schema-qualified.
-- 0013 применена, править её нельзя.
--
-- Дефект 1 (блокер). record_label переводила cards.verification из 'ai' в 'community', когда владелец
-- подтверждал собственную находку. Никакого сообщества в этом нет: второго независимого наблюдателя в
-- системе не существует. Пользователю при этом показывалось «подтверждено сообществом» — ложное сообщение
-- о независимой проверке, а в базе самоподтверждение становилось неотличимо от настоящего, когда оно
-- появится. Это испортило бы и доверие к признаку, и отбор в обучающую выборку, ради которого всё затевалось.
-- Решение: функция больше не трогает cards.verification вообще. Факт «автор подтвердил» и так лежит в
-- lithos.labels с источником и автором, оттуда его и читать. Значение 'community' остаётся зарезервированным
-- за настоящим подтверждением со стороны других людей.
--
-- Дефект 2 (major). p_rock_class проверялась только на непустоту. В cards.rock_class пишет доверенный воркер,
-- а сюда пишет конечный пользователь через RPC: TypeScript ограничивает только свой интерфейс, вызвать
-- функцию с произвольной строкой можно в обход приложения. Загрязнялась ровно та таблица, ради чистоты
-- которой задача и делается. Решение: справочник пород в базе и внешний ключ на него.
--
-- Справочник — единственное разрешённое дублирование, как сид lithos.limits в 0005: SQL не умеет
-- импортировать TypeScript. Источник истины остаётся packages/shared/src/enums.ts (ROCK_CLASSES), а тест
-- apps/mobile/src/lib/labels.test.ts читает этот файл и сверяет списки. Новая порода = новая миграция.
-- ============================================================================

create table if not exists lithos.rock_classes (
  code text primary key
);
comment on table lithos.rock_classes is 'Справочник пород для проверки пользовательских меток. Источник истины — ROCK_CLASSES в packages/shared/src/enums.ts, сверяется тестом.';

alter table lithos.rock_classes enable row level security;

insert into lithos.rock_classes (code) values
  ('basalt'),
  ('amygdaloidal_basalt'),
  ('vesicular_basalt'),
  ('andesite'),
  ('dacite'),
  ('rhyolite'),
  ('trachyte'),
  ('obsidian'),
  ('pumice'),
  ('scoria'),
  ('tuff'),
  ('ignimbrite'),
  ('volcanic_breccia'),
  ('granite'),
  ('granodiorite'),
  ('diorite'),
  ('syenite'),
  ('gabbro'),
  ('diabase'),
  ('peridotite'),
  ('pegmatite'),
  ('sandstone'),
  ('greywacke'),
  ('siltstone'),
  ('mudstone'),
  ('shale'),
  ('claystone'),
  ('marl'),
  ('conglomerate'),
  ('breccia'),
  ('limestone'),
  ('fossiliferous_limestone'),
  ('coquina'),
  ('dolomite'),
  ('chalk'),
  ('travertine'),
  ('chert'),
  ('flint'),
  ('ironstone'),
  ('coal'),
  ('slate'),
  ('phyllite'),
  ('schist'),
  ('gneiss'),
  ('migmatite'),
  ('quartzite'),
  ('marble'),
  ('amphibolite'),
  ('serpentinite'),
  ('greenstone'),
  ('hornfels'),
  ('eclogite'),
  ('mylonite'),
  ('soapstone'),
  ('jasper'),
  ('agate'),
  ('chalcedony'),
  ('quartz_vein'),
  ('petrified_wood'),
  ('fossil'),
  ('concretion'),
  ('geode'),
  ('unknown_igneous'),
  ('unknown_sedimentary'),
  ('unknown_metamorphic'),
  ('unknown')
on conflict (code) do nothing;

-- Внешний ключ на справочник: в lithos.labels пишет конечный пользователь, доверия к строке нет.
do $$ begin
  alter table lithos.labels add constraint labels_rock_class_fkey
    foreign key (rock_class) references lithos.rock_classes(code);
exception when duplicate_object then null; end $$;

create or replace function lithos.record_label(p_scan_id uuid, p_source lithos.label_source, p_rock_class text)
returns table(id uuid, matched_model boolean, verification lithos.card_verification)
language plpgsql security definer set search_path = lithos, public as $$
declare
  v_user uuid := lithos.current_user_id();
  v_card lithos.cards%rowtype;
  v_label_id uuid;
  v_matched boolean;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_source not in ('user_confirm', 'user_correct') then
    raise exception 'unsupported_source' using errcode = 'P0001';
  end if;
  if p_rock_class is null or not exists (select 1 from lithos.rock_classes where code = p_rock_class) then
    raise exception 'unknown_rock_class' using errcode = 'P0001';
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

  -- cards.verification намеренно не меняется: см. шапку файла.
  return query select v_label_id, v_matched, v_card.verification;
end $$;

revoke all on function lithos.record_label(uuid, lithos.label_source, text) from public;
grant execute on function lithos.record_label(uuid, lithos.label_source, text) to authenticated;
