// S1 Gate — текст строго из ai-pipeline §6. Менять только через pnpm eval с записью дельты (dev-plan §5 п.8).
import type { ModelMessage, SystemModelMessage } from 'ai';
import type { ImageInput } from '../types.js';

export const PROMPT_VERSION = 'gate-v1';

export const GATE_SYSTEM = `You classify a single photo for a rock-collecting app.
Return JSON only, matching the schema. No prose.

is_rock: true if the main subject is a natural stone, pebble, mineral or rock fragment held or placed for inspection. False for: people, animals, food, man-made objects, landscapes without a clear single rock, screenshots.
quality: "ok" | "blurry" | "dark" | "too_far" (rock smaller than ~20% of frame) | "screen_photo" (photo of a screen, print, or a page: look for moiré, bezels, glare bands, pixel grid).
multiple_objects: true if several distinct rocks compete for attention.`;

export interface BuiltPrompt {
  instructions: SystemModelMessage[];
  messages: ModelMessage[];
}

/** Gate получает одно фото (лучшее по резкости выбирает S0), без геоконтекста. */
export function buildGatePrompt(image: ImageInput): BuiltPrompt {
  return {
    instructions: [{ role: 'system', content: GATE_SYSTEM }],
    messages: [
      {
        role: 'user',
        content: [{ type: 'file', data: image.bytes, mediaType: image.mimeType }],
      },
    ],
  };
}
