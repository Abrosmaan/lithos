import { describe, expect, it } from 'vitest';
import { GOLDEN_PER_GEOLOGY, GOLDEN_TRAPS, GEOLOGY_TYPES, loadLabels, parseLabels, summarizeLabels } from './labels.js';

describe('labels.json (golden set v0)', () => {
  it('parses, has 60 unique items: 12 per geology type + 12 traps', async () => {
    const labels = await loadLabels();
    const s = summarizeLabels(labels);
    expect(s.total).toBe(GEOLOGY_TYPES.length * GOLDEN_PER_GEOLOGY + GOLDEN_TRAPS);
    for (const g of GEOLOGY_TYPES) expect(s.byGeology[g]).toBe(GOLDEN_PER_GEOLOGY);
    expect(Object.values(s.byTrap).reduce((a, b) => a + b, 0)).toBe(GOLDEN_TRAPS);
    // Не-ловушки — камни; file либо null, либо <id>.jpg
    for (const it of labels.items) {
      if (!it.trap) expect(it.is_rock).toBe(true);
      if (it.file) expect(it.file).toBe(`${it.id}.jpg`);
      if (!it.source) expect(it.notes).toContain('снять вручную');
    }
  });
  it('rejects duplicate ids and traps without decoy', () => {
    const base = { file: null, rock_class: 'basalt', geology_type: 'volcanic_coast', lat: 0, lng: 0, source: null };
    expect(() => parseLabels({ version: 1, items: [{ ...base, id: 'vc-01' }, { ...base, id: 'vc-01' }] })).toThrow(/дубль/);
    expect(() => parseLabels({ version: 1, items: [{ ...base, id: 'tr-01', trap: 'glass_vs_quartz' }] })).toThrow(/decoy/);
    expect(() => parseLabels({ version: 1, items: [{ ...base, id: 'vc-01', rock_class: 'kryptonite' }] })).toThrow();
  });
});
