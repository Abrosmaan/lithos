// Markdown-отчёт eval: таблица по каждой модели каждой ступени (dev-plan T2.4), список уверенных ошибок для калибровки.
// Колонки «Калибровка» (сумма вероятностей в окне) и «P(истина)» (средняя вероятность истинного класса) — T5.0.
import { formatModelSpec, type LlmStage } from '../llm/config.js';
import { summarizeGate, summarizeScan, type ScanOutcome } from './metrics.js';
import { isGateOutcomes, isScanOutcomes, type ModelRun } from './run.js';

export interface ReportContext {
  title: string;
  startedAt: Date;
  finishedAt: Date;
  argv: string[];
  itemsTotal: number;
  itemsSkipped: number;
  geoNote: string;
  commit: string | null;
}

export function pct(v: number | null, digits = 1): string {
  return v === null ? '—' : `${(v * 100).toFixed(digits)} %`;
}

export function usd(v: number): string {
  return `$${v.toFixed(4)}`;
}

function num(v: number | null, digits = 2): string {
  return v === null ? '—' : v.toFixed(digits);
}

function ms(v: number): string {
  return `${(v / 1000).toFixed(1)} с`;
}

const STAGE_TITLE: Record<LlmStage, string> = { gate: 'Gate', main: 'Main', escalation: 'Escalation' };

function statusNote(run: ModelRun): string | null {
  if (run.status === 'no_key') return 'нет ключа';
  if (run.status === 'no_prior') return 'нет prior (main той же семьи недоступен)';
  if (run.outcomes.length === 0) return 'нет вызовов';
  return null;
}

function gateTable(runs: ModelRun[]): string[] {
  const lines = [
    '| Модель | n | Ошибок вызова | is_rock точность | quality=ok | Стоимость/скан | p50 | p95 | Repair |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const r of runs) {
    const note = statusNote(r);
    if (note || !isGateOutcomes(r.outcomes)) {
      lines.push(`| ${formatModelSpec(r.spec)} | — | — | ${note ?? '—'} | — | — | — | — | — |`);
      continue;
    }
    const s = summarizeGate(r.outcomes);
    lines.push(`| ${formatModelSpec(r.spec)} | ${s.n} | ${s.failedCalls} | ${pct(s.isRockAccuracy)} | ${pct(s.qualityOkRate)} | ${usd(s.costMeanUsd)} | ${ms(s.latencyP50)} | ${ms(s.latencyP95)} | ${s.repaired} |`);
  }
  return lines;
}

function scanTable(runs: ModelRun[], stage: LlmStage): string[] {
  const esc = stage === 'escalation';
  const lines = [
    `| Модель | n | Ошибок вызова | Top-1 | Top-2 | Уверенные ошибки | Калибровка | P(истина) | Альтернатив | Precision включений | Recall включений | Ловушки | С процентами | Стоимость/скан | p50 | p95 | Repair |${esc ? ' Изменил primary |' : ''}`,
    `|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|${esc ? '---:|' : ''}`,
  ];
  for (const r of runs) {
    const note = statusNote(r);
    if (note || !isScanOutcomes(r.outcomes)) {
      lines.push(`| ${formatModelSpec(r.spec)} | — | — | ${note ?? '—'} | — | — | — | — | — | — | — | — | — | — | — | — | — |${esc ? ' — |' : ''}`);
      continue;
    }
    const s = summarizeScan(r.outcomes);
    const traps = s.trapN ? `${pct(s.trapAccuracy)} (${s.trapN})` : '—';
    lines.push(
      `| ${formatModelSpec(r.spec)} | ${s.n} | ${s.failedCalls} | ${pct(s.top1)} | ${pct(s.top2)} | ${pct(s.confidentErrorRate)} | ${pct(s.calibratedRate)} | ${num(s.truthProbMean)} | ${num(s.alternativesMean)} | ${pct(s.inclusionPrecision)} | ${pct(s.inclusionRecall)} | ${traps} | ${pct(s.percentagesRate)} | ${usd(s.costMeanUsd)} | ${ms(s.latencyP50)} | ${ms(s.latencyP95)} | ${s.repaired} |${esc ? ` ${pct(s.changedPrimaryRate)} |` : ''}`,
    );
  }
  return lines;
}

function geologyTable(runs: ModelRun[]): string[] {
  const ran = runs.filter((r) => r.status === 'ran' && isScanOutcomes(r.outcomes) && r.outcomes.length > 0);
  if (ran.length === 0) return [];
  const types = new Set<string>();
  const summaries = ran.map((r) => ({ r, s: summarizeScan(r.outcomes as ScanOutcome[]) }));
  for (const { s } of summaries) for (const k of Object.keys(s.top1ByGroup)) types.add(k);
  if (types.size === 0) return [];
  const cols = [...types];
  const lines = ['', `Top-1 по группам (только камни; 'trap' — ловушки):`, '', `| Модель | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---:').join('|')}|`];
  for (const { r, s } of summaries) {
    lines.push(`| ${formatModelSpec(r.spec)} | ${cols.map((c) => { const g = s.top1ByGroup[c as keyof typeof s.top1ByGroup]; return g ? `${pct(g.top1)} (${g.n})` : '—'; }).join(' | ')} |`);
  }
  return lines;
}

function nonRockLines(runs: ModelRun[]): string[] {
  const lines: string[] = [];
  for (const r of runs) {
    if (r.status !== 'ran' || !isScanOutcomes(r.outcomes)) continue;
    const s = summarizeScan(r.outcomes);
    if (s.nonRock.n === 0) continue;
    lines.push(`- ${formatModelSpec(r.spec)}: назвал породой не-камень (rock_class ≠ unknown*, confidence ≥ порога): ${s.nonRock.namedRock} из ${s.nonRock.n}`);
  }
  return lines.length ? ['', ...lines] : [];
}

function percentageLines(runs: ModelRun[]): string[] {
  const lines: string[] = [];
  for (const r of runs) {
    if (r.status !== 'ran' || !isScanOutcomes(r.outcomes)) continue;
    const s = summarizeScan(r.outcomes);
    if (s.percentageIds.length) lines.push(`- ${formatModelSpec(r.spec)}: с процентами состава (§11 п.7) — ${s.percentageIds.join(', ')}`);
  }
  return lines.length ? ['', ...lines] : [];
}

function confidentErrorsList(runs: ModelRun[]): string[] {
  const lines: string[] = [];
  for (const r of runs) {
    if (r.status !== 'ran' || !isScanOutcomes(r.outcomes)) continue;
    const errs = r.outcomes.filter((o) => o.ok && o.confidentError);
    if (errs.length === 0) continue;
    lines.push('', `${STAGE_TITLE[r.stage]} · ${formatModelSpec(r.spec)} — уверенные ошибки (${errs.length}):`, '');
    for (const o of errs) lines.push(`- ${o.id}: ожидалось \`${o.expected}\`, ответ \`${o.predicted}\` (${o.confidence?.toFixed(2)})`);
  }
  return lines;
}

export function buildReport(ctx: ReportContext, runs: ModelRun[]): string {
  const lines: string[] = [];
  lines.push(`# ${ctx.title}`, '');
  lines.push(`- Дата: ${ctx.startedAt.toISOString()} → ${ctx.finishedAt.toISOString()} (${((ctx.finishedAt.getTime() - ctx.startedAt.getTime()) / 1000).toFixed(0)} с)`);
  lines.push(`- Аргументы: \`${ctx.argv.join(' ') || '(нет)'}\``);
  lines.push(`- Позиций: ${ctx.itemsTotal}${ctx.itemsSkipped ? ` (пропущено без фото: ${ctx.itemsSkipped})` : ''}`);
  lines.push(`- Геоконтекст: ${ctx.geoNote}`);
  if (ctx.commit) lines.push(`- Commit: ${ctx.commit}`);
  const versions = [...new Set(runs.map((r) => r.promptVersion).filter(Boolean))];
  if (versions.length) lines.push(`- Версии промптов: ${versions.join(', ')}`);
  const total = runs.reduce((s, r) => s + r.outcomes.reduce((a, o) => a + o.costUsd, 0), 0);
  lines.push(`- Суммарная стоимость: ${usd(total)}`);

  for (const stage of ['gate', 'main', 'escalation'] as const) {
    const stageRuns = runs.filter((r) => r.stage === stage);
    if (stageRuns.length === 0) continue;
    lines.push('', `## ${STAGE_TITLE[stage]}`, '');
    lines.push(...(stage === 'gate' ? gateTable(stageRuns) : scanTable(stageRuns, stage)));
    if (stage !== 'gate') lines.push(...geologyTable(stageRuns), ...nonRockLines(stageRuns), ...percentageLines(stageRuns));
  }
  const errs = confidentErrorsList(runs);
  if (errs.length) lines.push('', '## Уверенные ошибки (confidence ≥ порога, неверно)', ...errs);
  lines.push('');
  return lines.join('\n');
}
