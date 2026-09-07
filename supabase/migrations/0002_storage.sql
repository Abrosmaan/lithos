-- ============================================================================
-- LITHOS — 0002 storage bucket lithos-photos (private) + политики. Идемпотентно.
-- Путь объекта: <user_id>/<scan_id>/<n>.jpg — владелец пишет/читает только свою папку.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lithos-photos', 'lithos-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "lithos photos insert own" on storage.objects;
create policy "lithos photos insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'lithos-photos' and (storage.foldername(name))[1] = lithos.current_user_id()::text);

drop policy if exists "lithos photos select own" on storage.objects;
create policy "lithos photos select own" on storage.objects for select to authenticated
  using (bucket_id = 'lithos-photos' and (storage.foldername(name))[1] = lithos.current_user_id()::text);
