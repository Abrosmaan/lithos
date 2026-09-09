// Чужие находки на карте (T6.1-E2, поток E): PublicFindRow.center (центр ячейки geohash-6, ~1,2 км) → точка
// вида {lat,lng}, которую понимает groupByLocation из lib/geo-math.ts (импортируем, файл не трогаем —
// вне границ потока). Свои же опубликованные находки не должны задваиваться на карте как «чужие»
// (T6.0-fixes-and-social.md §2.2, п.4) — здесь их исключаем по id карточки.
import type { LatLng } from './geohash';
import type { PublicFindRow } from './publish';

/** Находка из public_finds, у которой есть ячейка (и, значит, центр) — только такие можно поставить на карту. */
export type OtherFindPoint = Omit<PublicFindRow, 'cell_id' | 'center'> & {
  cell_id: string;
  center: LatLng;
  lat: number;
  lng: number;
};

const hasCell = (r: PublicFindRow): r is PublicFindRow & { cell_id: string; center: LatLng } => r.cell_id !== null && r.center !== null;

/**
 * Точки чужих находок для карты. Находки без гео (`cell_id`/`center` = null — T6.0-fixes-and-social.md §2.2, п.5)
 * отсеиваются молча: им на карте не место, но сама находка валидна (экран и списки карточки это не ломает).
 * Свои же публикации (id совпадает с одной из собственных карточек) тоже отсеиваются — иначе своя находка
 * нарисовалась бы дважды: своим маркером и «чужим» (п.4 того же раздела).
 */
export function otherFindPoints(rows: readonly PublicFindRow[], ownCardIds: ReadonlySet<string>): OtherFindPoint[] {
  return rows
    .filter(hasCell)
    .filter((r) => !ownCardIds.has(r.id))
    .map((r) => ({ ...r, lat: r.center.latitude, lng: r.center.longitude }));
}
