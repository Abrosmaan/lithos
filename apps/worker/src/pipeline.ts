// Конвейер S0–S4 (dev-plan T2.1, ai-pipeline §3, §4, §7) + серверная часть раскола (T2.3, spec §7).
//
//   S0 Preflight  фото из Storage → нормализация → резкость → pHash → дедуп за 24 ч (Хэмминг ≤ 6 → копия карточки)
//   S1 Gate       1 фото (is_primary | самое резкое) → not_rock / blurry / dark / too_far / screen_photo → failed
//   S2 Main       до 3 фото + GeoContext + user_tests → ScanResult; сразу предварительная карточка, если нужен S3
//   S3 Escalation только по escalationTriggers из shared (+ очередь scan_dispute); пропускается при fallback
//   S4 Rules      computeScore из shared, clampTier при fallback, geo_anomaly → pending_review, cards upsert, diary
//
// Идемпотентность: перед каждой ступенью — scan_results(scan_id, stage); есть — модель не вызывается.
// Запись ответа модели и scans.stage — одна транзакция (repo). Повторное сообщение по done/failed — no-op.
import {
  FALLBACK_MAX_TIER,
  GateResultSchema,
  ScanResultSchema,
  clampTier,
  computeScore,
  escalationTriggers,
  finalSplitRecommendation,
  hasGeology,
  scoredInclusions,
  type EscalationTrigger,
  type GateResult,
  type GeoContext,
  type ScanQueue,
  type ScanResult,
  type ScanStage,
  type UserTests,
} from '@lithos/shared';
import type { z } from 'zod';
import { LlmUnavailableError, type CallModelInput, type CallModelOutput } from './llm/index.js';
import { PIPELINE, type ScanErrorCode } from './pipeline/constants.js';
import { hammingDistance, normalizeImage, perceptualHash, sharpness, type NormalizedImage } from './pipeline/images.js';
import { cardName } from './pipeline/naming.js';
import {
  PhotoUnavailableError,
  type CardRow,
  type CardUpsert,
  type ModelStageRawJson,
  type PhashHitRawJson,
  type PhotoRow,
  type PipelineDeps,
  type RunOutcome,
  type ScanRow,
  type StageResultRow,
} from './pipeline/types.js';

export type { PipelineDeps, RunOutcome } from './pipeline/types.js';

/** Триггеры S3: из shared + «пользователь оспорил» (очередь scan_dispute, ai-pipeline §3 S3). */
export type PipelineTrigger = EscalationTrigger | 'dispute';
export type EscalationStatus = 'none' | 'done' | 'pending' | 'skipped_fallback' | 'failed';

interface PreparedPhoto {
  row: PhotoRow;
  image: NormalizedImage;
  sharpness: number;
  phash: string;
}

interface StageOutcome<T> {
  result: T;
  usedFallback: boolean;
  provider: string | null;
  promptVersion: string | null;
  cached: boolean;
}

class ScanRejected extends Error {
  constructor(readonly code: ScanErrorCode) {
    super(`scan rejected: ${code}`);
    this.name = 'ScanRejected';
  }
}

/** S1: код отказа по GateResult (ai-pipeline §3 S1). multiple_objects один не останавливает (в §3 нет такого решения). */
export function gateRejection(gate: GateResult): ScanErrorCode | null {
  if (!gate.is_rock) return 'not_rock';
  if (gate.quality !== 'ok') return gate.quality;
  return null;
}

/** Раскол (T2.3): после ответа модели поверхность принудительно fresh_split — интерьер по определению свежий. */
export function applyOverrides(result: ScanResult, isSplit: boolean): ScanResult {
  return isSplit && result.surface !== 'fresh_split' ? { ...result, surface: 'fresh_split' } : result;
}

/** Гейт получает одно фото: is_primary от клиента (самое резкое по его метрике), иначе максимум нашей резкости. */
export function pickGatePhoto(photos: PreparedPhoto[]): PreparedPhoto {
  const primary = photos.find((p) => p.row.is_primary);
  if (primary) return primary;
  return photos.reduce((best, p) => (p.sharpness > best.sharpness ? p : best));
}

function parseRaw<S extends z.ZodTypeAny>(row: StageResultRow, schema: S): StageOutcome<z.infer<S>> {
  const raw = row.raw_json as Partial<ModelStageRawJson> | null;
  const parsed = schema.safeParse(raw?.result);
  if (!parsed.success) throw new Error(`scan_results(${row.scan_id}, ${row.stage}): stored result does not match schema`);
  return {
    result: parsed.data,
    usedFallback: raw?.meta?.used_fallback === true,
    provider: row.provider,
    promptVersion: row.prompt_version,
    cached: true,
  };
}

export function createPipeline(deps: PipelineDeps) {
  const { repo, photos: store, log } = deps;

  /** Ступень с моделью: scan_results есть → без вызова; иначе вызов → insert (do nothing) + scans.stage в одной tx. */
  async function modelStage<S extends z.ZodTypeAny>(
    scan: ScanRow,
    stage: Extract<ScanStage, 'gate' | 'main' | 'escalation'>,
    schema: S,
    input: Omit<CallModelInput, 'stage' | 'scanId'>,
    next: (result: z.infer<S>) => { stage: ScanStage; error?: ScanErrorCode | null },
  ): Promise<StageOutcome<z.infer<S>>> {
    const t0 = deps.now();
    const existing = await repo.getStageResult(scan.id, stage);
    if (existing) {
      const out = parseRaw(existing, schema);
      log.info('pipeline stage', { scan_id: scan.id, stage, ms: deps.now() - t0, cached: true });
      return out;
    }
    const out: CallModelOutput = await deps.callModel({ ...input, stage, scanId: scan.id });
    const result = schema.parse(out.result) as z.infer<S>;
    const raw: ModelStageRawJson = {
      result: out.result,
      meta: { used_fallback: out.usedFallback, fallback_reason: out.fallbackReason, repaired: out.repaired, attempts: out.attempts },
    };
    const transition = next(result);
    await repo.saveStageResult(
      {
        scan_id: scan.id,
        stage,
        provider: out.provider,
        model: out.model,
        prompt_version: out.promptVersion,
        raw_json: raw,
        tokens_in: out.tokensIn,
        tokens_out: out.tokensOut,
        cost_usd: out.costUsd,
        latency_ms: out.latencyMs,
      },
      transition,
    );
    log.info('pipeline stage', {
      scan_id: scan.id,
      stage,
      ms: deps.now() - t0,
      cached: false,
      provider: out.provider,
      used_fallback: out.usedFallback,
      cost_usd: Number(out.costUsd.toFixed(6)),
      next: transition.stage,
      error: transition.error ?? null,
    });
    return { result, usedFallback: out.usedFallback, provider: out.provider, promptVersion: out.promptVersion, cached: false };
  }

  // ---- S0 -------------------------------------------------------------------------
  async function preparePhoto(row: PhotoRow): Promise<PreparedPhoto> {
    const bytes = await store.download(row.storage_path);
    let image: NormalizedImage;
    let sharp: number;
    let phash: string;
    try {
      image = await normalizeImage(bytes);
      [sharp, phash] = await Promise.all([sharpness(image.bytes), row.phash ?? perceptualHash(image.bytes)]);
    } catch (e) {
      throw new PhotoUnavailableError(row.storage_path, `image decode failed: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
    }
    if (!row.phash) await repo.setPhotoHash(row.id, phash);
    return { row, image, sharpness: sharp, phash };
  }

  /** Фото скачиваются параллельно. Битое/пропавшее фото среди нескольких — пропускаем; нет ни одного — стоп без retry. */
  async function preparePhotos(scan: ScanRow): Promise<PreparedPhoto[]> {
    const rows = await repo.loadPhotos(scan.id);
    if (rows.length === 0) throw new PhotoUnavailableError('', 'scan has no photos');
    const settled = await Promise.allSettled(rows.map(preparePhoto));
    const out: PreparedPhoto[] = [];
    let firstUnavailable: PhotoUnavailableError | null = null;
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        out.push(r.value);
      } else if (r.reason instanceof PhotoUnavailableError) {
        firstUnavailable ??= r.reason;
        log.warn('pipeline: photo skipped', { scan_id: scan.id, path: r.reason.storagePath, error: r.reason.message.slice(0, 200) });
      } else {
        throw r.reason; // временная ошибка Storage после retry → повтор через очередь
      }
    }
    if (out.length === 0) throw firstUnavailable ?? new PhotoUnavailableError('', 'no usable photos');
    return out;
  }

  async function findPhashHit(scan: ScanRow, photos: PreparedPhoto[]): Promise<{ scanId: string; distance: number } | null> {
    const candidates = await repo.findRecentHashedPhotos(scan.user_id, scan.id, PIPELINE.phashWindowHours);
    let best: { scanId: string; distance: number } | null = null;
    for (const c of candidates) {
      for (const p of photos) {
        const d = hammingDistance(p.phash, c.phash);
        if (d <= PIPELINE.phashMaxDistance && (best === null || d < best.distance)) best = { scanId: c.scan_id, distance: d };
      }
    }
    return best;
  }

  /** pHash-попадание: копия карточки прошлого скана, cost 0, модели не вызываются (ai-pipeline §3 S0, §8 п.1). */
  async function copyFromHit(scan: ScanRow, hit: { scanId: string; distance: number }, source: CardRow): Promise<CardRow> {
    const raw: PhashHitRawJson = { phash_hit: true, source_scan_id: hit.scanId, source_card_id: source.id, distance: hit.distance };
    await repo.saveStageResult(
      { scan_id: scan.id, stage: 'preflight', provider: 'phash_cache', model: null, prompt_version: null, raw_json: raw, tokens_in: 0, tokens_out: 0, cost_usd: 0, latency_ms: 0 },
      { stage: 'rules' },
    );
    const card: CardUpsert = {
      scan_id: scan.id,
      user_id: scan.user_id,
      rock_class: source.rock_class,
      tier: source.tier,
      score: source.score,
      score_breakdown: { ...source.score_breakdown, phash_hit: { source_scan_id: hit.scanId, source_card_id: source.id, distance: hit.distance } },
      inclusions: source.inclusions,
      shape: source.shape,
      lore: source.lore,
      name: source.name,
      state: source.state,
      parent_card_id: source.parent_card_id,
      verification: source.verification,
      provisional: source.provisional,
      cell_id: source.cell_id,
      lat: source.lat,
      lng: source.lng,
    };
    // Дневник не трогаем: находка уже учтена исходным сканом.
    const saved = await repo.upsertCard(card, { scanStage: 'done' });
    log.info('pipeline stage', { scan_id: scan.id, stage: 'preflight', phash_hit: true, source_scan_id: hit.scanId, distance: hit.distance, card_id: saved.id });
    return saved;
  }

  // ---- S4 -------------------------------------------------------------------------
  interface RulesInput {
    scan: ScanRow;
    result: ScanResult;
    geo: GeoContext | null;
    tests: UserTests | null;
    usedFallback: boolean;
    provider: string | null;
    promptVersion: string | null;
    triggers: PipelineTrigger[];
    escalation: EscalationStatus;
    parent: CardRow | null;
    lat: number | null;
    lng: number | null;
  }

  async function rules(input: RulesInput): Promise<CardRow> {
    const t0 = deps.now();
    const { scan, result, geo, tests, parent } = input;
    const outcome = computeScore(result, geo, tests);
    const escalationFailed = input.escalation === 'failed';
    const provisional = input.usedFallback || escalationFailed;
    const tier = input.usedFallback && outcome.tier ? clampTier(outcome.tier, FALLBACK_MAX_TIER) : outcome.tier;
    const isSplit = parent !== null;
    const splitDelta = isSplit && outcome.score !== null && parent.score !== null ? outcome.score - parent.score : null;

    const card: CardUpsert = {
      scan_id: scan.id,
      user_id: scan.user_id,
      rock_class: result.rock_class.primary,
      tier,
      score: outcome.score,
      score_breakdown: {
        ...outcome.breakdown,
        wanderer: outcome.wanderer,
        geo_anomaly: outcome.geo_anomaly,
        has_geo: outcome.has_geo,
        internal_score: outcome.internal_score,
        internal_tier: outcome.internal_tier,
        tier_clamped: tier !== outcome.tier,
        ...(isSplit ? { split_from: parent.id, split_delta: splitDelta } : {}),
        meta: {
          triggers: input.triggers,
          escalation: input.escalation,
          fallback: input.usedFallback,
          provider: input.provider,
          prompt_version: input.promptVersion,
          geo_source: geo?.source ?? null,
          split_recommendation: { recommended: finalSplitRecommendation(result), reason: result.split_recommendation.reason },
          alternatives: result.rock_class.alternatives,
          confidence: result.rock_class.confidence,
          flags: result.flags,
          revision_note: result.revision_note,
        },
      },
      // Состав карточки — только включения, прошедшие порог (ai-pipeline §3 S4 «отсечение включений < 0.6»).
      inclusions: scoredInclusions(result).map((i) => ({ mineral: i.mineral, extent: i.extent, confidence: i.confidence, location: i.location, evidence: i.evidence })),
      shape: { ...result.shape, surface: result.surface },
      lore: result.lore,
      name: cardName(result.rock_class.primary, geo),
      state: isSplit ? 'opened' : 'closed',
      parent_card_id: parent?.id ?? null,
      verification: outcome.geo_anomaly ? 'pending_review' : 'ai',
      provisional,
      cell_id: geo?.cell_id || null,
      lat: input.lat,
      lng: input.lng,
    };
    const pending = input.escalation === 'pending';
    const primary = result.rock_class.primary;
    const diary =
      hasGeology(geo) && geo.cell_id
        ? {
            user_id: scan.user_id,
            cell_id: geo.cell_id,
            expected: geo.expected_rocks.map((r) => r.rock_class),
            found: primary === 'unknown' || primary.startsWith('unknown_') ? null : primary,
          }
        : null;
    const saved = await repo.upsertCard(card, {
      scanStage: pending ? 'escalation' : 'done',
      hideCardId: isSplit && !pending ? parent.id : null,
      diary: pending ? null : diary,
    });
    log.info('pipeline stage', {
      scan_id: scan.id,
      stage: 'rules',
      ms: deps.now() - t0,
      card_id: saved.id,
      rock_class: primary,
      tier,
      score: outcome.score,
      provisional,
      escalation: input.escalation,
      geo_anomaly: outcome.geo_anomaly,
      split: isSplit,
      split_delta: splitDelta,
    });
    return saved;
  }

  // ---- цепочка ----------------------------------------------------------------------
  async function runScan(scanId: string, queue: ScanQueue): Promise<RunOutcome> {
    const t0 = deps.now();
    const done = (status: RunOutcome['status'], reason: string | null, cardId: string | null = null): RunOutcome => ({
      status,
      scanId,
      queue,
      reason,
      cardId,
      ms: deps.now() - t0,
    });

    const scan = await repo.loadScan(scanId);
    if (!scan) {
      log.warn('pipeline: scan not found', { scan_id: scanId, queue });
      return done('skipped', 'scan_not_found');
    }
    const isDispute = queue === 'scan_dispute';
    if (scan.stage === 'failed') return done('skipped', 'already_failed');
    if (scan.stage === 'done' && !isDispute) return done('skipped', 'already_done');
    if (scan.stage === 'done' && (await repo.getStageResult(scan.id, 'escalation'))) return done('skipped', 'already_escalated');

    // Эксклюзивная обработка scan_id: истёкший lease при живой задаче, повторный enqueue, dispute во время
    // интерактивной обработки — второй процесс не должен платить за ту же ступень.
    const lock = await repo.tryLockScan(scan.id);
    if (!lock) {
      log.warn('pipeline: scan is being processed elsewhere, deferring', { scan_id: scan.id, queue });
      return done('deferred', 'locked');
    }
    try {
      return await runLocked(scan, queue, isDispute, done);
    } finally {
      await lock.release().catch((e) => log.warn('pipeline: lock release failed', { scan_id: scan.id, error: String(e).slice(0, 200) }));
    }
  }

  async function runLocked(
    scan: ScanRow,
    queue: ScanQueue,
    isDispute: boolean,
    done: (status: RunOutcome['status'], reason: string | null, cardId?: string | null) => RunOutcome,
  ): Promise<RunOutcome> {
    const t0 = deps.now();
    try {
      // Раскол: гео и тесты — от родителя (T2.3).
      let parent: CardRow | null = null;
      if (scan.parent_card_id) {
        parent = await repo.loadCard(scan.parent_card_id);
        if (!parent) throw new ScanRejected('parent_not_found');
      }
      const isSplit = parent !== null;
      let tests = scan.user_tests;
      let lat = scan.lat;
      let lng = scan.lng;
      if (parent) {
        const parentScan = await repo.loadScan(parent.scan_id);
        tests = parentScan?.user_tests ?? scan.user_tests;
        lat = parent.lat ?? scan.lat;
        lng = parent.lng ?? scan.lng;
      }

      // S0
      const s0 = deps.now();
      const photos = await preparePhotos(scan);
      if (scan.stage === 'preflight') await repo.setScanStage(scan.id, { stage: 'gate' });
      log.info('pipeline stage', { scan_id: scan.id, stage: 'preflight', ms: deps.now() - s0, photos: photos.length });

      // Гео не зависит от Gate — параллельно (getGeoContext не бросает, деградирует до source='none').
      const geoPromise: Promise<GeoContext | null> = lat != null && lng != null ? deps.getGeoContext(lat, lng) : Promise.resolve(null);

      const alreadyAnalysed = (await repo.getStageResult(scan.id, 'main')) !== null;
      if (!isSplit && !isDispute && !alreadyAnalysed) {
        const hit = await findPhashHit(scan, photos);
        const source = hit ? await repo.loadCardByScan(hit.scanId) : null;
        if (hit && source) {
          await geoPromise;
          const card = await copyFromHit(scan, hit, source);
          return done('done', 'phash_hit', card.id);
        }
      }

      // S1
      const gatePhoto = pickGatePhoto(photos);
      const gate = await modelStage(scan, 'gate', GateResultSchema, { images: [gatePhoto.image], userLanguage: PIPELINE.userLanguage }, (g) => {
        const code = gateRejection(g);
        return code ? { stage: 'failed', error: code } : { stage: 'main' };
      });
      const rejection = gateRejection(gate.result);
      if (rejection) {
        await geoPromise;
        log.info('pipeline: gate rejected', { scan_id: scan.id, error: rejection, multiple_objects: gate.result.multiple_objects });
        return done('failed', rejection);
      }
      if (gate.result.multiple_objects) log.warn('pipeline: gate flagged multiple objects, continuing', { scan_id: scan.id });

      // S2
      const geo = await geoPromise;
      const images = photos.slice(0, PIPELINE.maxMainImages).map((p) => p.image);
      const mainInput = {
        images,
        geo,
        userTests: tests,
        userLanguage: PIPELINE.userLanguage,
        // Индекс масштабного фото клиент не хранит (только флаг) — не утверждаем, что это именно фото 1.
        scaleObject: tests?.has_scale_photo ? 'coin or finger (in one of the photos, not necessarily photo 1)' : null,
      } satisfies Omit<CallModelInput, 'stage' | 'scanId'>;
      const main = await modelStage(scan, 'main', ScanResultSchema, mainInput, () => ({ stage: 'rules' }));
      let result = applyOverrides(main.result, isSplit);
      let usedFallback = main.usedFallback;
      let provider = main.provider;
      let promptVersion = main.promptVersion;

      // S3
      const prelim = computeScore(result, geo, tests);
      const triggers: PipelineTrigger[] = [...escalationTriggers(result, prelim.internal_tier, geo), ...(isDispute ? (['dispute'] as const) : [])];
      let escalation: EscalationStatus = 'none';
      if (triggers.length > 0 && usedFallback) {
        escalation = 'skipped_fallback'; // ai-pipeline §7: через fallback S3 не идёт
        log.info('pipeline: escalation skipped (fallback)', { scan_id: scan.id, triggers });
      } else if (triggers.length > 0) {
        const base = { scan, geo, tests, provider, promptVersion, triggers, parent, lat, lng };
        if (!(await repo.getStageResult(scan.id, 'escalation'))) {
          // Промежуточный ответ (ai-pipeline §4): карточка по S2 сразу, scans.stage='escalation' → клиент показывает «уточняем».
          await rules({ ...base, result, usedFallback, escalation: 'pending' });
        }
        try {
          const esc = await modelStage(scan, 'escalation', ScanResultSchema, { ...mainInput, priorResult: result }, () => ({ stage: 'rules' }));
          result = applyOverrides(esc.result, isSplit);
          usedFallback = usedFallback || esc.usedFallback;
          provider = esc.provider;
          promptVersion = esc.promptVersion;
          escalation = 'done';
        } catch (e) {
          if (!(e instanceof LlmUnavailableError)) throw e;
          // Оба провайдера S3 отказали после retry: финализируем по S2 как «предварительно», не теряем скан (§7 «Деградация»).
          escalation = 'failed';
          log.warn('pipeline: escalation unavailable, finalizing on main result', { scan_id: scan.id, triggers, attempts: e.attempts });
        }
      }

      // S4
      const card = await rules({ scan, result, geo, tests, usedFallback, provider, promptVersion, triggers, escalation, parent, lat, lng });
      log.info('pipeline done', { scan_id: scan.id, queue, ms: deps.now() - t0, card_id: card.id, escalation, triggers });
      return done('done', null, card.id);
    } catch (e) {
      if (e instanceof ScanRejected) {
        await repo.setScanStage(scan.id, { stage: 'failed', error: e.code });
        log.warn('pipeline: scan rejected', { scan_id: scan.id, error: e.code });
        return done('failed', e.code);
      }
      if (e instanceof PhotoUnavailableError) {
        if (scan.stage === 'done') {
          // Dispute по старому скану, чьи фото уже недоступны: карточка есть — статус не понижаем.
          log.warn('pipeline: photos unavailable for dispute, card kept', { scan_id: scan.id, path: e.storagePath });
          return done('skipped', 'photo_unavailable');
        }
        await repo.setScanStage(scan.id, { stage: 'failed', error: 'photo_unavailable' });
        log.warn('pipeline: photo unavailable', { scan_id: scan.id, path: e.storagePath, error: e.message.slice(0, 200) });
        return done('failed', 'photo_unavailable');
      }
      throw e; // временные ошибки (БД, LLM main недоступен) → retry через очередь, потом DLQ
    }
  }

  return { runScan };
}

export type Pipeline = ReturnType<typeof createPipeline>;
