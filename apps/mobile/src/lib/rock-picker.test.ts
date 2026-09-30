// Поток B (T7.1) — пикер породы для исправления вердикта: чистая группировка/сортировка/поиск, без сети.
import { ROCK_CLASSES } from '@lithos/shared';
import { describe, expect, it } from 'vitest';
import { filterRockPickerGroups, rockPickerGroups } from './rock-picker';

describe('rockPickerGroups', () => {
  it('содержит каждую породу справочника ровно один раз', () => {
    const codes = rockPickerGroups().flatMap((g) => g.items.map((i) => i.code));
    expect(codes).toHaveLength(ROCK_CLASSES.length);
    expect(new Set(codes).size).toBe(ROCK_CLASSES.length);
    expect([...codes].sort()).toEqual([...ROCK_CLASSES].sort());
  });

  it('группы не пустые и отсортированы по русскому имени', () => {
    const groups = rockPickerGroups();
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.items.length).toBeGreaterThan(0);
      const names = g.items.map((i) => i.nameRu);
      expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    }
  });

  it('каждая порода лежит в группе, согласованной с ROCK_CLASS_GROUP', () => {
    // Смоук: базальт — магматическая, песчаник — осадочная, сланец — метаморфическая, агат — «особые находки».
    const groups = rockPickerGroups();
    const groupOf = (code: string) => groups.find((g) => g.items.some((i) => i.code === code))?.key;
    expect(groupOf('basalt')).toBe('igneous');
    expect(groupOf('sandstone')).toBe('sedimentary');
    expect(groupOf('slate')).toBe('metamorphic');
    expect(groupOf('agate')).toBe('other');
    expect(groupOf('unknown')).toBe('unknown');
  });
});

describe('filterRockPickerGroups', () => {
  const groups = rockPickerGroups();

  it('пустой запрос возвращает всё без изменений', () => {
    expect(filterRockPickerGroups(groups, '')).toEqual(groups);
    expect(filterRockPickerGroups(groups, '   ')).toEqual(groups);
  });

  it('фильтрует по подстроке имени регистронезависимо', () => {
    const found = filterRockPickerGroups(groups, 'гранит');
    const names = found.flatMap((g) => g.items.map((i) => i.nameRu));
    expect(names).toContain('Гранит');
    expect(names.every((n) => n.toLowerCase().includes('гранит'))).toBe(true);

    const upper = filterRockPickerGroups(groups, 'ГРАНИТ');
    expect(upper.flatMap((g) => g.items.map((i) => i.code))).toEqual(found.flatMap((g) => g.items.map((i) => i.code)));
  });

  it('запрос без совпадений — пустой список групп', () => {
    expect(filterRockPickerGroups(groups, 'нет-такой-породы-жжж')).toEqual([]);
  });

  it('группа без совпадений в фильтре скрывается целиком', () => {
    // «базальт» встречается только в igneous — остальные группы должны пропасть.
    const found = filterRockPickerGroups(groups, 'базальт');
    expect(found).toHaveLength(1);
    expect(found[0]!.key).toBe('igneous');
  });
});
