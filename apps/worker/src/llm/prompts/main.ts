// S2 Main — системный промпт и пользовательское сообщение строго из ai-pipeline §6.
// Системный промпт помечен для Anthropic prompt cache (ai-pipeline §3 S2, §8 п.2).
import type { GeoContext, UserTests } from '@lithos/shared';
import type { ModelMessage, SystemModelMessage, UserContent } from 'ai';
import type { ImageInput, UserLanguage } from '../types.js';
import type { BuiltPrompt } from './gate.js';

export const PROMPT_VERSION = 'main-v1';

export const MAIN_SYSTEM_TEMPLATE = `You are a field geologist identifying hand specimens from smartphone photos for a collecting game. You never see the specimen physically, so you reason from visible evidence only and report calibrated uncertainty.

Rules:
- Use only the vocabulary in the provided enums. If nothing fits, use "unknown_igneous" / "unknown_sedimentary" / "unknown_metamorphic" / "unknown".
- confidence is your honest probability that the label is correct. 0.9 means you would bet on it; 0.5 means a coin flip. Do not inflate confidence for common rocks; do not deflate for rare ones.
- Do NOT estimate percentages of composition. Use extent: "traces" | "noticeable" | "dominant".
- For every inclusion, cite the visual evidence in ≤ 12 words.
- Local geology context lists what is expected here. Treat a match as evidence for your label. A mismatch is not automatically wrong: check the wanderer mechanisms listed (drift pumice, glacial erratic, river transport from an upstream unit, human-imported gravel). If a mechanism fits, set provenance.wanderer_mechanism; if none fits, set matches_local_geology=false and lower confidence.
- User-reported tests (weight, scratch, wet/dry) are reliable and override visual guesses on hardness and density.
- split_recommendation: recommend splitting only if the exterior is weathered/coated AND the rock type commonly hides interior features (vesicular lavas, nodules, concretions, veined rocks). Never recommend for fossils, geodes already open, or rocks with notable exterior shape.
- lore: 2–3 sentences in {user_language} for a curious non-expert. Concrete and local (name the process and the region's geologic setting). No superlatives, no "fascinating", no exclamation marks.
- If a hand, coin or other object covers > 30% of the rock, add flag "hand_covers_part".
- Output JSON matching the schema. No text outside JSON.`;

export const MAIN_USER_TEMPLATE = `Location context:
{geo_context_json}

User-reported tests:
{user_tests_json}

Photos: {n} images follow. Photo 1 includes a scale reference: {scale_object}.`;

const LANGUAGE_NAMES: Record<UserLanguage, string> = { ru: 'Russian', en: 'English' };

/** Максимум фото в Main (ai-pipeline §3 S2). Лишние отбрасываются. */
export const MAX_MAIN_IMAGES = 3;

export function renderMainSystem(userLanguage: UserLanguage): string {
  return MAIN_SYSTEM_TEMPLATE.replace('{user_language}', LANGUAGE_NAMES[userLanguage]);
}

export interface MainPromptArgs {
  images: ImageInput[];
  geo: GeoContext | null | undefined;
  userTests: UserTests | null | undefined;
  userLanguage: UserLanguage;
  scaleObject: string | null | undefined;
}

export function renderMainUser(args: MainPromptArgs, n: number): string {
  return MAIN_USER_TEMPLATE.replace('{geo_context_json}', args.geo ? JSON.stringify(args.geo) : 'none')
    .replace('{user_tests_json}', args.userTests ? JSON.stringify(args.userTests) : 'none')
    .replace('{n}', String(n))
    .replace('{scale_object}', args.scaleObject?.trim() || 'none');
}

/** Системное сообщение Main с cache control Anthropic (ephemeral, 5 мин). У Google опция игнорируется. */
export function mainSystemMessage(userLanguage: UserLanguage): SystemModelMessage {
  return {
    role: 'system',
    content: renderMainSystem(userLanguage),
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
  };
}

export function mainUserMessage(args: MainPromptArgs): ModelMessage {
  const images = args.images.slice(0, MAX_MAIN_IMAGES);
  if (images.length === 0) throw new Error('main prompt: at least one image required');
  const content: UserContent = [
    { type: 'text', text: renderMainUser(args, images.length) },
    // ai@7: картинки — file-part с mediaType image/*; "image"-part объявлен deprecated.
    ...images.map((img) => ({ type: 'file' as const, data: img.bytes, mediaType: img.mimeType })),
  ];
  return { role: 'user', content };
}

export function buildMainPrompt(args: MainPromptArgs): BuiltPrompt {
  return {
    instructions: [mainSystemMessage(args.userLanguage)],
    messages: [mainUserMessage(args)],
  };
}
