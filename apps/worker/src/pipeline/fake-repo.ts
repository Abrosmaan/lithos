// In-memory реализация PipelineRepo для тестов конвейера (та же семантика, что у PgPipelineRepo:
// insert scan_results ON CONFLICT DO NOTHING, stage-переходы, upsert карточки по scan_id, diary-merge, dlq).
import type { ScanStage } from '@lithos/shared';
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

export class FakeRepo implements PipelineRepo {
  scans = new Map<string, ScanRow>();
  photos = new Map<string, PhotoRow[]>();
  results = new Map<string, StageResultRow>();
  cards = new Map<string, CardRow>();
  diary = new Map<string, { user_id: string; cell_id: string; expected: string[]; found: string[] }>();
  /** Хук для «убить воркер»: бросает при следующем вызове названного метода, один раз. */
  failNext: { method: keyof PipelineRepo; error?: Error } | null = null;
  calls: string[] = [];
  locks = new Set<string>();
  private seq = 0;

  private hook(method: keyof PipelineRepo) {
    this.calls.push(method);
    if (this.failNext && this.failNext.method === method) {
      const err = this.failNext.error ?? new Error(`simulated crash in ${method}`);
      this.failNext = null;
      throw err;
    }
  }

  private key(scanId: string, stage: ScanStage) {
    return `${scanId}:${stage}`;
  }

  private transition(scanId: string, next: StageTransition) {
    const s = this.scans.get(scanId);
    if (!s) return;
    s.stage = next.stage;
    s.error = next.stage === 'failed' ? (next.error ?? null) : null;
    let cost = 0;
    for (const r of this.results.values()) if (r.scan_id === scanId) cost += r.cost_usd;
    s.cost_usd = cost;
  }

  async loadScan(scanId: string) {
    this.hook('loadScan');
    const s = this.scans.get(scanId);
    return s ? { ...s } : null;
  }
  async loadPhotos(scanId: string) {
    this.hook('loadPhotos');
    return [...(this.photos.get(scanId) ?? [])].sort((a, b) => a.storage_path.localeCompare(b.storage_path));
  }
  async setPhotoHash(photoId: string, phash: string) {
    this.hook('setPhotoHash');
    for (const list of this.photos.values()) for (const p of list) if (p.id === photoId && p.phash === null) p.phash = phash;
  }
  async findRecentHashedPhotos(userId: string, excludeScanId: string) {
    this.hook('findRecentHashedPhotos');
    const out: Array<{ scan_id: string; phash: string }> = [];
    for (const s of this.scans.values()) {
      if (s.user_id !== userId || s.id === excludeScanId || s.stage !== 'done' || s.parent_card_id) continue;
      const card = [...this.cards.values()].find((c) => c.scan_id === s.id && !c.hidden);
      if (!card) continue;
      for (const p of this.photos.get(s.id) ?? []) if (p.phash) out.push({ scan_id: s.id, phash: p.phash });
    }
    return out;
  }
  async loadCard(cardId: string) {
    this.hook('loadCard');
    const c = this.cards.get(cardId);
    return c ? structuredClone(c) : null;
  }
  async loadCardByScan(scanId: string) {
    this.hook('loadCardByScan');
    const c = [...this.cards.values()].find((x) => x.scan_id === scanId);
    return c ? structuredClone(c) : null;
  }
  async getStageResult(scanId: string, stage: ScanStage) {
    this.hook('getStageResult');
    const r = this.results.get(this.key(scanId, stage));
    return r ? structuredClone(r) : null;
  }
  async saveStageResult(row: StageResultRow, next: StageTransition) {
    this.hook('saveStageResult');
    const k = this.key(row.scan_id, row.stage);
    if (!this.results.has(k)) this.results.set(k, structuredClone(row));
    this.transition(row.scan_id, next);
  }
  async setScanStage(scanId: string, next: StageTransition) {
    this.hook('setScanStage');
    this.transition(scanId, next);
  }
  async upsertCard(card: CardUpsert, opts: UpsertCardOptions) {
    this.hook('upsertCard');
    const existing = [...this.cards.values()].find((c) => c.scan_id === card.scan_id);
    const row: CardRow = existing
      ? { ...existing, ...structuredClone(card), id: existing.id, user_name: existing.user_name, hidden: existing.hidden }
      : { ...structuredClone(card), id: `card-${++this.seq}`, user_name: null, hidden: false };
    this.cards.set(row.id, row);
    if (opts.hideCardId && opts.hideCardId !== row.id) {
      const parent = this.cards.get(opts.hideCardId);
      if (parent) parent.hidden = true;
    }
    if (opts.diary) {
      const k = `${opts.diary.user_id}:${opts.diary.cell_id}`;
      const d = this.diary.get(k) ?? { user_id: opts.diary.user_id, cell_id: opts.diary.cell_id, expected: [], found: [] };
      d.expected = [...opts.diary.expected];
      if (opts.diary.found && !d.found.includes(opts.diary.found)) d.found.push(opts.diary.found);
      this.diary.set(k, d);
    }
    this.transition(card.scan_id, { stage: opts.scanStage });
    return structuredClone(row);
  }
  async tryLockScan(scanId: string): Promise<ScanLock | null> {
    this.hook('tryLockScan');
    if (this.locks.has(scanId)) return null;
    this.locks.add(scanId);
    return { release: async () => void this.locks.delete(scanId) };
  }
  async dlqScan(scanId: string): Promise<DlqOutcome> {
    this.hook('dlqScan');
    if (this.locks.has(scanId)) return 'busy';
    const s = this.scans.get(scanId);
    if (!s || s.stage === 'done' || s.stage === 'failed') return 'noop';
    const card = [...this.cards.values()].find((c) => c.scan_id === scanId);
    if (card) {
      card.provisional = true;
      this.transition(scanId, { stage: 'done' });
      return 'done_with_card';
    }
    this.transition(scanId, { stage: 'failed', error: 'dlq' });
    return 'failed';
  }
}
