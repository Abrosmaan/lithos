-- ============================================================================
-- LITHOS — 0010 сужение прав на функции витрины (правка по ревью потока D).
-- Идемпотентно, schema-qualified. 0007 уже применена, править её нельзя.
--
-- Дефект: Postgres по умолчанию выдаёт EXECUTE на новую функцию роли PUBLIC, а 0007 (в отличие от 0005)
-- не отзывала это право. lithos.public_photo_path не проверяет current_user_id() — значит вызывающий
-- с одним лишь публичным anon-ключом, без сессии, мог получить storage_path любой опубликованной карточки.
-- Путь по формату 0002 содержит user_id/scan_id владельца, то есть анонимно утекали идентификаторы.
-- Само фото оставалось защищено (политика storage.objects выдана только authenticated), но требование
-- T6.0 §2.2 «наружу только authenticated» нарушалось.
--
-- publish_card и report_card эксплуатировать было нельзя (обе проверяют current_user_id() и падают
-- «not authenticated»), но право отзывается и у них — по тому же принципу, что в 0005.
-- ============================================================================

revoke all on function lithos.public_photo_path(uuid) from public;
revoke all on function lithos.publish_card(uuid, boolean) from public;
revoke all on function lithos.report_card(uuid, text) from public;

-- Повторно, чтобы файл был самодостаточен: право на вызов есть только у вошедшего пользователя.
grant execute on function lithos.public_photo_path(uuid) to authenticated;
grant execute on function lithos.publish_card(uuid, boolean) to authenticated;
grant execute on function lithos.report_card(uuid, text) to authenticated;
