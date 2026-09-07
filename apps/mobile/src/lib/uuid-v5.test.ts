import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { formatUuid, LITHOS_SCAN_NAMESPACE, parseUuid, type Sha1, utf8Encode, uuidV5 } from './uuid-v5';

const sha1: Sha1 = async (bytes) => new Uint8Array(createHash('sha1').update(bytes).digest());
const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('uuidV5 (RFC 4122 §4.3)', () => {
  it('даёт эталон RFC 4122 для namespace DNS и "www.example.com"', async () => {
    // Эталон: RFC 4122 / Python uuid.uuid5 / пакет uuid — 2ed6657d-e927-568b-95e1-2665a8aea6a2
    expect(await uuidV5('www.example.com', DNS, sha1)).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('выставляет биты версии 5 и варианта RFC 4122', async () => {
    for (const name of ['', 'a', 'device|2026-09-07T12:00:00.000Z', 'кириллица ✓ 😀']) {
      const id = await uuidV5(name, LITHOS_SCAN_NAMESPACE, sha1);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('детерминирован и чувствителен к имени/namespace', async () => {
    const a = await uuidV5('x', LITHOS_SCAN_NAMESPACE, sha1);
    expect(await uuidV5('x', LITHOS_SCAN_NAMESPACE, sha1)).toBe(a);
    expect(await uuidV5('y', LITHOS_SCAN_NAMESPACE, sha1)).not.toBe(a);
    expect(await uuidV5('x', DNS, sha1)).not.toBe(a);
  });

  it('хэширует байты namespace + UTF-8 имени (не строку)', async () => {
    const name = 'Ω😀';
    const expected = createHash('sha1').update(Buffer.concat([Buffer.from(parseUuid(DNS)), Buffer.from(name, 'utf8')])).digest();
    const id = await uuidV5(name, DNS, sha1);
    // первые 6 байт хэша не затрагиваются битами версии/варианта
    expect(id.replace(/-/g, '').slice(0, 12)).toBe(expected.subarray(0, 6).toString('hex'));
  });
});

describe('utf8Encode', () => {
  it('совпадает с Buffer.from(utf8) на ASCII, кириллице, BMP и суррогатных парах', () => {
    for (const s of ['', 'abc', 'привет', '✓', '😀', 'a😀b', '\u{1F600}\u{10FFFF}']) {
      expect(Buffer.from(utf8Encode(s)).toString('hex')).toBe(Buffer.from(s, 'utf8').toString('hex'));
    }
  });
});

describe('parseUuid / formatUuid', () => {
  it('round-trip и отбраковка мусора', () => {
    expect(formatUuid(parseUuid(DNS))).toBe(DNS);
    expect(formatUuid(parseUuid(DNS.toUpperCase()))).toBe(DNS);
    expect(() => parseUuid('not-a-uuid')).toThrow();
    expect(() => parseUuid(DNS.slice(1))).toThrow();
  });
});
