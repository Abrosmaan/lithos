// S3 Escalation — тот же системный промпт Main + добавка из ai-pipeline §6.
// Добавка идёт вторым системным блоком: первый (Main) остаётся кэшируемым префиксом, вердикт S2 меняется на каждый скан.
import type { ScanResult } from '@lithos/shared';
import type { SystemModelMessage } from 'ai';
import type { BuiltPrompt } from './gate.js';
import { mainSystemMessage, mainUserMessage, type MainPromptArgs } from './main.js';

export const PROMPT_VERSION = 'escalation-v1';

export const ESCALATION_ADDENDUM_TEMPLATE = `A first-pass analysis is attached. Your job is review, not re-identification.
- Confirm, correct, or reduce confidence on each field. Change a label only if the evidence clearly supports a different one.
- Be especially skeptical of: fossils, agate, native metals, and any inclusion the first pass rated ≥ 0.8. These are the labels that, if wrong, damage user trust most.
- Write revision_note: one sentence on what you changed and why, or "confirmed".

First-pass result:
{s2_result_json}`;

export function renderEscalationAddendum(priorResult: ScanResult): string {
  return ESCALATION_ADDENDUM_TEMPLATE.replace('{s2_result_json}', JSON.stringify(priorResult));
}

export interface EscalationPromptArgs extends MainPromptArgs {
  priorResult: ScanResult;
}

export function buildEscalationPrompt(args: EscalationPromptArgs): BuiltPrompt {
  const addendum: SystemModelMessage = { role: 'system', content: renderEscalationAddendum(args.priorResult) };
  return {
    instructions: [mainSystemMessage(args.userLanguage), addendum],
    messages: [mainUserMessage(args)],
  };
}
