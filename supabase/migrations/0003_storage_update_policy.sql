-- ============================================================================
-- LITHOS — 0003 storage: политика UPDATE для lithos-photos (T1.4). Идемпотентно.
-- Клиент грузит фото с upsert=true (повтор того же scan_id перезаписывает объект),
-- storage-api при существующем объекте делает UPDATE storage.objects → нужна политика
-- с тем же предикатом «своя папка <user_id>/…», что и у insert/select (0002).
-- ============================================================================
drop policy if exists "lithos photos update own" on storage.objects;
create policy "lithos photos update own" on storage.objects for update to authenticated
  using (bucket_id = 'lithos-photos' and (storage.foldername(name))[1] = lithos.current_user_id()::text)
  with check (bucket_id = 'lithos-photos' and (storage.foldername(name))[1] = lithos.current_user_id()::text);
