// T7.1, поток C — чистые функции отбора и сборки манифеста обучающего набора. Без сети и без БД:
// dataset-export.mjs (CLI) достаёт строки из lithos.* и передаёт их сюда как простые объекты.
// Формат манифеста — по образцу supabase/seed/golden/labels.json (version + items), чтобы эталонный и
// собранный наборы читались похожим кодом. Правила отбора — docs/tasks/T7.1-own-model-groundwork.md §3.

export const MANIFEST_VERSION = 1;
export const PHOTO_BUCKET = 'lithos-photos';

/** Стадии, которые могут нести финальный вердикт породы; порядок — приоритет (эскалация перекрывает main). */
const VERDICT_STAGE_PRIORITY = ['escalation', 'main', 'gate'];

function toTime(v) {
  if (v instanceof Date) return v.getTime();
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Из всех меток скана выбирает одну — самую свежую (created_at desc, при равенстве — id asc для
 * детерминизма). Ровно одна метка на скан переносится в манифест: два несовпадающих человеческих
 * вердикта на один скан (confirm, потом correct) не должны давать две конфликтующие записи.
 */
export function pickLabel(labels) {
  if (!labels || labels.length === 0) return null;
  return [...labels].sort((a, b) => {
    const byDate = toTime(b.createdAt) - toTime(a.createdAt);
    if (byDate !== 0) return byDate;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

/**
 * Из всех результатов ступеней скана выбирает тот, что нёс финальный вердикт породы: эскалация важнее
 * main важнее gate (gate вообще не определяет породу, но на всякий случай в приоритете последний).
 * Ступени вне VERDICT_STAGE_PRIORITY (preflight/rules/done/failed) не несут происхождения вердикта.
 */
export function pickVerdict(scanResults) {
  if (!scanResults || scanResults.length === 0) return null;
  const candidates = scanResults.filter((r) => VERDICT_STAGE_PRIORITY.includes(r.stage));
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const pa = VERDICT_STAGE_PRIORITY.indexOf(a.stage);
    const pb = VERDICT_STAGE_PRIORITY.indexOf(b.stage);
    if (pa !== pb) return pa - pb;
    const byDate = toTime(b.createdAt) - toTime(a.createdAt);
    if (byDate !== 0) return byDate;
    return String(a.stage).localeCompare(String(b.stage));
  })[0];
}

/**
 * Жёсткие правила отбора (T7.1 §3, обещания политики раздел 7 — не пожелания):
 *  - training_opt_in = true на момент выгрузки (отозвавший согласие исчезает из будущих выборок);
 *  - есть подтверждённая метка (lithos.labels) — голый вердикт модели без неё не проходит;
 *  - карточка существует, не скрыта и не на ревью.
 */
export function isEligible(record) {
  return Boolean(
    record &&
      record.trainingOptIn === true &&
      record.label != null &&
      record.card != null &&
      record.card.hidden !== true &&
      record.card.verification !== 'pending_review',
  );
}

/** Отбирает записи, годные для обучающей выборки, из всех нормализованных сканов. */
export function selectForExport(records) {
  return (records ?? []).filter(isEligible);
}

/** Имя файла в выгрузке: <scan_id>/<исходное_имя>, без user_id из storage_path — выгрузка не должна лишний раз нести привязку к аккаунту. */
export function photoRelativePath(scanId, photo) {
  const base = String(photo.storagePath).split('/').pop() || `${photo.id}.jpg`;
  return `${scanId}/${base}`;
}

/** Один элемент манифеста для уже отобранной (eligible) записи. Поля — как в golden labels.json, где это осмысленно. */
export function toManifestItem(record) {
  const photos = [...record.photos].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
  const files = photos.map((p) => photoRelativePath(record.scanId, p));
  return {
    id: record.scanId,
    file: files[0] ?? null,
    photos: files,
    rock_class: record.label.rockClass,
    label_source: record.label.source,
    matched_model: record.label.matchedModel === true,
    verdict: record.verdict
      ? {
          provider: record.verdict.provider ?? null,
          model: record.verdict.model ?? null,
          prompt_version: record.verdict.promptVersion ?? null,
        }
      : null,
  };
}

/**
 * Манифест выгрузки. Чисто: не читает часы и не трогает сеть — generatedAt передаёт вызывающий код.
 * Порядок items — по id, чтобы два прогона на одних и тех же данных давали побайтово одинаковый JSON
 * независимо от порядка строк, в котором их вернула БД.
 */
export function buildManifest(records, opts = {}) {
  const version = opts.version ?? MANIFEST_VERSION;
  const generatedAt = opts.generatedAt ?? new Date(0).toISOString();
  const items = (records ?? [])
    .map(toManifestItem)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { version, generated_at: generatedAt, items };
}

/**
 * Счётчик готовности: подтверждённые фотографии по породам + общее число + число сканов.
 * consentedUsers считает вызывающий код отдельным запросом (это не про фото, а про всех пользователей
 * с training_opt_in = true, включая тех, у кого ещё нет подтверждённых меток) — сюда передаётся готовым.
 */
export function computeReadiness(records, consentedUsers = 0) {
  const eligible = selectForExport(records);
  const byRockClass = {};
  let totalPhotos = 0;
  for (const r of eligible) {
    const rock = r.label.rockClass;
    const n = r.photos.length;
    byRockClass[rock] = (byRockClass[rock] ?? 0) + n;
    totalPhotos += n;
  }
  return { byRockClass, totalPhotos, scans: eligible.length, consentedUsers };
}

/** Нормализует одну строку SQL-запроса (json_agg меток/фото/результатов ступеней) в объект для правил выше. */
export function normalizeRow(row) {
  const labels = (row.labels ?? []).map((l) => ({
    id: l.id,
    rockClass: l.rock_class,
    source: l.source,
    matchedModel: l.matched_model,
    createdAt: l.created_at,
  }));
  const photos = (row.photos ?? []).map((p) => ({
    id: p.id,
    storagePath: p.storage_path,
    isPrimary: p.is_primary === true,
  }));
  const scanResults = (row.scan_results ?? []).map((r) => ({
    stage: r.stage,
    provider: r.provider,
    model: r.model,
    promptVersion: r.prompt_version,
    createdAt: r.created_at,
  }));
  return {
    scanId: row.scan_id,
    userId: row.user_id,
    scanCreatedAt: row.scan_created_at,
    trainingOptIn: row.training_opt_in === true,
    card:
      row.card_id != null
        ? { hidden: row.card_hidden === true, verification: row.card_verification }
        : null,
    label: pickLabel(labels),
    photos,
    verdict: pickVerdict(scanResults),
  };
}
