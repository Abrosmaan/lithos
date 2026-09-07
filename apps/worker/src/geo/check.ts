// Ручная проверка T1.2: печатает GeoContext для 5 контрольных точек (реальный Macrostrat + реальный geo_cache).
// Запуск из apps/worker: pnpm exec tsx src/geo/check.ts
import '../config.js';
import { closeDb } from '../db.js';
import { getGeoContext } from '../geo.js';

const POINTS: Array<[string, number, number]> = [
  ['Гонио (Грузия)', 41.57, 41.57],
  ['Дорсет (Англия)', 50.62, -2.27],
  ['Аризона (Гранд-Каньон)', 36.06, -112.14],
  ['Байкал (Листвянка)', 51.86, 104.86],
  ['Исландия (Рейкьявик)', 64.13, -21.9],
];

for (const [name, lat, lng] of POINTS) {
  const t0 = Date.now();
  const ctx = await getGeoContext(lat, lng);
  const rocks = ctx.expected_rocks.map((r) => `${r.rock_class} ${r.share}`).join(', ');
  console.log(`\n## ${name} (${lat}, ${lng}) — ${Date.now() - t0} ms`);
  console.log(`cell_id=${ctx.cell_id} source=${ctx.source} setting=${ctx.setting} age=${ctx.age_range ?? '—'}`);
  console.log(`expected_rocks: ${rocks || '—'}`);
  console.log(`wanderers: ${ctx.wanderers.join(', ')}`);
}
await closeDb();
