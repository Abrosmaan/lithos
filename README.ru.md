# Lithos

Мобильная игра-коллекционирование камней: фото → AI-определение породы → карточка с тиром, лором, коллекция, карта.
Документы: `rock-game-spec.md` (продукт), `rock-game-ai-pipeline.md` (модели), `rock-game-dev-plan.md` (план), `INFRA.md` (инфра).

## Поднять локально за 15 минут

Нужны: Node ≥ 20, pnpm (`npm i -g pnpm`), телефон с Expo Go (SDK 57) в той же Wi-Fi-сети.

```bash
pnpm install                      # все workspace
cp .env.example .env              # заполнить: Supabase, ключи моделей (см. .private/INFRA.md)
pnpm db:migrate                   # миграции в схему lithos через session pooler (IPv4)
pnpm dev                          # воркер (tsx watch) + Expo dev server параллельно
```

Отдельно:

```bash
pnpm --filter worker dev          # только воркер; логирует «queues empty», пока нет сканов
pnpm --filter mobile start        # только Expo; QR → Expo Go на телефоне
pnpm typecheck && pnpm lint && pnpm test
pnpm eval                         # golden set через провайдерный слой (T2.4)
```

## Структура

```
apps/mobile/        Expo (React Native) — камера, результат, коллекция, карта
apps/worker/        Node 20 — читает pgmq, вызывает модели, считает score, пишет карточки
packages/shared/    zod-схемы, enum'ы, таблицы score (общие для клиента и воркера)
supabase/migrations/  SQL, идемпотентно, всё в схеме lithos
supabase/seed/      golden set
scripts/            db-migrate.mjs
docs/tasks/         артефакт каждой задачи (T0.1, T1.1, …)
```

## Как это работает

Клиент грузит фото в Storage-бакет `lithos-photos`, создаёт запись `lithos.scans`, вызывает RPC `lithos.enqueue_scan(scan_id)`.
Воркер читает очереди pgmq (`scan_interactive` → `scan_dispute` → `scan_batch`), гонит скан по ступеням
Gate → Main → Escalation → Rules, пишет `scan_results` (один ряд на ступень — идемпотентность) и `cards`.
Клиент получает результат через Realtime по `scan_id`.

## Деплой воркера

На общий Hetzner VPS, см. `INFRA.md` §4: rsync + `docker compose up -d --build worker`.
Только после зелёных тестов (hook `.claude/hooks/guard.sh` это проверяет).
