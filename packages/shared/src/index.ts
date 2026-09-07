// @lithos/shared — общие для клиента и воркера схемы, enum'ы и таблицы score.
// Заполняется в T1.1. Здесь — только то, что нужно каркасу (T0.1).

export const SCAN_QUEUES = ['scan_interactive', 'scan_dispute', 'scan_batch'] as const;
export type ScanQueue = (typeof SCAN_QUEUES)[number];

export const SCAN_STAGES = ['preflight', 'gate', 'main', 'escalation', 'rules', 'done', 'failed'] as const;
export type ScanStage = (typeof SCAN_STAGES)[number];

export interface ScanQueueMessage {
  scan_id: string;
  enqueued_at: string;
}
