-- ============================================================================
-- LITHOS — 0015 чтение собственной метки (T7.1, поток B). Идемпотентно, schema-qualified.
--
-- Повод: 0013/0014 умеют только писать метку (lithos.record_label). У lithos.labels нет ни одной
-- политики чтения и нет table-level грантов authenticated/anon (0013, комментарий у
-- `alter table lithos.labels enable row level security`) — читают только security definer функции и
-- service_role. Экрану карточки (поток B) нужно после перезапуска приложения показать «вы подтвердили»
-- или «вы указали другую породу» по факту своей метки — а не по lithos.cards.verification, которую
-- record_label намеренно не трогает (T7.1-A, «Правки после ревью»: самоподтверждение — не community).
-- Прочитать эту метку сейчас нечем, эта миграция добавляет ровно одну функцию для этого.
--
-- Возвращает только собственные строки: фильтр author_id = lithos.current_user_id() внутри функции,
-- а не RLS-политика на таблице — таблица как была без политик, так и остаётся (образец lithos.limits/
-- lithos.reports, 0013). security definer + set search_path (в стиле record_label/enqueue_scan),
-- revoke от public и явный grant execute только authenticated — anon вызвать не может.
-- ============================================================================

create or replace function lithos.list_my_labels(p_scan_id uuid)
returns table(source lithos.label_source, rock_class text, matched_model boolean, created_at timestamptz)
language sql stable security definer set search_path = lithos, public as $$
  select source, rock_class, matched_model, created_at
  from lithos.labels
  where scan_id = p_scan_id and author_id = lithos.current_user_id()
  order by created_at desc
$$;

comment on function lithos.list_my_labels(uuid) is
  'Собственные метки автора по скану (T7.1, поток B) — 0, 1 или 2 строки: не более одной на '
  '(user_confirm, user_correct), см. unique(scan_id, source, author_id) в 0013. Строго свои строки: фильтр '
  'author_id = current_user_id() внутри функции. Чужую метку этой функцией прочитать нельзя — у другого '
  'скана current_user_id() вызывающего не совпадёт с author_id чужой строки ни при каком p_scan_id. '
  'У анонима current_user_id() = null, author_id = null никогда не равен (null <> null в SQL) — но анониму '
  'функция и так не выдана execute (см. grant ниже).';

revoke all on function lithos.list_my_labels(uuid) from public;
grant execute on function lithos.list_my_labels(uuid) to authenticated;
