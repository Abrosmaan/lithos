import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fallbackPlaceName,
  placeCacheKey,
  placeNameForCell,
  placeNameFromAddress,
  pickPlaceName,
  resetPlaceNameCache,
  type GeocodedAddress,
  type PlaceStore,
} from './place-name';

// Ячейка Тбилиси из T6.0 (2 карточки внутри) — валидный geohash-6, есть в geohash.test.ts.
const CELL = 'szrv5f';

function memStore(initial: Record<string, string> = {}): PlaceStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: async (key) => (key in data ? data[key]! : null),
    setItem: async (key, value) => { data[key] = value; },
  };
}

describe('placeNameFromAddress', () => {
  it('district + city → «district, city»', () => {
    expect(placeNameFromAddress({ district: 'Ваке', city: 'Тбилиси' })).toBe('Ваке, Тбилиси');
  });

  it('district === city → просто city (не дублировать)', () => {
    expect(placeNameFromAddress({ district: 'Тбилиси', city: 'Тбилиси' })).toBe('Тбилиси');
  });

  it('без district → city', () => {
    expect(placeNameFromAddress({ city: 'Тбилиси' })).toBe('Тбилиси');
  });

  it('без city → district', () => {
    expect(placeNameFromAddress({ district: 'Ваке' })).toBe('Ваке');
  });

  it('без city и district → subregion', () => {
    expect(placeNameFromAddress({ subregion: 'Тбилисский регион' })).toBe('Тбилисский регион');
  });

  it('только region → region', () => {
    expect(placeNameFromAddress({ region: 'Грузия' })).toBe('Грузия');
  });

  it('пустые/пробельные строки игнорируются как отсутствующие', () => {
    expect(placeNameFromAddress({ city: '   ', region: 'Грузия' })).toBe('Грузия');
  });

  it('пустой адрес → null', () => {
    expect(placeNameFromAddress({})).toBeNull();
    expect(placeNameFromAddress(null)).toBeNull();
    expect(placeNameFromAddress(undefined)).toBeNull();
  });
});

describe('pickPlaceName', () => {
  it('берёт первый адрес, из которого получается осмысленное имя', () => {
    const addrs: GeocodedAddress[] = [{}, { subregion: 'Тбилисский регион' }, { city: 'Тбилиси' }];
    expect(pickPlaceName(addrs)).toBe('Тбилисский регион');
  });

  it('пропускает пустые ответы и берёт следующий', () => {
    expect(pickPlaceName([null, undefined, {}, { region: 'Грузия' }])).toBe('Грузия');
  });

  it('все ответы пустые → null', () => {
    expect(pickPlaceName([{}, null, undefined])).toBeNull();
  });

  it('пустой/отсутствующий список → null', () => {
    expect(pickPlaceName([])).toBeNull();
    expect(pickPlaceName(null)).toBeNull();
    expect(pickPlaceName(undefined)).toBeNull();
  });
});

describe('fallbackPlaceName / placeCacheKey', () => {
  it('честный технический fallback', () => {
    expect(fallbackPlaceName(CELL)).toBe(`Ячейка ${CELL}`);
  });

  it('ключ кэша namespaced по cellId', () => {
    expect(placeCacheKey(CELL)).toBe(`lithos.place.${CELL}`);
  });
});

describe('placeNameForCell', () => {
  beforeEach(() => {
    resetPlaceNameCache();
  });

  it('невалидный geohash → fallback без обращения к геокодеру/хранилищу', async () => {
    const geocode = vi.fn();
    const store = memStore();
    const name = await placeNameForCell('not-a-hash', { geocode, store });
    expect(name).toBe(fallbackPlaceName('not-a-hash'));
    expect(geocode).not.toHaveBeenCalled();
  });

  it('успешный геокодер: имя вычисляется и кладётся в store', async () => {
    const geocode = vi.fn(async () => [{ district: 'Ваке', city: 'Тбилиси' } satisfies GeocodedAddress]);
    const store = memStore();
    const name = await placeNameForCell(CELL, { geocode, store });
    expect(name).toBe('Ваке, Тбилиси');
    expect(geocode).toHaveBeenCalledTimes(1);
    expect(await store.getItem(placeCacheKey(CELL))).toBe('Ваке, Тбилиси');
  });

  it('кэш в store спасает от повторного вызова геокодера (новый вызов placeNameForCell, память процесса сброшена)', async () => {
    const store = memStore({ [placeCacheKey(CELL)]: 'Ваке, Тбилиси' });
    const geocode = vi.fn();
    const name = await placeNameForCell(CELL, { geocode, store });
    expect(name).toBe('Ваке, Тбилиси');
    expect(geocode).not.toHaveBeenCalled();
  });

  it('повторный вызов в том же процессе не бьёт по геокодеру снова (память процесса)', async () => {
    const geocode = vi.fn(async () => [{ city: 'Тбилиси' } satisfies GeocodedAddress]);
    const store = memStore();
    await placeNameForCell(CELL, { geocode, store });
    const name2 = await placeNameForCell(CELL, { geocode, store });
    expect(name2).toBe('Тбилиси');
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it('параллельные вызовы по одной ячейке дедуплицируются (один и тот же inflight-промис, один вызов геокодера)', async () => {
    const geocode = vi.fn(async () => [{ city: 'Тбилиси' } satisfies GeocodedAddress]);
    const store = memStore();
    const p1 = placeNameForCell(CELL, { geocode, store });
    const p2 = placeNameForCell(CELL, { geocode, store });
    expect(p1).toBe(p2); // второй вызов, пока первый ещё не завершился, вернул тот же промис
    const [n1, n2] = await Promise.all([p1, p2]);
    expect(n1).toBe('Тбилиси');
    expect(n2).toBe('Тбилиси');
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it('пустой ответ геокодера (море, безлюдная местность) → fallback, не кэшируется', async () => {
    const geocode = vi.fn(async () => [{} satisfies GeocodedAddress]);
    const store = memStore();
    const name = await placeNameForCell(CELL, { geocode, store });
    expect(name).toBe(fallbackPlaceName(CELL));
    expect(await store.getItem(placeCacheKey(CELL))).toBeNull();
  });

  it('геокодер бросает (нет сети/разрешения) → fallback, не бросает исключение', async () => {
    const geocode = vi.fn(async () => { throw new Error('no permission'); });
    const store = memStore();
    await expect(placeNameForCell(CELL, { geocode, store })).resolves.toBe(fallbackPlaceName(CELL));
  });

  it('хранилище недоступно (getItem/setItem бросают) → всё равно резолвится именем', async () => {
    const geocode = vi.fn(async () => [{ city: 'Тбилиси' } satisfies GeocodedAddress]);
    const store: PlaceStore = {
      getItem: async () => { throw new Error('storage unavailable'); },
      setItem: async () => { throw new Error('storage unavailable'); },
    };
    const name = await placeNameForCell(CELL, { geocode, store });
    expect(name).toBe('Тбилиси');
  });
});
