-- ============================================================================
-- LITHOS — 0012 добор к 0010/0011: функции, созданные до включения default privileges.
-- Идемпотентно, schema-qualified.
--
-- 0011 отзывает EXECUTE у PUBLIC только для функций, создаваемых после неё. Функции из 0001 и 0009
-- создавались раньше и право у PUBLIC сохранили — проверено запросом has_function_privilege('anon', …).
-- Эксплуатировать их анонимно нельзя (все три опираются на lithos.current_user_id(), который у анонима
-- пуст: delete_my_data ничего не находит, list_my_photo_paths отдаёт пустоту, enqueue_scan не проходит
-- проверку владельца), но право у роли, которой оно не нужно, — тот же класс дефекта, что чинила 0010.
--
-- Намеренно НЕ трогаем:
--   lithos.current_user_id() — вызывается из RLS-политик от лица запрашивающей роли; отзыв у PUBLIC без
--     компенсирующих грантов каждой роли сломал бы доступ к собственным данным. Функция возвращает только
--     идентификатор самого вызывающего (у анонима — null), утечки в ней нет.
--   lithos.scans_apply_limit(), lithos.set_updated_at() — триггерные функции; Postgres не проверяет EXECUTE
--     при срабатывании триггера, а лишний отзыв здесь только добавил бы риск без выигрыша.
-- ============================================================================

revoke all on function lithos.delete_my_data() from public;
revoke all on function lithos.list_my_photo_paths() from public;
revoke all on function lithos.enqueue_scan(uuid, text) from public;

grant execute on function lithos.delete_my_data() to authenticated;
grant execute on function lithos.list_my_photo_paths() to authenticated;
grant execute on function lithos.enqueue_scan(uuid, text) to authenticated;
