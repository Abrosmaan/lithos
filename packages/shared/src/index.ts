// @lithos/shared — общие для клиента и воркера схемы, enum'ы и таблицы score.
export * from './enums.js';
export * from './scan-result.js';
export * from './geo.js';
export * from './score.js';
export * from './limits.js';
export * from './ui-constants.js';

export const SCAN_QUEUES = ['scan_interactive', 'scan_dispute', 'scan_batch'] as const;
export type ScanQueue = (typeof SCAN_QUEUES)[number];

export const SCAN_STAGES = ['preflight', 'gate', 'main', 'escalation', 'rules', 'done', 'failed'] as const;
export type ScanStage = (typeof SCAN_STAGES)[number];

export interface ScanQueueMessage {
  scan_id: string;
  enqueued_at: string;
}
