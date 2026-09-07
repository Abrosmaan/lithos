// UUID v5 (RFC 4122 §4.3) поверх инъецируемого SHA-1 — чистый модуль, тестируется в Node.
// В приложении SHA-1 даёт expo-crypto (см. scan-id.ts).

export type Sha1 = (bytes: Uint8Array) => Promise<Uint8Array>;

/** Пространство имён Lithos для scan_id — фиксированная константа проекта, не менять. */
export const LITHOS_SCAN_NAMESPACE = '3b0d6f52-9c4e-4a8b-9f1e-7c2a5d8e1b64';

export function parseUuid(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error('invalid uuid');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function formatUuid(b: Uint8Array): string {
  const h = Array.from(b.subarray(0, 16), (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** UTF-8 без TextEncoder — чтобы не зависеть от глобалов рантайма. */
export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

export async function uuidV5(name: string, namespace: string, sha1: Sha1): Promise<string> {
  const ns = parseUuid(namespace);
  const nameBytes = utf8Encode(name);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns, 0);
  input.set(nameBytes, ns.length);
  const hash = await sha1(input);
  if (hash.length < 16) throw new Error('sha1 returned too few bytes');
  const b = hash.slice(0, 16);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x50; // version 5
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // variant RFC 4122
  return formatUuid(b);
}
