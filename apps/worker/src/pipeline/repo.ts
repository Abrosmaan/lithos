// Репозиторий конвейера на pg (схема lithos). Все многошаговые записи — в одной транзакции:
// scan_results + scans.stage; cards + hidden родителя + diary + scans.stage.
import type pg from 'pg';
import type { ScanStage, UserTests } from '@lithos/shared';
import type {
  CardRow,
  CardUpsert,
  DlqOutcome,
  PhotoRow,
  PipelineRepo,
  ScanLock,
  ScanRow,
  StageResultRow,
  StageTransition,
  UpsertCardOptions,
} from './types.js';

type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

function normalizeTests(raw: unknown): UserTests | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
    typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
  return {
    weight: pick(t.weight, ['lighter', 'normal', 'heavier'] as const),
    scratch: pick(t.scratch, ['nail', 'coin', 'none'] as const),
    wet: typeof t.wet === 'boolean' ? t.wet : null,
    has_scale_photo: t.has_scale_photo === true,
  };
}

function toScanRow(r: Record<string, unknown>): ScanRow {
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    lat: r.lat == null ? null : Number(r.lat),
    lng: r.lng == null ? null : Number(r.lng),
    accuracy_m: r.accuracy_m == null ? null : Number(r.accuracy_m),
    user_tests: normalizeTests(r.user_tests),
    parent_card_id: r.parent_card_id == null ? null : String(r.parent_card_id),
    stage: r.stage as ScanStage,
    attempt: Number(r.attempt ?? 0),
    cost_usd: Number(r.cost_usd ?? 0),
    error: r.error == null ? null : String(r.error),
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

function toCardRow(r: Record<string, unknown>): CardRow {
  return {
    id: String(r.id),
    scan_id: String(r.scan_id),
    user_id: String(r.user_id),
    rock_class: String(r.rock_class),
    tier: r.tier == null ? null : String(r.tier),
    score: r.score == null ? null : Number(r.score),
    score_breakdown: (r.score_breakdown ?? {}) as Record<string, unknown>,
    inclusions: Array.isArray(r.inclusions) ? r.inclusions : [],
    shape: (r.shape ?? {}) as Record<string, unknown>,
    lore: r.lore == null ? null : String(r.lore),
    name: r.name == null ? null : String(r.name),
    user_name: r.user_name == null ? null : String(r.user_name),
    state: r.state as CardRow['state'],
    parent_card_id: r.parent_card_id == null ? null : String(r.parent_card_id),
    verification: r.verification as CardRow['verification'],
    provisional: Boolean(r.provisional),
    hidden: Boolean(r.hidden),
    cell_id: r.cell_id == null ? null : String(r.cell_id),
    lat: r.lat == null ? null : Number(r.lat),
    lng: r.lng == null ? null : Number(r.lng),
  };
}

const SCAN_COLUMNS = 'id, user_id, lat, lng, accuracy_m, user_tests, parent_card_id, stage, attempt, cost_usd, error, created_at';
const CARD_COLUMNS =
  'id, scan_id, user_id, rock_class, tier, score, score_breakdown, inclusions, shape, lore, name, user_name, state, parent_card_id, verification, provisional, hidden, cell_id, lat, lng';

async function applyTransition(q: Queryable, scanId: string, next: StageTransition, extra?: { provider: string | null; promptVersion: string | null }) {
  await q.query(
    `update lithos.scans set
       stage = $2::lithos.scan_stage,
       error = $3,
       provider = coalesce($4, provider),
       prompt_version = coalesce($5, prompt_version),
       cost_usd = (select coalesce(sum(cost_usd), 0) from lithos.scan_results r where r.scan_id = $1)
     where id = $1`,
    [scanId, next.stage, next.stage === 'failed' ? (next.error ?? null) : null, extra?.provider ?? null, extra?.promptVersion ?? null],
  );
}

export class PgPipelineRepo implements PipelineRepo {
  constructor(private readonly pool: pg.Pool) {}

  private async tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  async loadScan(scanId: string): Promise<ScanRow | null> {
    const { rows } = await this.pool.query(`select ${SCAN_COLUMNS} from lithos.scans where id = $1`, [scanId]);
    return rows[0] ? toScanRow(rows[0]) : null;
  }

  async loadPhotos(scanId: string): Promise<PhotoRow[]> {
    const { rows } = await this.pool.query<PhotoRow>(
      'select id, scan_id, storage_path, phash, is_primary, width, height from lithos.scan_photos where scan_id = $1 order by storage_path',
      [scanId],
    );
    return rows;
  }

  async setPhotoHash(photoId: string, phash: string): Promise<void> {
    await this.pool.query('update lithos.scan_photos set phash = $2 where id = $1 and phash is null', [photoId, phash]);
  }

  async findRecentHashedPhotos(userId: string, excludeScanId: string, windowHours: number) {
    const { rows } = await this.pool.query<{ scan_id: string; phash: string }>(
      `select p.scan_id, p.phash
         from lithos.scan_photos p
         join lithos.scans s on s.id = p.scan_id
         join lithos.cards c on c.scan_id = s.id and c.hidden = false
        where s.user_id = $1 and s.id <> $2 and s.stage = 'done' and s.parent_card_id is null
          and p.phash is not null
          and s.created_at > now() - make_interval(hours => $3::int)
        order by s.created_at desc
        limit 200`,
      [userId, excludeScanId, windowHours],
    );
    return rows;
  }

  async loadCard(cardId: string): Promise<CardRow | null> {
    const { rows } = await this.pool.query(`select ${CARD_COLUMNS} from lithos.cards where id = $1`, [cardId]);
    return rows[0] ? toCardRow(rows[0]) : null;
  }

  async loadCardByScan(scanId: string): Promise<CardRow | null> {
    const { rows } = await this.pool.query(`select ${CARD_COLUMNS} from lithos.cards where scan_id = $1`, [scanId]);
    return rows[0] ? toCardRow(rows[0]) : null;
  }

  async getStageResult(scanId: string, stage: ScanStage): Promise<StageResultRow | null> {
    const { rows } = await this.pool.query(
      'select scan_id, stage, provider, model, prompt_version, raw_json, tokens_in, tokens_out, cost_usd, latency_ms from lithos.scan_results where scan_id = $1 and stage = $2::lithos.scan_stage',
      [scanId, stage],
    );
    const r = rows[0] as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      scan_id: String(r.scan_id),
      stage: r.stage as ScanStage,
      provider: r.provider == null ? null : String(r.provider),
      model: r.model == null ? null : String(r.model),
      prompt_version: r.prompt_version == null ? null : String(r.prompt_version),
      raw_json: r.raw_json,
      tokens_in: r.tokens_in == null ? null : Number(r.tokens_in),
      tokens_out: r.tokens_out == null ? null : Number(r.tokens_out),
      cost_usd: Number(r.cost_usd ?? 0),
      latency_ms: r.latency_ms == null ? null : Number(r.latency_ms),
    };
  }

  async saveStageResult(row: StageResultRow, next: StageTransition): Promise<void> {
    await this.tx(async (c) => {
      await c.query(
        `insert into lithos.scan_results (scan_id, stage, provider, model, prompt_version, raw_json, tokens_in, tokens_out, cost_usd, latency_ms)
         values ($1, $2::lithos.scan_stage, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
         on conflict (scan_id, stage) do nothing`,
        [row.scan_id, row.stage, row.provider, row.model, row.prompt_version, JSON.stringify(row.raw_json), row.tokens_in, row.tokens_out, row.cost_usd, row.latency_ms],
      );
      await applyTransition(c, row.scan_id, next, { provider: row.provider, promptVersion: row.prompt_version });
    });
  }

  async setScanStage(scanId: string, next: StageTransition): Promise<void> {
    await applyTransition(this.pool, scanId, next);
  }

  async upsertCard(card: CardUpsert, opts: UpsertCardOptions): Promise<CardRow> {
    return this.tx(async (c) => {
      const { rows } = await c.query(
        `insert into lithos.cards (scan_id, user_id, rock_class, tier, score, score_breakdown, inclusions, shape, lore, name,
                                   state, parent_card_id, verification, provisional, cell_id, lat, lng)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10,
                 $11::lithos.card_state, $12, $13::lithos.card_verification, $14, $15, $16, $17)
         on conflict (scan_id) do update set
           rock_class = excluded.rock_class, tier = excluded.tier, score = excluded.score,
           score_breakdown = excluded.score_breakdown, inclusions = excluded.inclusions, shape = excluded.shape,
           lore = excluded.lore, name = excluded.name, state = excluded.state, parent_card_id = excluded.parent_card_id,
           verification = excluded.verification, provisional = excluded.provisional,
           cell_id = excluded.cell_id, lat = excluded.lat, lng = excluded.lng
         returning ${CARD_COLUMNS}`,
        [
          card.scan_id, card.user_id, card.rock_class, card.tier, card.score,
          JSON.stringify(card.score_breakdown), JSON.stringify(card.inclusions), JSON.stringify(card.shape),
          card.lore, card.name, card.state, card.parent_card_id, card.verification, card.provisional,
          card.cell_id, card.lat, card.lng,
        ],
      );
      const saved = toCardRow(rows[0] as Record<string, unknown>);
      if (opts.hideCardId) {
        await c.query('update lithos.cards set hidden = true where id = $1 and id <> $2', [opts.hideCardId, saved.id]);
      }
      if (opts.diary) {
        const found = opts.diary.found ? [opts.diary.found] : [];
        await c.query(
          `insert into lithos.diary (user_id, cell_id, expected, found, updated_at)
           values ($1, $2, $3::jsonb, $4::jsonb, now())
           on conflict (user_id, cell_id) do update set
             expected = excluded.expected,
             found = (select coalesce(jsonb_agg(distinct v), '[]'::jsonb) from jsonb_array_elements(lithos.diary.found || excluded.found) v),
             updated_at = now()`,
          [opts.diary.user_id, opts.diary.cell_id, JSON.stringify(opts.diary.expected), JSON.stringify(found)],
        );
      }
      await applyTransition(c, card.scan_id, { stage: opts.scanStage });
      return saved;
    });
  }

  /** Сессионный advisory lock на выделенном соединении; держится до release() (весь runScan). */
  async tryLockScan(scanId: string): Promise<ScanLock | null> {
    const c = await this.pool.connect();
    try {
      const { rows } = await c.query<{ ok: boolean }>('select pg_try_advisory_lock(hashtext($1)) as ok', [`lithos.scan:${scanId}`]);
      if (!rows[0]?.ok) {
        c.release();
        return null;
      }
    } catch (e) {
      c.release();
      throw e;
    }
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        try {
          await c.query('select pg_advisory_unlock(hashtext($1))', [`lithos.scan:${scanId}`]);
          c.release();
        } catch {
          c.release(true); // соединение в неизвестном состоянии — выбросить из пула, lock снимется с ним
        }
      },
    };
  }

  async dlqScan(scanId: string): Promise<DlqOutcome> {
    return this.tx(async (c) => {
      const { rows } = await c.query<{ stage: ScanStage; has_card: boolean }>(
        `select s.stage, exists(select 1 from lithos.cards k where k.scan_id = s.id) as has_card
           from lithos.scans s where s.id = $1 for update`,
        [scanId],
      );
      const s = rows[0];
      if (!s || s.stage === 'done' || s.stage === 'failed') return 'noop';
      if (s.has_card) {
        // Предварительная карточка уже показана — закрываем скан как done, карточка остаётся «предварительно».
        await c.query(`update lithos.cards set provisional = true where scan_id = $1`, [scanId]);
        await applyTransition(c, scanId, { stage: 'done' });
        return 'done_with_card';
      }
      await applyTransition(c, scanId, { stage: 'failed', error: 'dlq' });
      return 'failed';
    });
  }
}
