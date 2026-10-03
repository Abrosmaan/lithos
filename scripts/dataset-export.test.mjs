// T7.1, поток C — тесты чистых функций отбора и сборки манифеста. Сетевую часть/БД не тестируем (так везде
// в репозитории, см. apps/worker/src/pipeline/storage.test.ts) — только selectForExport/buildManifest/
// computeReadiness/pickLabel/pickVerdict/normalizeRow на синтетических данных.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildManifest,
  computeReadiness,
  isEligible,
  normalizeRow,
  photoRelativePath,
  pickLabel,
  pickVerdict,
  selectForExport,
  toManifestItem,
} from './lib/dataset-export.mjs';

function makeRecord(overrides = {}) {
  return {
    scanId: 'scan-1',
    userId: 'user-1',
    scanCreatedAt: '2026-01-01T00:00:00.000Z',
    trainingOptIn: true,
    card: { hidden: false, verification: 'community' },
    label: { id: 'label-1', rockClass: 'basalt', source: 'user_confirm', matchedModel: true, createdAt: '2026-01-02T00:00:00.000Z' },
    photos: [{ id: 'photo-1', storagePath: 'user-1/scan-1/0.jpg', isPrimary: true }],
    verdict: { provider: 'anthropic', model: 'claude-sonnet-5', promptVersion: 'main-v3', stage: 'main' },
    ...overrides,
  };
}

describe('isEligible / selectForExport — жёсткие правила отбора (T7.1 §3)', () => {
  it('без согласия на обучение запись не попадает', () => {
    const record = makeRecord({ trainingOptIn: false });
    assert.equal(isEligible(record), false);
    assert.deepEqual(selectForExport([record]), []);
  });

  it('без подтверждённой метки запись не попадает', () => {
    const record = makeRecord({ label: null });
    assert.equal(isEligible(record), false);
    assert.deepEqual(selectForExport([record]), []);
  });

  it('скрытая карточка не попадает', () => {
    const record = makeRecord({ card: { hidden: true, verification: 'community' } });
    assert.equal(isEligible(record), false);
  });

  it('карточка на ревью (pending_review) не попадает', () => {
    const record = makeRecord({ card: { hidden: false, verification: 'pending_review' } });
    assert.equal(isEligible(record), false);
  });

  it('нет карточки вовсе — тоже не попадает (не с чем сверить hidden/pending_review)', () => {
    const record = makeRecord({ card: null });
    assert.equal(isEligible(record), false);
  });

  it('запись, прошедшая все условия, отбирается', () => {
    const record = makeRecord();
    assert.equal(isEligible(record), true);
    assert.deepEqual(selectForExport([record, makeRecord({ trainingOptIn: false })]), [record]);
  });
});

describe('pickLabel', () => {
  it('без меток — null', () => {
    assert.equal(pickLabel([]), null);
    assert.equal(pickLabel(undefined), null);
  });

  it('выбирает самую свежую метку по created_at', () => {
    const older = { id: 'a', rockClass: 'basalt', createdAt: '2026-01-01T00:00:00.000Z' };
    const newer = { id: 'b', rockClass: 'granite', createdAt: '2026-01-05T00:00:00.000Z' };
    assert.equal(pickLabel([older, newer]).id, 'b');
    assert.equal(pickLabel([newer, older]).id, 'b');
  });

  it('при равном created_at — детерминированный тай-брейк по id', () => {
    const a = { id: 'aaa', createdAt: '2026-01-01T00:00:00.000Z' };
    const b = { id: 'bbb', createdAt: '2026-01-01T00:00:00.000Z' };
    assert.equal(pickLabel([b, a]).id, 'aaa');
    assert.equal(pickLabel([a, b]).id, 'aaa');
  });
});

describe('pickVerdict', () => {
  it('без результатов ступеней — null', () => {
    assert.equal(pickVerdict([]), null);
  });

  it('эскалация важнее main важнее gate', () => {
    const gate = { stage: 'gate', provider: 'google', createdAt: '2026-01-01T00:00:00.000Z' };
    const main = { stage: 'main', provider: 'anthropic', createdAt: '2026-01-01T00:00:01.000Z' };
    const escalation = { stage: 'escalation', provider: 'anthropic', createdAt: '2026-01-01T00:00:02.000Z' };
    assert.equal(pickVerdict([gate, main]).stage, 'main');
    assert.equal(pickVerdict([gate, main, escalation]).stage, 'escalation');
  });

  it('ступени вне priority-списка (preflight/rules/done/failed) не несут вердикта', () => {
    const preflight = { stage: 'preflight', createdAt: '2026-01-01T00:00:00.000Z' };
    assert.equal(pickVerdict([preflight]), null);
  });
});

describe('photoRelativePath', () => {
  it('отбрасывает user_id из storage_path, оставляя <scan_id>/<файл>', () => {
    const path = photoRelativePath('scan-1', { id: 'p1', storagePath: 'user-9/scan-1/0.jpg' });
    assert.equal(path, 'scan-1/0.jpg');
  });
});

describe('toManifestItem', () => {
  it('первичное фото идёт первым в списке и как file', () => {
    const record = makeRecord({
      photos: [
        { id: 'p2', storagePath: 'u/scan-1/1.jpg', isPrimary: false },
        { id: 'p1', storagePath: 'u/scan-1/0.jpg', isPrimary: true },
      ],
    });
    const item = toManifestItem(record);
    assert.equal(item.file, 'scan-1/0.jpg');
    assert.deepEqual(item.photos, ['scan-1/0.jpg', 'scan-1/1.jpg']);
  });

  it('несёт происхождение метки и исходного вердикта', () => {
    const item = toManifestItem(makeRecord());
    assert.equal(item.rock_class, 'basalt');
    assert.equal(item.label_source, 'user_confirm');
    assert.equal(item.matched_model, true);
    assert.deepEqual(item.verdict, { provider: 'anthropic', model: 'claude-sonnet-5', prompt_version: 'main-v3' });
  });

  it('без вердикта (scan_results ещё не сохранился) — verdict: null, а не падает', () => {
    const item = toManifestItem(makeRecord({ verdict: null }));
    assert.equal(item.verdict, null);
  });
});

describe('buildManifest — воспроизводимость (T7.1 §3 приёмка)', () => {
  it('два запуска на одних и тех же данных дают одинаковый манифест независимо от порядка строк из БД', () => {
    const a = makeRecord({ scanId: 'scan-a', label: { id: 'l-a', rockClass: 'basalt', source: 'user_confirm', matchedModel: true, createdAt: '2026-01-01T00:00:00.000Z' } });
    const b = makeRecord({ scanId: 'scan-b', label: { id: 'l-b', rockClass: 'granite', source: 'user_correct', matchedModel: false, createdAt: '2026-01-02T00:00:00.000Z' } });
    const generatedAt = '2026-09-30T00:00:00.000Z';

    const run1 = buildManifest([a, b], { generatedAt });
    const run2 = buildManifest([b, a], { generatedAt }); // тот же набор, другой порядок строк

    assert.deepEqual(run1, run2);
    assert.equal(JSON.stringify(run1), JSON.stringify(run2));
    assert.deepEqual(run1.items.map((i) => i.id), ['scan-a', 'scan-b']);
  });

  it('пустая выборка — пустой манифест, а не ошибка', () => {
    const manifest = buildManifest([], { generatedAt: '2026-09-30T00:00:00.000Z' });
    assert.deepEqual(manifest.items, []);
    assert.equal(manifest.version, 1);
  });
});

describe('computeReadiness', () => {
  it('считает подтверждённые фотографии по породам, только среди отобранных (eligible) записей', () => {
    const eligible = makeRecord({
      scanId: 'scan-1',
      photos: [
        { id: 'p1', storagePath: 'u/scan-1/0.jpg', isPrimary: true },
        { id: 'p2', storagePath: 'u/scan-1/1.jpg', isPrimary: false },
      ],
    });
    const notConsented = makeRecord({ scanId: 'scan-2', trainingOptIn: false });
    const readiness = computeReadiness([eligible, notConsented], 5);
    assert.deepEqual(readiness.byRockClass, { basalt: 2 });
    assert.equal(readiness.totalPhotos, 2);
    assert.equal(readiness.scans, 1);
    assert.equal(readiness.consentedUsers, 5);
  });

  it('без подтверждённых данных — пустая таблица и нулевые счётчики, не ошибка', () => {
    const readiness = computeReadiness([], 0);
    assert.deepEqual(readiness.byRockClass, {});
    assert.equal(readiness.totalPhotos, 0);
    assert.equal(readiness.scans, 0);
  });
});

describe('normalizeRow — разбор строки SQL-запроса (json_agg меток/фото/результатов)', () => {
  it('строит запись из сырых полей и выбирает победившую метку/вердикт', () => {
    const row = {
      scan_id: 'scan-1',
      user_id: 'user-1',
      scan_created_at: new Date('2026-01-01T00:00:00.000Z'),
      training_opt_in: true,
      card_id: 'card-1',
      card_hidden: false,
      card_verification: 'community',
      labels: [
        { id: 'l1', rock_class: 'basalt', source: 'user_confirm', matched_model: true, created_at: '2026-01-01T00:00:00.000Z' },
        { id: 'l2', rock_class: 'granite', source: 'user_correct', matched_model: false, created_at: '2026-01-02T00:00:00.000Z' },
      ],
      photos: [{ id: 'p1', storage_path: 'user-1/scan-1/0.jpg', is_primary: true }],
      scan_results: [
        { stage: 'main', provider: 'anthropic', model: 'claude-sonnet-5', prompt_version: 'main-v3', created_at: '2026-01-01T00:00:00.000Z' },
      ],
    };
    const record = normalizeRow(row);
    assert.equal(record.scanId, 'scan-1');
    assert.equal(record.trainingOptIn, true);
    assert.deepEqual(record.card, { hidden: false, verification: 'community' });
    assert.equal(record.label.rockClass, 'granite'); // самая свежая метка (user_correct, 01-02)
    assert.equal(record.verdict.provider, 'anthropic');
    assert.equal(isEligible(record), true);
  });

  it('card_id отсутствует (нет строки cards) — card: null', () => {
    const record = normalizeRow({
      scan_id: 'scan-2',
      user_id: 'user-1',
      scan_created_at: new Date(),
      training_opt_in: true,
      card_id: null,
      card_hidden: null,
      card_verification: null,
      labels: [],
      photos: [],
      scan_results: [],
    });
    assert.equal(record.card, null);
    assert.equal(record.label, null);
    assert.equal(isEligible(record), false);
  });
});
