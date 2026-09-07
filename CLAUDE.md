# LITHOS (Rocky)

Мобильная игра-коллекционирование камней: фото → AI-определение породы → карточка, тир, лор, коллекция, карта.
Источники истины (при конфликте с кодом — правы они, в этом порядке):
1. `rock-game-spec.md` — продукт, механики, score, тиры.
2. `rock-game-ai-pipeline.md` — провайдерный слой, ступени моделей, fallback, golden set.
3. `rock-game-dev-plan.md` — стек, структура репо, волны задач, критерии приёмки.
Инфра и ключи: `INFRA.md` (общая инфра pet-проектов), `.env` (секреты, не читать через bash).

## Стек
- `apps/mobile/`: Expo (React Native) + expo-camera + expo-location + react-native-maps/MapLibre. TypeScript.
- `apps/worker/`: Node 20 + TypeScript; читает pgmq, вызывает модели через Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/google`) с zod-схемой; `sharp` + `imghash` для pHash; Macrostrat API с кэшем в Postgres.
- `packages/shared/`: zod-схемы, enum'ы, таблицы score — общие для клиента и воркера.
- БД: **общий Supabase Postgres, изолированная схема `lithos`** (проект xucojuvolptvwcjyieyl делится с другими проектами). Таблицы, enum, функции, очереди pgmq — только в `lithos`, никогда в `public`. Storage-бакет `lithos-photos`.
- Миграции: `supabase/migrations/*.sql`, идемпотентны, schema-qualified, RLS включён. Только новые файлы, старые не править.
- Монорепо: pnpm workspaces.
- Воркер деплоится на общий Hetzner VPS (`ssh flat-vps`, `/opt/lithos`, контейнер `lithos-worker`, `network_mode: host`). См. INFRA.md §4.

## Команды
- `pnpm typecheck` / `pnpm lint` / `pnpm test` — из корня, все workspace.
- `pnpm eval` — прогон golden set через провайдерный слой, таблица точности/стоимости/латентности по моделям.
- `pnpm db:migrate` — миграции через session pooler (IPv4, работает с мака).
- `pnpm --filter mobile start` — Expo dev; `eas build --profile preview` — сборка на телефон.
- Деплой воркера — rsync + `docker compose up -d --build worker` на flat-vps (INFRA.md §4), только после зелёных тестов.

## Правила
- Работаем по волнам из dev-plan §4. Внутри волны задачи параллельны; следующую волну не начинать без явной команды человека.
- Каждая задача оставляет артефакт `docs/tasks/<id>.md`: результат, принятые решения, нерешённое.
- Подключение к БД: `search_path=lithos,public`; Supabase JS SDK — `.schema('lithos')`.
- Клиент получает только `EXPO_PUBLIC_SUPABASE_URL` и anon-ключ. service_role — только воркер. Ничего секретного в бандл.
- Секреты не читать, не логировать, не коммитить. `.env` — локально и на VPS, в git нет.
- Воркер идемпотентен: повторная обработка `scan_id` не создаёт дублей (upsert по scan_id).
- Внешние вызовы (модели, Macrostrat) — таймаут + retry (3, exponential backoff); при отказе основного провайдера — fallback с пометкой «предварительно», не ошибка пользователю.
- Structured output моделей валидируется zod-схемой из `packages/shared`; невалидный ответ = retry, потом fallback.
- Отказы (не камень, размытое фото, экран телефона) — понятным русским сообщением до постановки в очередь, где это возможно (blur-детект на клиенте).
- Тексты интерфейса — русский. Названия пород — по справочнику enum из spec.
- Не делать вне прототипа: обмен, верификация, grading, NFT, рынок, подписка (dev-plan §0).
- Балансовые числа (score, тиры, веса) — только в `packages/shared/score.ts`, хардкод в логике запрещён.

## Стиль работы с человеком
- Маленькие шаги: одна задача — один запускаемый результат. После шага — 3–5 предложений простым языком: что сделано, как проверить на телефоне.
- Проект всегда запускается. Если шаг ломает запуск — чинить до конца шага.
- Коммит после каждого рабочего шага, сообщение короткое, на английском.

## Definition of Done для любой задачи
typecheck зелёный, lint зелёный, тесты зелёные, code-reviewer APPROVE, spec/ai-pipeline/dev-plan не нарушены, артефакт задачи записан.
