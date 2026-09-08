// T2.1: конвейер S0–S4 на моках callModel / getGeoContext / репозитория (in-memory FakeRepo) и настоящем sharp.
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { GateResult, GeoContext, ScanQueue, ScanResult, UserTests } from '@lithos/shared';
import { LlmUnavailableError, type CallModelInput, type CallModelOutput } from './llm/index.js';
import { createBudgetGuard, type BudgetGuard, type BudgetLevel } from './limits/budget.js';
import { createPipeline, type PipelineDeps } from './pipeline.js';
import { PIPELINE } from './pipeline/constants.js';
import { createConsumer, type QueueOps } from './pipeline/consumer.js';
import { FakeRepo } from './pipeline/fake-repo.js';
import { normalizeImage, perceptualHash } from './pipeline/images.js';
import type { CardRow, RunOutcome, ScanRow } from './pipeline/types.js';
import type { QueueMessage } from './queue.js';

// ---- картинки -------------------------------------------------------------------------
async function texture(seed: number, w = 320, h = 240): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const inside = Math.hypot(x - w / 2 + (seed % 50), y - h / 2) < 70;
      const v = Math.max(0, Math.min(255, (inside ? 80 : 220) + Math.floor(rnd() * 50) - 25));
      raw[i] = v;
      raw[i + 1] = v;
      raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
}
const IMG_A = await texture(1);
const IMG_B = await texture(2);
const IMG_C = await texture(3);
const HASH_A = await perceptualHash((await normalizeImage(IMG_A)).bytes);

// ---- фикстуры ----------------------------------------------------------------------------
const GEO: GeoContext = {
  cell_id: 'szms3z',
  expected_rocks: [
    { rock_class: 'limestone', share: 0.7 },
    { rock_class: 'andesite', share: 0.15 },
    { rock_class: 'tuff', share: 0.15 },
  ],
  age_range: 'Eocene',
  setting: 'coast',
  wanderers: ['drift_pumice'],
  source: 'cache',
};
const TESTS: UserTests = { weight: 'normal', scratch: 'coin', wet: false, has_scale_photo: true };
const GATE_OK: GateResult = { is_rock: true, quality: 'ok', multiple_objects: false };

/** Андезит на побережье Гонио: совпадает с литологией, confidence 0.85, форма обычная → common, без триггеров. */
const ANDESITE: ScanResult = {
  rock_class: { primary: 'andesite', confidence: 0.85, alternatives: [] },
  inclusions: [{ mineral: 'plagioclase', confidence: 0.5, extent: 'traces', location: null, evidence: 'white specks' }],
  shape: { tags: ['rounded'], natural_hole: false, recognizable_silhouette: null },
  surface: 'weathered',
  provenance: { matches_local_geology: true, wanderer_mechanism: null },
  split_recommendation: { recommended: true, reason: 'weathered exterior' },
  lore: 'Андезит — застывшая лава вулканов Аджарии.',
  flags: [],
  revision_note: null,
};
/** Окаменелость с отверстием: fossil_claimed + tier ≥ rare → эскалация; через fallback тир бы был legendary. */
const FOSSIL: ScanResult = {
  ...ANDESITE,
  rock_class: { primary: 'fossil', confidence: 0.9, alternatives: [] },
  inclusions: [{ mineral: 'fossil_fragment', confidence: 0.9, extent: 'dominant', location: null, evidence: 'shell imprint' }],
  shape: { tags: ['natural_hole'], natural_hole: true, recognizable_silhouette: null },
  surface: 'fresh_split',
  lore: 'Окаменелость.',
};

function out(result: GateResult | ScanResult, o: Partial<CallModelOutput> = {}): CallModelOutput {
  return {
    result,
    provider: 'anthropic',
    model: 'mock',
    promptVersion: 'v1',
    tokensIn: 1000,
    tokensOut: 100,
    costUsd: 0.01,
    latencyMs: 5,
    usedFallback: false,
    fallbackReason: 'none',
    attempts: 1,
    repaired: false,
    ...o,
  };
}

interface Harness {
  repo: FakeRepo;
  deps: PipelineDeps;
  calls: CallModelInput[];
  stages: () => string[];
  geoCalls: Array<[number, number]>;
  run: (scanId: string, queue?: ScanQueue) => ReturnType<ReturnType<typeof createPipeline>['runScan']>;
}

function harness(answers: Partial<Record<CallModelInput['stage'], (input: CallModelInput) => CallModelOutput | Promise<CallModelOutput>>> = {}): Harness {
  const repo = new FakeRepo();
  const calls: CallModelInput[] = [];
  const geoCalls: Array<[number, number]> = [];
  const images = new Map<string, Buffer>([
    ['u/s/1.jpg', IMG_A],
    ['u/s/2.jpg', IMG_B],
    ['u/s/3.jpg', IMG_C],
  ]);
  const deps: PipelineDeps = {
    repo,
    photos: {
      download: async (p) => {
        const b = images.get(p) ?? images.get(p.replace(/^.*\//, 'u/s/'));
        if (!b) throw new Error(`no image ${p}`);
        return b;
      },
    },
    callModel: vi.fn(async (input: CallModelInput) => {
      calls.push(input);
      const a = answers[input.stage];
      if (!a) throw new Error(`unexpected callModel(${input.stage})`);
      return a(input);
    }),
    getGeoContext: vi.fn(async (lat: number, lng: number) => {
      geoCalls.push([lat, lng]);
      return GEO;
    }),
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    now: Date.now,
  };
  const pipeline = createPipeline(deps);
  return { repo, deps, calls, stages: () => calls.map((c) => c.stage), geoCalls, run: (id, q = 'scan_interactive') => pipeline.runScan(id, q) };
}

function seedScan(repo: FakeRepo, o: Partial<ScanRow> & { photos?: number } = {}): ScanRow {
  const id = o.id ?? 'scan-1';
  const scan: ScanRow = {
    id,
    user_id: 'user-1',
    lat: 41.57,
    lng: 41.57,
    accuracy_m: 10,
    user_tests: TESTS,
    parent_card_id: null,
    stage: 'preflight',
    attempt: 0,
    cost_usd: 0,
    error: null,
    created_at: new Date().toISOString(),
    ...o,
  };
  repo.scans.set(id, scan);
  const n = o.photos ?? 2;
  repo.photos.set(
    id,
    Array.from({ length: n }, (_, i) => ({ id: `${id}-p${i + 1}`, scan_id: id, storage_path: `u/${id}/${i + 1}.jpg`, phash: null, is_primary: i === 0, width: 320, height: 240 })),
  );
  return scan;
}

function cardOf(repo: FakeRepo, scanId: string): CardRow {
  const c = [...repo.cards.values()].find((x) => x.scan_id === scanId);
  if (!c) throw new Error(`no card for ${scanId}`);
  return c;
}

// ---- тесты -------------------------------------------------------------------------------
describe('pipeline S0–S4', () => {
  it('happy path: gate → main → rules; без триггеров S3; карточка, дневник, cost', async () => {
    const h = harness({ gate: () => out(GATE_OK), main: () => out(ANDESITE, { costUsd: 0.02 }) });
    seedScan(h.repo);
    const r = await h.run('scan-1');
    expect(r.status).toBe('done');
    expect(h.stages()).toEqual(['gate', 'main']);
    expect(h.geoCalls).toEqual([[41.57, 41.57]]);

    const scan = h.repo.scans.get('scan-1')!;
    expect(scan.stage).toBe('done');
    expect(scan.error).toBeNull();
    expect(scan.cost_usd).toBeCloseTo(0.03, 6);
    expect(h.repo.results.has('scan-1:gate')).toBe(true);
    expect(h.repo.results.has('scan-1:main')).toBe(true);

    const card = cardOf(h.repo, 'scan-1');
    expect(card.rock_class).toBe('andesite');
    expect(card.state).toBe('closed');
    expect(card.provisional).toBe(false);
    expect(card.verification).toBe('ai');
    expect(card.tier).toBe('common');
    expect(card.score).toBe(3 + 5 + 10 + 4); // форма plain 3, место match 5, база common(0.15) 10, масштаб 2 + тесты 2
    expect(card.name).toBe('Андезит, побережье');
    expect(card.cell_id).toBe('szms3z');
    expect(card.inclusions).toEqual([]); // plagioclase 0.5 < 0.6 — отсечено
    expect(card.shape).toMatchObject({ surface: 'weathered', tags: ['rounded'] });
    expect(card.score_breakdown).toMatchObject({ has_geo: true, geo_anomaly: false, meta: { escalation: 'none', triggers: [], split_recommendation: { recommended: true } } });
    expect(h.repo.diary.get('user-1:szms3z')).toEqual({ user_id: 'user-1', cell_id: 'szms3z', expected: ['limestone', 'andesite', 'tuff'], found: ['andesite'] });
    // pHash записан в scan_photos
    expect(h.repo.photos.get('scan-1')!.every((p) => /^[0-9a-f]{16}$/.test(p.phash ?? ''))).toBe(true);
    // Gate получил одно (primary) фото, Main — оба
    expect(h.calls[0]!.images).toHaveLength(1);
    expect(h.calls[1]!.images).toHaveLength(2);
    expect(h.calls[1]!.geo).toEqual(GEO);
    expect(h.calls[1]!.userTests).toEqual(TESTS);
    expect(h.calls[1]!.scaleObject).toMatch(/^coin or finger/);
  });

  it('(а) идемпотентность: падение после записи Main → перезапуск → Main не вызывается повторно', async () => {
    const h = harness({ gate: () => out(GATE_OK), main: () => out(ANDESITE) });
    seedScan(h.repo);
    h.repo.failNext = { method: 'upsertCard' }; // «убить» после ответа Main и его записи, до карточки
    await expect(h.run('scan-1')).rejects.toThrow(/simulated crash/);
    expect(h.stages()).toEqual(['gate', 'main']);
    expect(h.repo.results.has('scan-1:main')).toBe(true);
    expect(h.repo.scans.get('scan-1')!.stage).toBe('rules');

    const r = await h.run('scan-1');
    expect(r.status).toBe('done');
    expect(h.stages()).toEqual(['gate', 'main']); // счётчик вызовов не вырос
    expect(h.repo.scans.get('scan-1')!.cost_usd).toBeCloseTo(0.02, 6);
    expect(cardOf(h.repo, 'scan-1').rock_class).toBe('andesite');
  });

  it('(а′) повторное сообщение по done-скану — no-op без вызовов', async () => {
    const h = harness({ gate: () => out(GATE_OK), main: () => out(ANDESITE) });
    seedScan(h.repo);
    await h.run('scan-1');
    const r = await h.run('scan-1');
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('already_done');
    expect(h.stages()).toEqual(['gate', 'main']);
  });

  it('(б) gate not_rock → failed без Main, карточки нет', async () => {
    const h = harness({ gate: () => out({ is_rock: false, quality: 'ok', multiple_objects: false }) });
    seedScan(h.repo);
    const r = await h.run('scan-1');
    expect(r).toMatchObject({ status: 'failed', reason: 'not_rock' });
    expect(h.stages()).toEqual(['gate']);
    const scan = h.repo.scans.get('scan-1')!;
    expect(scan.stage).toBe('failed');
    expect(scan.error).toBe('not_rock');
    expect(h.repo.cards.size).toBe(0);
    expect(h.repo.results.has('scan-1:gate')).toBe(true);
  });

  it('(б′) gate screen_photo / blurry → соответствующий код; multiple_objects один не останавливает', async () => {
    for (const [gate, code] of [
      [{ is_rock: true, quality: 'screen_photo', multiple_objects: false }, 'screen_photo'],
      [{ is_rock: true, quality: 'blurry', multiple_objects: true }, 'blurry'],
    ] as const) {
      const h = harness({ gate: () => out(gate) });
      seedScan(h.repo);
      const r = await h.run('scan-1');
      expect(r).toMatchObject({ status: 'failed', reason: code });
    }
    const h = harness({ gate: () => out({ is_rock: true, quality: 'ok', multiple_objects: true }), main: () => out(ANDESITE) });
    seedScan(h.repo);
    expect((await h.run('scan-1')).status).toBe('done');
  });

  it('(в) fallback в Main → provisional, тир ≤ rare, S3 пропущен', async () => {
    const h = harness({ gate: () => out(GATE_OK), main: () => out(FOSSIL, { usedFallback: true, fallbackReason: 'provider_error', provider: 'google' }) });
    seedScan(h.repo);
    const r = await h.run('scan-1');
    expect(r.status).toBe('done');
    expect(h.stages()).toEqual(['gate', 'main']);
    const card = cardOf(h.repo, 'scan-1');
    expect(card.provisional).toBe(true);
    expect(card.tier).toBe('rare');
    expect(card.score).toBeGreaterThanOrEqual(70); // сам score не режется — только тир
    expect(card.score_breakdown).toMatchObject({ tier_clamped: true, meta: { escalation: 'skipped_fallback', fallback: true } });
    expect(card.score_breakdown.meta).toMatchObject({ triggers: expect.arrayContaining(['fossil_claimed', 'tier_rare_or_above']) });
  });

  it('(г) pHash-попадание: копия карточки, модели не вызываются, cost 0', async () => {
    const h = harness({});
    // Исходный скан того же пользователя: done, с карточкой, фото с тем же хэшем.
    seedScan(h.repo, { id: 'scan-0', stage: 'done', photos: 1 });
    h.repo.photos.get('scan-0')![0]!.phash = HASH_A;
    h.repo.cards.set('card-0', {
      id: 'card-0', scan_id: 'scan-0', user_id: 'user-1', rock_class: 'andesite', tier: 'common', score: 22,
      score_breakdown: { shape: { points: 3 } }, inclusions: [], shape: { tags: [] }, lore: 'lore', name: 'Андезит, побережье', user_name: 'мой',
      state: 'closed', parent_card_id: null, verification: 'ai', provisional: false, hidden: false, cell_id: 'szms3z', lat: 41.57, lng: 41.57,
    });
    seedScan(h.repo, { id: 'scan-1', photos: 1 });
    const r = await h.run('scan-1');
    expect(r).toMatchObject({ status: 'done', reason: 'phash_hit' });
    expect(h.stages()).toEqual([]);
    const card = cardOf(h.repo, 'scan-1');
    expect(card.id).not.toBe('card-0');
    expect(card).toMatchObject({ rock_class: 'andesite', tier: 'common', score: 22, name: 'Андезит, побережье', user_name: null });
    expect(card.score_breakdown).toMatchObject({ phash_hit: { source_scan_id: 'scan-0', source_card_id: 'card-0', distance: 0 } });
    const scan = h.repo.scans.get('scan-1')!;
    expect(scan.stage).toBe('done');
    expect(scan.cost_usd).toBe(0);
    expect(h.repo.results.get('scan-1:preflight')).toMatchObject({ provider: 'phash_cache', cost_usd: 0, raw_json: { phash_hit: true, source_scan_id: 'scan-0' } });
  });

  it('(г′) чужой / далёкий хэш не считается попаданием', async () => {
    const h = harness({ gate: () => out(GATE_OK), main: () => out(ANDESITE) });
    seedScan(h.repo, { id: 'scan-0', stage: 'done', user_id: 'user-2', photos: 1 });
    h.repo.photos.get('scan-0')![0]!.phash = HASH_A;
    h.repo.cards.set('card-0', { ...cardStub('scan-0', 'user-2') });
    seedScan(h.repo, { id: 'scan-1', photos: 1 });
    expect((await h.run('scan-1')).reason).toBeNull();
    expect(h.stages()).toEqual(['gate', 'main']);
  });

  it('(д) раскол: гео/тесты родителя, surface=fresh_split, opened, родитель hidden, split_delta', async () => {
    const seen: Array<ScanResult | undefined> = [];
    const h = harness({
      gate: () => out(GATE_OK),
      main: (i) => {
        seen.push(i.priorResult);
        return out({ ...ANDESITE, surface: 'weathered', inclusions: [{ mineral: 'zeolite', confidence: 0.8, extent: 'noticeable', location: 'in_vesicles', evidence: 'white fillings' }] });
      },
    });
    // Родитель: другой скан с гео и тестами; закрытая карточка score 20.
    seedScan(h.repo, { id: 'scan-parent', stage: 'done', lat: 50.62, lng: -2.27, user_tests: { weight: 'heavier', scratch: 'none', wet: null, has_scale_photo: false } });
    h.repo.cards.set('card-parent', { ...cardStub('scan-parent', 'user-1'), id: 'card-parent', score: 20, tier: 'common', lat: 50.62, lng: -2.27, cell_id: 'gbyrur' });
    // Скан раскола: без гео и без тестов от клиента.
    seedScan(h.repo, { id: 'scan-split', lat: null, lng: null, user_tests: null, parent_card_id: 'card-parent', photos: 1 });

    const r = await h.run('scan-split');
    expect(r.status).toBe('done');
    expect(h.geoCalls).toEqual([[50.62, -2.27]]);
    expect(h.calls[1]!.userTests).toEqual({ weight: 'heavier', scratch: 'none', wet: null, has_scale_photo: false });
    expect(h.calls[1]!.scaleObject).toBeNull();

    const card = cardOf(h.repo, 'scan-split');
    expect(card.state).toBe('opened');
    expect(card.parent_card_id).toBe('card-parent');
    expect(card.shape).toMatchObject({ surface: 'fresh_split' });
    expect(card.lat).toBe(50.62);
    expect(card.lng).toBe(-2.27);
    // форма 3 + место 5 + состав (10 + 7×1.5 = 20.5 → 21) + качество (fresh_split 6 + тесты родителя 2) = 37
    expect(card.score).toBe(37);
    expect(card.tier).toBe('uncommon');
    expect(card.score_breakdown).toMatchObject({ split_from: 'card-parent', split_delta: 17 });
    expect(h.repo.cards.get('card-parent')!.hidden).toBe(true);
    expect(card.hidden).toBe(false);
    expect(seen).toEqual([undefined]); // main без priorResult
  });

  it('(д′) раскол без родителя → failed parent_not_found без вызовов', async () => {
    const h = harness({});
    seedScan(h.repo, { id: 'scan-split', parent_card_id: 'missing' });
    const r = await h.run('scan-split');
    expect(r).toMatchObject({ status: 'failed', reason: 'parent_not_found' });
    expect(h.stages()).toEqual([]);
    expect(h.repo.scans.get('scan-split')!.error).toBe('parent_not_found');
  });

  it('S3 по триггерам: предварительная карточка (stage=escalation), затем финал по вердикту Opus', async () => {
    const snapshots: Array<{ stage: string; tier: string | null; escalation: unknown }> = [];
    const h = harness({
      gate: () => out(GATE_OK),
      main: () => out(FOSSIL),
      escalation: (i) => {
        // В момент вызова S3 клиент уже видит карточку по S2 и scans.stage='escalation'.
        const scan = h.repo.scans.get('scan-1')!;
        const card = cardOf(h.repo, 'scan-1');
        snapshots.push({ stage: scan.stage, tier: card.tier, escalation: (card.score_breakdown.meta as { escalation: string }).escalation });
        expect(i.priorResult).toEqual(FOSSIL);
        // Opus понижает: это известняк с отпечатком, а не окаменелость целиком.
        return out({ ...FOSSIL, rock_class: { primary: 'fossiliferous_limestone', confidence: 0.8, alternatives: [] }, revision_note: 'downgraded' }, { provider: 'anthropic', model: 'opus', costUsd: 0.05 });
      },
    });
    seedScan(h.repo);
    const r = await h.run('scan-1');
    expect(r.status).toBe('done');
    expect(h.stages()).toEqual(['gate', 'main', 'escalation']);
    // fossil: форма 20 + место 5 (ubiquitous) + состав 45 (потолок) + качество 10 = 80 → epic
    expect(snapshots).toEqual([{ stage: 'escalation', tier: 'epic', escalation: 'pending' }]);
    const card = cardOf(h.repo, 'scan-1');
    expect(card.rock_class).toBe('fossiliferous_limestone');
    expect(card.provisional).toBe(false);
    expect(card.score_breakdown).toMatchObject({ meta: { escalation: 'done', revision_note: 'downgraded' } });
    expect(h.repo.scans.get('scan-1')!.stage).toBe('done');
    expect(h.repo.scans.get('scan-1')!.cost_usd).toBeCloseTo(0.07, 6);
    // дневник — один раз, по финальному вердикту
    expect(h.repo.diary.get('user-1:szms3z')!.found).toEqual(['fossiliferous_limestone']);
  });

  it('S3 недоступен (оба провайдера) → финал по Main, provisional=true, скан done', async () => {
    const h = harness({
      gate: () => out(GATE_OK),
      main: () => out(FOSSIL),
      escalation: () => {
        throw new LlmUnavailableError('escalation', 8, []);
      },
    });
    seedScan(h.repo);
    const r = await h.run('scan-1');
    expect(r.status).toBe('done');
    const card = cardOf(h.repo, 'scan-1');
    expect(card.provisional).toBe(true);
    expect(card.rock_class).toBe('fossil');
    expect(card.score_breakdown).toMatchObject({ meta: { escalation: 'failed' } });
    expect(h.repo.scans.get('scan-1')!.stage).toBe('done');
  });

  it('Main недоступен → ошибка наружу (retry через очередь), stage остаётся main, карточки нет', async () => {
    const h = harness({
      gate: () => out(GATE_OK),
      main: () => {
        throw new LlmUnavailableError('main', 8, []);
      },
    });
    seedScan(h.repo);
    await expect(h.run('scan-1')).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(h.repo.scans.get('scan-1')!.stage).toBe('main');
    expect(h.repo.cards.size).toBe(0);
    // повтор: gate из scan_results, Main вызывается снова
    await expect(h.run('scan-1')).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(h.stages()).toEqual(['gate', 'main', 'main']);
  });

  it('scan_dispute на done-скане → S3 с триггером dispute; повторный dispute — no-op', async () => {
    const h = harness({ gate: () => out(GATE_OK), main: () => out(ANDESITE), escalation: () => out({ ...ANDESITE, revision_note: 'confirmed' }) });
    seedScan(h.repo);
    await h.run('scan-1');
    expect(h.stages()).toEqual(['gate', 'main']);
    const r = await h.run('scan-1', 'scan_dispute');
    expect(r.status).toBe('done');
    expect(h.stages()).toEqual(['gate', 'main', 'escalation']);
    expect(cardOf(h.repo, 'scan-1').score_breakdown).toMatchObject({ meta: { escalation: 'done', triggers: ['dispute'] } });
    const again = await h.run('scan-1', 'scan_dispute');
    expect(again).toMatchObject({ status: 'skipped', reason: 'already_escalated' });
  });

  it('без гео: score/tier null, имя без места, дневник не пишется, гео не запрашивается', async () => {
    const h = harness({ gate: () => out(GATE_OK), main: () => out(ANDESITE) });
    seedScan(h.repo, { lat: null, lng: null });
    await h.run('scan-1');
    expect(h.geoCalls).toEqual([]);
    const card = cardOf(h.repo, 'scan-1');
    expect(card.score).toBeNull();
    expect(card.tier).toBeNull();
    expect(card.cell_id).toBeNull();
    expect(card.name).toBe('Андезит');
    expect(card.score_breakdown).toMatchObject({ has_geo: false });
    expect(h.repo.diary.size).toBe(0);
  });

  it('гео-аномалия ниже epic → geo_anomaly в breakdown, S3, но без ревью (verification=ai) — T3.4', async () => {
    const granite = { ...ANDESITE, rock_class: { primary: 'granite' as const, confidence: 0.9, alternatives: [] } };
    const h = harness({ gate: () => out(GATE_OK), main: () => out(granite), escalation: () => out(granite) });
    seedScan(h.repo);
    await h.run('scan-1');
    expect(h.stages()).toEqual(['gate', 'main', 'escalation']); // geology_mismatch → S3
    const card = cardOf(h.repo, 'scan-1');
    expect(card.tier).toBe('common');
    expect(card.verification).toBe('ai');
    expect(card.score_breakdown).toMatchObject({ geo_anomaly: true, meta: { escalation: 'done', triggers: ['geology_mismatch'] } });
    expect(card.score_breakdown).toMatchObject({ place: { points: 0, reason: 'mismatch_no_mechanism' } });
  });

  it('одно из фото битое → пропускается, скан идёт по остальным; все битые → photo_unavailable', async () => {
    const h = harness({ gate: () => out(GATE_OK), main: () => out(ANDESITE) });
    seedScan(h.repo, { photos: 3 });
    const orig = h.deps.photos.download;
    h.deps.photos.download = async (p) => (p.endsWith('/2.jpg') ? Buffer.from('broken') : orig(p));
    const r = await h.run('scan-1');
    expect(r.status).toBe('done');
    expect(h.calls[1]!.images).toHaveLength(2);
  });

  it('временная ошибка Storage (после retry) → наружу, скан не failed', async () => {
    const h = harness({});
    seedScan(h.repo, { photos: 1 });
    h.deps.photos.download = async () => {
      throw new Error('storage 503');
    };
    await expect(h.run('scan-1')).rejects.toThrow(/503/);
    expect(h.repo.scans.get('scan-1')!.stage).toBe('preflight');
  });

  it('(м5) скан занят другим процессом → deferred без вызовов; после release — обрабатывается', async () => {
    const h = harness({ gate: () => out(GATE_OK), main: () => out(ANDESITE) });
    seedScan(h.repo);
    h.repo.locks.add('scan-1');
    const r = await h.run('scan-1');
    expect(r).toMatchObject({ status: 'deferred', reason: 'locked' });
    expect(h.stages()).toEqual([]);
    h.repo.locks.delete('scan-1');
    expect((await h.run('scan-1')).status).toBe('done');
    expect(h.repo.locks.size).toBe(0); // lock отпущен
  });

  it('dispute по done-скану с пропавшими фото → карточка и stage=done не трогаются', async () => {
    const h = harness({ gate: () => out(GATE_OK), main: () => out(ANDESITE) });
    seedScan(h.repo, { photos: 1 });
    await h.run('scan-1');
    h.deps.photos.download = async () => Buffer.from('gone');
    const r = await h.run('scan-1', 'scan_dispute');
    expect(r).toMatchObject({ status: 'skipped', reason: 'photo_unavailable' });
    expect(h.repo.scans.get('scan-1')).toMatchObject({ stage: 'done', error: null });
    expect(cardOf(h.repo, 'scan-1').rock_class).toBe('andesite');
  });

  it('фото не открывается → failed photo_unavailable без вызовов', async () => {
    const h = harness({});
    seedScan(h.repo, { photos: 1 });
    h.repo.photos.get('scan-1')![0]!.storage_path = 'u/scan-1/nope.png';
    h.deps.photos.download = async () => Buffer.from('not an image');
    const r = await h.run('scan-1');
    expect(r).toMatchObject({ status: 'failed', reason: 'photo_unavailable' });
    expect(h.stages()).toEqual([]);
  });
});

function cardStub(scanId: string, userId: string): CardRow {
  return {
    id: `card-${scanId}`, scan_id: scanId, user_id: userId, rock_class: 'andesite', tier: 'common', score: 20,
    score_breakdown: {}, inclusions: [], shape: {}, lore: null, name: null, user_name: null, state: 'closed',
    parent_card_id: null, verification: 'ai', provisional: false, hidden: false, cell_id: 'szms3z', lat: 41.57, lng: 41.57,
  };
}

// ---- consumer: DLQ, lease, chain timeout ------------------------------------------------------
describe('consumer', () => {
  function fakeQueue(messages: Partial<Record<ScanQueue, QueueMessage[]>>) {
    const ops = {
      readOne: vi.fn(async (q: ScanQueue) => messages[q]?.shift() ?? null),
      ack: vi.fn(async () => {}),
      archive: vi.fn(async () => {}),
      extendLease: vi.fn(async () => {}),
      send: vi.fn(async () => '99'),
    } satisfies QueueOps;
    return ops;
  }
  const msg = (scan_id: string, readCount: number, msgId = '1'): QueueMessage => ({ msgId, readCount, payload: { scan_id, enqueued_at: '' } });
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

  it('(е) read_ct > 3 → archive (DLQ) + scans failed/dlq, runScan не вызывается', async () => {
    const repo = new FakeRepo();
    seedScan(repo, { stage: 'main' });
    const q = fakeQueue({ scan_interactive: [msg('scan-1', PIPELINE.maxReads + 1)] });
    const runScan = vi.fn();
    const c = createConsumer({ queue: q, repo, runScan, log: silent, now: Date.now, setTimer: () => ({ clear() {} }) });
    expect(await c.tick()).toBe(true);
    expect(runScan).not.toHaveBeenCalled();
    expect(q.archive).toHaveBeenCalledWith('scan_interactive', '1');
    expect(q.ack).not.toHaveBeenCalled();
    expect(repo.scans.get('scan-1')).toMatchObject({ stage: 'failed', error: 'dlq' });
  });

  it('(е′) DLQ при уже показанной предварительной карточке → done + provisional, не failed', async () => {
    const repo = new FakeRepo();
    seedScan(repo, { stage: 'escalation' });
    repo.cards.set('c', cardStub('scan-1', 'user-1'));
    const q = fakeQueue({ scan_interactive: [msg('scan-1', 4)] });
    const c = createConsumer({ queue: q, repo, runScan: vi.fn(), log: silent, now: Date.now, setTimer: () => ({ clear() {} }) });
    await c.tick();
    expect(repo.scans.get('scan-1')).toMatchObject({ stage: 'done', error: null });
    expect(repo.cards.get('c')!.provisional).toBe(true);
  });

  it('read_ct ≤ 3: успех → ack; ошибка → set_vt на короткий retry, без ack', async () => {
    const repo = new FakeRepo();
    const q = fakeQueue({ scan_dispute: [msg('a', 3, '7')], scan_batch: [msg('b', 1, '8')] });
    const runScan = vi
      .fn()
      .mockResolvedValueOnce({ status: 'done', scanId: 'a', queue: 'scan_dispute', reason: null, cardId: 'c', ms: 1 })
      .mockRejectedValueOnce(new Error('db down'));
    const c = createConsumer({ queue: q, repo, runScan, log: silent, now: Date.now, setTimer: () => ({ clear() {} }) });
    await c.tick(); // порядок очередей: interactive пуста → dispute
    expect(runScan).toHaveBeenLastCalledWith('a', 'scan_dispute');
    expect(q.ack).toHaveBeenCalledWith('scan_dispute', '7');
    await c.tick();
    expect(runScan).toHaveBeenLastCalledWith('b', 'scan_batch');
    expect(q.ack).toHaveBeenCalledTimes(1);
    expect(q.extendLease).toHaveBeenCalledWith('scan_batch', '8', PIPELINE.retryDelaySeconds);
  });

  it('heartbeat: пока runScan идёт, lease продлевается на leaseSeconds; после завершения — не продлевается', async () => {
    const repo = new FakeRepo();
    const q = fakeQueue({ scan_interactive: [msg('hb', 1, '11')] });
    let finish!: () => void;
    const runScan = vi.fn(() => new Promise<RunOutcome>((r) => { finish = () => r({ status: 'done', scanId: 'hb', queue: 'scan_interactive', reason: null, cardId: null, ms: 1 }); }));
    const heartbeats: Array<() => void> = [];
    const setTimer = (fn: () => void, ms: number) => {
      if (ms === PIPELINE.leaseHeartbeatMs) heartbeats.push(fn);
      return { clear() {} };
    };
    const c = createConsumer({ queue: q, repo, runScan, log: silent, now: Date.now, setTimer });
    const t = c.tick();
    await Promise.resolve();
    expect(heartbeats).toHaveLength(1);
    heartbeats[0]!();
    await vi.waitFor(() => expect(q.extendLease).toHaveBeenCalledWith('scan_interactive', '11', PIPELINE.leaseSeconds));
    await vi.waitFor(() => expect(heartbeats).toHaveLength(2)); // перевыставлен
    finish();
    await t;
    heartbeats[1]!(); // после завершения — inert
    expect(q.extendLease).toHaveBeenCalledTimes(1);
    expect(q.ack).toHaveBeenCalledWith('scan_interactive', '11');
  });

  it('(M2) жёсткий дедлайн: heartbeat прекращается, задача abandoned без ack, слот свободен', async () => {
    const repo = new FakeRepo();
    const q = fakeQueue({ scan_interactive: [msg('stuck', 1, '12')] });
    const runScan = vi.fn(() => new Promise<RunOutcome>(() => {})); // никогда
    let now = 0;
    const heartbeats: Array<() => void> = [];
    let deadline: (() => void) | null = null;
    const setTimer = (fn: () => void, ms: number) => {
      if (ms === PIPELINE.leaseHeartbeatMs) heartbeats.push(fn);
      if (ms === PIPELINE.jobDeadlineMs) deadline = fn;
      return { clear() {} };
    };
    const errors: string[] = [];
    const c = createConsumer({ queue: q, repo, runScan, log: { ...silent, error: (m) => errors.push(m) }, now: () => now, setTimer });
    const outcomeP = c.handleMessage('scan_interactive', msg('stuck', 1, '12'));
    await Promise.resolve();
    now = PIPELINE.jobDeadlineMs + 1;
    heartbeats.shift()!(); // heartbeat после дедлайна — lease не продлевается
    expect(q.extendLease).not.toHaveBeenCalled();
    deadline!();
    const outcome = await outcomeP;
    expect(outcome.kind).toBe('abandoned');
    expect(q.ack).not.toHaveBeenCalled();
    expect(errors).toContain('pipeline job exceeded hard deadline, abandoning (message returns to queue by lease)');
    expect(c.inflightCount()).toBe(0);
  });

  it('DLQ-чтение дубликата, пока скан держит другой процесс → archive, скан не тронут (busy)', async () => {
    const repo = new FakeRepo();
    seedScan(repo, { stage: 'main' });
    repo.locks.add('scan-1');
    const q = fakeQueue({ scan_interactive: [msg('scan-1', 4, '14')] });
    const c = createConsumer({ queue: q, repo, runScan: vi.fn(), log: silent, now: Date.now, setTimer: () => ({ clear() {} }) });
    await c.tick();
    expect(q.archive).toHaveBeenCalledWith('scan_interactive', '14');
    expect(repo.scans.get('scan-1')).toMatchObject({ stage: 'main', error: null });
  });

  it('(n6) слот освобождается через tick(): при inflight=max tick ждёт завершения, затем читает следующее', async () => {
    const repo = new FakeRepo();
    const q = fakeQueue({ scan_interactive: [msg('a', 1, '1'), msg('b', 1, '2'), msg('c', 1, '3')] });
    const finish: Record<string, () => void> = {};
    const runScan = vi.fn((id: string) => new Promise<RunOutcome>((r) => { finish[id] = () => r({ status: 'done', scanId: id, queue: 'scan_interactive', reason: null, cardId: null, ms: 1 }); }));
    const setTimer = (fn: () => void, ms: number) => {
      if (ms === PIPELINE.chainTimeoutMs) queueMicrotask(fn); // цепочка «долгая» → сразу в фон
      return { clear() {} };
    };
    const c = createConsumer({ queue: q, repo, runScan, log: silent, now: Date.now, setTimer });
    await c.tick();
    await c.tick();
    expect(c.inflightCount()).toBe(PIPELINE.maxInflight);
    let third: 'pending' | 'done' = 'pending';
    const t3 = c.tick().then(() => (third = 'done'));
    await Promise.resolve();
    expect(third).toBe('pending'); // слотов нет — ждём, сообщение 'c' не читается
    expect(runScan).toHaveBeenCalledTimes(2);
    finish.a!();
    await t3;
    expect(c.inflightCount()).toBe(1);
    expect(q.ack).toHaveBeenCalledWith('scan_interactive', '1');
    await c.tick();
    expect(runScan).toHaveBeenLastCalledWith('c', 'scan_interactive');
    finish.b!();
    finish.c!();
    await c.drain();
    expect(c.inflightCount()).toBe(0);
  });

  it('deferred (скан занят) → set_vt на полный lease, без ack', async () => {
    const repo = new FakeRepo();
    const q = fakeQueue({ scan_interactive: [msg('busy', 2, '13')] });
    const runScan = vi.fn().mockResolvedValue({ status: 'deferred', scanId: 'busy', queue: 'scan_interactive', reason: 'locked', cardId: null, ms: 1 });
    const c = createConsumer({ queue: q, repo, runScan, log: silent, now: Date.now, setTimer: () => ({ clear() {} }) });
    await c.tick();
    expect(q.ack).not.toHaveBeenCalled();
    expect(q.extendLease).toHaveBeenCalledWith('scan_interactive', '13', PIPELINE.leaseSeconds);
  });

  it('chain timeout: tick возвращается, обработка продолжается в фоне и завершается ack', async () => {
    const repo = new FakeRepo();
    const q = fakeQueue({ scan_interactive: [msg('slow', 1, '9')] });
    let finish!: () => void;
    const runScan = vi.fn(() => new Promise<never>((r) => { finish = () => (r as (v: unknown) => void)({ status: 'done', scanId: 'slow', queue: 'scan_interactive', reason: null, cardId: null, ms: 1 }); }));
    const warns: string[] = [];
    // Таймер цепочки срабатывает сразу; heartbeat-таймеры — никогда.
    const setTimer = (fn: () => void, ms: number) => {
      if (ms === PIPELINE.chainTimeoutMs) queueMicrotask(fn);
      return { clear() {} };
    };
    const c = createConsumer({ queue: q, repo, runScan, log: { ...silent, warn: (m) => warns.push(m) }, now: Date.now, setTimer });
    await c.tick();
    expect(warns).toContain('pipeline exceeded chain timeout, continuing in background');
    expect(c.inflightCount()).toBe(1);
    expect(q.ack).not.toHaveBeenCalled();
    finish();
    await c.drain();
    expect(q.ack).toHaveBeenCalledWith('scan_interactive', '9');
    expect(c.inflightCount()).toBe(0);
  });
});

// ---- T3.4: антифрод и лимиты --------------------------------------------------------------------
describe('T3.4 антифрод и лимиты', () => {
  const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  /** Гранит на побережье (аномалия: mismatch_no_mechanism) с богатым составом: 20 + 0 + 45 + 10 = 75 → epic. */
  const RICH_GRANITE: ScanResult = {
    ...ANDESITE,
    rock_class: { primary: 'granite', confidence: 0.9, alternatives: [] },
    inclusions: [
      { mineral: 'amethyst', confidence: 0.9, extent: 'dominant', location: null, evidence: 'purple crystals' },
      { mineral: 'quartz_druse', confidence: 0.9, extent: 'dominant', location: null, evidence: 'druse' },
      { mineral: 'native_copper', confidence: 0.9, extent: 'dominant', location: null, evidence: 'metallic' },
    ],
    shape: { tags: ['natural_hole'], natural_hole: true, recognizable_silhouette: null },
    surface: 'fresh_split',
  };
  const fixedBudget = (level: BudgetLevel): BudgetGuard => ({
    level: async () => level,
    snapshot: () => ({ level, spentUsd: 0, dailyBudgetUsd: 1, checkedAt: 0 }),
    invalidate() {},
  });

  it('гео-аномалия + тир ≥ epic → verification=pending_review, score и тир сохранены', async () => {
    const h = harness({ gate: () => out(GATE_OK), main: () => out(RICH_GRANITE), escalation: () => out(RICH_GRANITE) });
    seedScan(h.repo);
    const r = await h.run('scan-1');
    expect(r.status).toBe('done');
    expect(h.stages()).toEqual(['gate', 'main', 'escalation']);
    const card = cardOf(h.repo, 'scan-1');
    expect(card.verification).toBe('pending_review');
    expect(card.tier).toBe('epic');
    expect(card.score).toBe(75);
    expect(card.provisional).toBe(false);
    expect(card.score_breakdown).toMatchObject({ geo_anomaly: true, internal_tier: 'epic', place: { points: 0, reason: 'mismatch_no_mechanism' } });
  });

  it('бюджет ≥ 80 % (лимит $1, расход $0.8): S3 выключен, тир ≤ rare, карточка не provisional', async () => {
    const h = harness({ gate: () => out(GATE_OK), main: () => out(FOSSIL), escalation: () => { throw new Error('S3 must not be called'); } });
    h.deps.budget = createBudgetGuard({ dailyBudgetUsd: 1, cacheMs: 30_000 }, { spentTodayUsd: async () => 0.8, now: Date.now, log: silent });
    seedScan(h.repo);
    const r = await h.run('scan-1');
    expect(r.status).toBe('done');
    expect(h.stages()).toEqual(['gate', 'main']);
    const card = cardOf(h.repo, 'scan-1');
    expect(card.tier).toBe('rare');
    expect(card.provisional).toBe(false);
    expect(card.score_breakdown).toMatchObject({ tier_clamped: true, meta: { escalation: 'skipped_budget', budget_soft: true, fallback: false } });
    expect(h.repo.scans.get('scan-1')).toMatchObject({ stage: 'done', error: null });
  });

  it('бюджет ≥ 80 %: без триггеров S3 тир не режется (нечего пропускать), budget_soft только в meta', async () => {
    const h = harness({ gate: () => out(GATE_OK), main: () => out(ANDESITE) });
    h.deps.budget = fixedBudget('soft');
    seedScan(h.repo);
    await h.run('scan-1');
    const card = cardOf(h.repo, 'scan-1');
    expect(card.tier).toBe('common');
    expect(card.score_breakdown).toMatchObject({ tier_clamped: false, meta: { escalation: 'none', budget_soft: true } });
  });

  it('бюджет ≥ 80 %, но S3 уже посчитан (replay/dispute) → используется, тир не режется (M2)', async () => {
    const h = harness({ gate: () => out(GATE_OK), main: () => out(FOSSIL), escalation: () => { throw new Error('S3 must not be called'); } });
    h.deps.budget = fixedBudget('soft');
    seedScan(h.repo);
    h.repo.results.set('scan-1:escalation', {
      scan_id: 'scan-1', stage: 'escalation', provider: 'anthropic', model: 'opus', prompt_version: 'v1',
      raw_json: { result: FOSSIL, meta: { used_fallback: false, fallback_reason: 'none', repaired: false, attempts: 1 } },
      tokens_in: 1, tokens_out: 1, cost_usd: 0.05, latency_ms: 1,
    });
    const r = await h.run('scan-1');
    expect(r.status).toBe('done');
    expect(h.stages()).toEqual(['gate', 'main']);
    const card = cardOf(h.repo, 'scan-1');
    expect(card.tier).toBe('epic'); // FOSSIL по GEO/TESTS — epic; при clamp был бы rare
    expect(card.score_breakdown).toMatchObject({ tier_clamped: false, meta: { escalation: 'done', budget_soft: true } });
  });

  it('бюджет ≥ 100 % (лимит $1, расход $1): скан не обрабатывается — deferred/budget_paused, error=budget_paused, stage прежний; после восстановления — обработан, error снят', async () => {
    let spent = 1;
    const h = harness({ gate: () => out(GATE_OK), main: () => out(ANDESITE) });
    const clock = { t: 0 };
    h.deps.budget = createBudgetGuard({ dailyBudgetUsd: 1, cacheMs: 30_000 }, { spentTodayUsd: async () => spent, now: () => clock.t, log: silent });
    seedScan(h.repo);
    const r = await h.run('scan-1');
    expect(r).toMatchObject({ status: 'deferred', reason: 'budget_paused' });
    expect(h.calls).toHaveLength(0);
    expect(h.repo.scans.get('scan-1')).toMatchObject({ stage: 'preflight', error: 'budget_paused' });
    expect(h.repo.calls).toContain('tryLockScan'); // m11: под lock'ом
    expect(h.repo.locks.size).toBe(0); // и отпущен
    // Повтор через 10 мин при том же расходе — снова пауза, без вызовов.
    clock.t += PIPELINE.budgetPauseSeconds * 1000;
    expect((await h.run('scan-1')).reason).toBe('budget_paused');
    expect(h.calls).toHaveLength(0);
    // Новые сутки: расход обнулился → обработан, error снят первым же переходом stage.
    spent = 0;
    clock.t += 31_000;
    const r2 = await h.run('scan-1');
    expect(r2.status).toBe('done');
    expect(h.stages()).toEqual(['gate', 'main']);
    expect(h.repo.scans.get('scan-1')).toMatchObject({ stage: 'done', error: null });
  });

  it('consumer: budget_paused → новое сообщение с задержкой budgetPauseSeconds (read_ct=0) + ack старого, без set_vt', async () => {
    const repo = new FakeRepo();
    const q = {
      readOne: vi.fn(async (qn: ScanQueue) => (qn === 'scan_interactive' ? { msgId: '21', readCount: 3, payload: { scan_id: 'p1', enqueued_at: 'x' } } : null)),
      ack: vi.fn(async () => {}),
      archive: vi.fn(async () => {}),
      extendLease: vi.fn(async () => {}),
      send: vi.fn(async () => '22'),
    } satisfies QueueOps;
    const runScan = vi.fn(async (): Promise<RunOutcome> => ({ status: 'deferred', scanId: 'p1', queue: 'scan_interactive', reason: 'budget_paused', cardId: null, ms: 1 }));
    const warns: string[] = [];
    const c = createConsumer({ queue: q, repo, runScan, log: { ...silent, warn: (m) => warns.push(m) }, now: Date.now, setTimer: () => ({ clear() {} }) });
    expect(await c.tick()).toBe(true);
    expect(q.send).toHaveBeenCalledWith('scan_interactive', { scan_id: 'p1', enqueued_at: 'x' }, PIPELINE.budgetPauseSeconds);
    expect(q.ack).toHaveBeenCalledWith('scan_interactive', '21');
    expect(q.extendLease).not.toHaveBeenCalled();
    expect(q.archive).not.toHaveBeenCalled();
    expect(warns).toContain('scan paused: daily budget exhausted, requeued');
  });
});
