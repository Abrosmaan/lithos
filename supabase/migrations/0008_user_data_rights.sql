-- ============================================================================
-- LITHOS — 0008 user data rights (T6.1 поток F, compliance). Право владельца удалить свои данные на
-- сервере и управлять согласием на обучение модели (data-map.md «Права пользователя»). Идемпотентно,
-- schema-qualified.
-- ============================================================================

-- ---- lithos.users: согласие на обучение модели (consent-copy.md §6b) ----------------------------------
alter table lithos.users add column if not exists training_opt_in boolean not null default true;

-- Владелец может переключать только своё согласие — остальные колонки users закрыты 0006_column_grants.sql
-- (там же revoke update on lithos.users from authenticated; этот grant дополняет уже выданный на display_name).
grant update (training_opt_in) on lithos.users to authenticated;

-- ---- RPC: удалить все данные текущего пользователя на сервере (T6.0 часть 3, п.6) ----------------------
-- Что удаляется и как:
--   lithos.scans        — cascade по scans.user_id -> users(id) (0001_schema_init.sql)
--   lithos.scan_photos  — cascade по scan_photos.scan_id -> scans(id)
--   lithos.scan_results — cascade по scan_results.scan_id -> scans(id)
--   lithos.cards        — cascade и по cards.user_id -> users(id), и по cards.scan_id -> scans(id)
--                          (публикация — это просто cards.published; удаляется вместе с карточкой)
--   lithos.diary        — cascade по diary.user_id -> users(id)
-- Самоссылка cards.parent_card_id (раскол) не мешает: все карточки пользователя удаляются в одном каскаде
-- от lithos.users, и FK-проверка NO ACTION выполняется по завершении всей операции, а не построчно.
--
-- Storage: SQL не может удалить объекты бакета (storage.objects — не источник истины для файлов Storage API),
-- поэтому RPC возвращает пути ДО удаления строк scan_photos — клиент обязан вызвать
-- supabase.storage.from('lithos-photos').remove(paths) после успешного вызова (lib/profile.ts#deleteServerData).
create or replace function lithos.delete_my_data()
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

  delete from lithos.users where id = v_user;
end $$;
grant execute on function lithos.delete_my_data() to authenticated;
