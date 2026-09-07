// Автоимя карточки (spec §5): «<Порода по-русски>, <место>». Место — метка setting из геоконтекста
// (без обратного геокодинга); inland / нет гео — только порода (geohash пользователю не показываем).
import { ROCK_CLASS_RU, type GeoContext, type RockClass } from '@lithos/shared';

const SETTING_RU: Record<string, string> = {
  coast: 'побережье',
  river: 'река',
  lake: 'озеро',
  glacial: 'ледниковая зона',
  volcanic: 'вулканическая зона',
};

export function placeLabel(geo: GeoContext | null): string | null {
  if (!geo) return null;
  return (geo.setting && SETTING_RU[geo.setting]) || null;
}

export function cardName(rockClass: RockClass, geo: GeoContext | null): string {
  const rock = ROCK_CLASS_RU[rockClass] ?? rockClass;
  const place = placeLabel(geo);
  return place ? `${rock}, ${place}` : rock;
}
