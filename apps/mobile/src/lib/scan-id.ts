// scan_id = uuid v5(device_id + timestamp ISO) — idempotency key (ai-pipeline §3 S0, dev-plan T1.4).
import * as Crypto from 'expo-crypto';
import { LITHOS_SCAN_NAMESPACE, type Sha1, uuidV5 } from './uuid-v5';

export const sha1: Sha1 = async (bytes) => {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA1, buf));
};

export function scanIdName(deviceId: string, at: Date): string {
  return `${deviceId}|${at.toISOString()}`;
}

export async function createScanId(deviceId: string, at: Date = new Date()): Promise<string> {
  return uuidV5(scanIdName(deviceId, at), LITHOS_SCAN_NAMESPACE, sha1);
}

/** Детерминированный id строки scan_photos: повтор отправки → тот же id → upsert без дублей. */
export async function scanPhotoId(scanId: string, storagePath: string): Promise<string> {
  return uuidV5(`photo|${scanId}|${storagePath}`, LITHOS_SCAN_NAMESPACE, sha1);
}
