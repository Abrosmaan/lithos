-- ============================================================================
-- LITHOS — 0009 правки по ревью T6.1 потока F (compliance), замечания 1 и 3. Идемпотентно, schema-qualified.
-- 0007 и 0008 уже применены к проду, править их нельзя.
-- ============================================================================

-- ---- Замечание 1: согласие на обучение — не молчаливое ---------------------------------------------------
-- 0008 завела training_opt_in с default true — согласие на обучение включалось молча, без действия
-- пользователя. privacy-policy.ru.md §7 и data-map.md требуют отдельного явного согласия отдельной галочкой
-- в онбординге (WelcomeScreen.tsx, TRAINING_CONSENT_CHECKBOX в lib/consent.ts). Новый дефолт — false.
alter table lithos.users alter column training_opt_in set default false;

-- В проде сейчас один пользователь (создан до этой правки), отдельного согласия на обучение он не давал —
-- молчаливое true, которое проставила 0008, приводим к false. Это движение в сторону приватности: ложное
-- "да" заменяется на честное "нет", а не наоборот. Идемпотентно — повторный запуск ничего не меняет, если
-- строк с true (не подтверждённых явно) уже не осталось.
update lithos.users set training_opt_in = false where training_opt_in = true;

comment on column lithos.users.training_opt_in is
  'Согласие на обучение модели — отдельная цель обработки (privacy-policy.ru.md §7), отдельное явное согласие '
  '(галочка в онбординге, WelcomeScreen.tsx, не отмечена по умолчанию). Default false с 0009; 0008 по ошибке '
  'заводила default true.';

-- ---- Замечание 3: удаление на сервере — файлы Storage раньше строк БД -------------------------------------
-- Было (0008): delete_my_data() удаляет строки И возвращает пути к файлам одним вызовом; клиент удаляет
-- файлы Storage вторым, отдельным шагом. Если сеть оборвётся между шагами, пути потеряны навсегда — строки
-- уже удалены, узнать, что стирать в Storage, больше неоткуда: файлы становятся вечными сиротами, хотя
-- SERVER_WIPE_DIALOG обещает пользователю, что снимки исчезнут безвозвратно.
--
-- Стало: два вызова в другом порядке.
--   1. lithos.list_my_photo_paths() — только читает пути, ничего не удаляет. Клиент (lib/profile.ts
--      #deleteServerData) стирает объекты Storage по этим путям.
--   2. lithos.delete_my_data() — удаляет строки (cascade), только после того как Storage подтвердил удаление.
-- Обе функции читают current_user_id() заново при каждом вызове и не завязаны на состояние друг друга —
-- поэтому обрыв сети на любом шаге не теряет данные: повторный вызов deleteServerData() с шага 1 либо снова
-- получит те же пути (если строки ещё не удалены), либо list вернёт пустой список (строки уже удалены, файлы
-- пришлось удалить раньше) и шаг 2 благополучно завершит операцию. Итог всегда сходится к "ничего не осталось".

create or replace function lithos.list_my_photo_paths()
returns table(storage_path text)
language plpgsql security definer set search_path = lithos, public as $$
declare
  v_user uuid := lithos.current_user_id();
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  return query
    select sp.storage_path
    from lithos.scan_photos sp
    join lithos.scans s on s.id = sp.scan_id
    where s.user_id = v_user;
end $$;
grant execute on function lithos.list_my_photo_paths() to authenticated;

-- Возвращаемый тип меняется (table(storage_path text) -> void) — create or replace такое не позволяет,
-- пересоздаём функцию явно. drop ... if exists делает файл безопасным для повторного запуска.
drop function if exists lithos.delete_my_data();

create function lithos.delete_my_data()
returns void
language plpgsql security definer set search_path = lithos, public as $$
declare
  v_user uuid := lithos.current_user_id();
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  -- lithos.scans/scan_photos/scan_results/cards/diary удаляются каскадом по FK на users(id) (0001_schema_init.sql),
  -- как и в 0008 — здесь меняется только порядок вызовов со стороны клиента, не сама схема каскада.
  delete from lithos.users where id = v_user;
end $$;
grant execute on function lithos.delete_my_data() to authenticated;
