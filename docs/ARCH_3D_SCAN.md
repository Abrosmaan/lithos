# Lithos — архитектурный план: 3D-скан камня и карточка по модели

Версия 0.1 · 2026-09-09 · дополнение к rock-game-spec.md и rock-game-ai-pipeline.md. План привязан к текущему коду (Expo 57, Supabase, воркер S0–S4, `packages/shared/score.ts`). Всё, что расходится со spec §4/§6, помечено явно.

---

## 0. Что меняется одной фразой

Сейчас: 1–3 фото → модель угадывает форму и поверхность по картинке → карточка.
Станет: короткий круговой скан камня (LiDAR + камера) → на телефоне строится 3D-модель с настоящим масштабом → воркер извлекает геометрию **детерминированно** (размеры, объём, округлость, уплощённость, сквозное отверстие) и рендерит 6 канонических ракурсов → LLM определяет породу и состав по ракурсам + геометрии → карточка получает 3D-вьюер, размеры в миллиметрах, объём и плотность.

Главный продуктовый эффект: слой «Форма» (0–25) и половина слоя «Раскрытие» перестают зависеть от вердикта модели и считаются из геометрии. Это прямое усиление принципа spec §4.3 «модель даёт вердикт, игра даёт цифры» и метрики §6.5 (стабильность тира при пересъёмке ≥ 90 %).

---

## 1. Железо и честные ограничения

| Факт | Следствие для архитектуры |
|---|---|
| LiDAR есть только на iPhone Pro/Pro Max (12 Pro+) и iPad Pro. Разрешение сканера ~0,5–1 см на дистанции 20–30 см. | **Голый LiDAR-меш для гальки 3–8 см бесполезен** — получится «картофелина». LiDAR нужен для масштаба и грубой формы, детали — из фотограмметрии. |
| Apple **Object Capture** (RealityKit `ObjectCaptureSession` + `PhotogrammetrySession`, iOS 17+) делает фотограмметрию прямо на телефоне: фото + LiDAR-глубина → меш с текстурой в USDZ, **в истинном масштабе** на LiDAR-устройствах. Минимальный размер объекта ~3 см, время реконструкции 1–3 мин на устройстве. | Это основной примитив. Не пишем свою реконструкцию. На iPhone без LiDAR Object Capture тоже работает (масштаб оценивается хуже, ±10–15 %). |
| Android: ARCore Depth API есть на большинстве устройств, но это стерео/ML-глубина низкого качества; ToF-сенсор у единиц. Аналога Object Capture в ОС нет. | Android — **фото-только** путь: серия из 20–40 кадров по кругу → фотограмметрия на сервере (фаза 3) или обычный скан по фото (как сейчас). |
| Expo Go не умеет нативные модули. Object Capture требует Swift-модуль. | Переход на **EAS dev client / development build**. Expo остаётся, но «QR в Expo Go» больше не путь тестирования. |
| Скан 20–40 кадров + меш: USDZ 5–20 МБ, текстура 2K. | Нельзя тащить оригинал через мобильную сеть на каждый скан: клиент шлёт **урезанный меш (≤ 50k треугольников, ~2–4 МБ) + текстуру 1024** и 6 рендеров; полный USDZ остаётся на устройстве и грузится в фоне по Wi-Fi. |

Вывод: **iOS-first**. Прототип 3D-скана делается на iPhone Pro; iPhone без LiDAR получает тот же поток с пометкой «размеры приблизительно»; Android остаётся на фото-скане до фазы 3.

---

## 2. Целевая архитектура

```
Клиент (Expo + нативный модуль expo-object-capture)
  Capture ─► Object Capture session (круговой скан, 3 кольца) ─► USDZ (полный, локально)
     │                                                            │
     │  on-device: упрощение меша (≤50k tri), текстура 1024,       │
     │  6 рендеров 1024px (front/back/top/bottom/left/right), scale │
     ▼                                                            ▼
  Storage lithos-photos/<user>/<scan>/render_{1..6}.jpg          Storage lithos-models/<user>/<scan>/model.glb (фон, Wi-Fi)
  scans (source='lidar_capture', capture jsonb) + scan_photos(kind='render') + scan_models(row)
     │
     ▼ pgmq scan_interactive
Воркер
  S0  Preflight: pHash по рендерам + geometric hash (D2 shape distribution) → дедуп
  S0g Geometry (новая ступень, детерминированная, без LLM): парсинг GLB → метрики
  S1  Gate: 1 рендер (front) — как сейчас
  S2  Main: 6 рендеров + geo + user_tests + GEOMETRY_JSON → ScanResult (промпт main-v2)
  S3  Escalation: как сейчас
  S4  Rules: shapeLayer(geometry) вместо shapeLayer(result.shape); quality: scale=2 всегда для lidar;
      density_estimate из объёма и веса-бакета; cards.model_id, cards.dimensions
Клиент
  Result/Card: 3D-вьюер (GLB), размеры, объём, плотность; AR «поставить на стол» (фаза 2)
```

Ни один существующий контракт не ломается: скан по фото остаётся полностью рабочим (`scans.source='photos'`), 3D — надстройка с тем же `scan_id`, теми же очередями и той же таблицей карточек.

---

## 3. Клиент

### 3.1 Нативный модуль `expo-object-capture` (Swift, Expo Modules API)

Папка `apps/mobile/modules/expo-object-capture/`. Config plugin добавляет `NSCameraUsageDescription` (уже есть) и capability для RealityKit. Собирается только под iOS 17+; на Android модуль экспортирует `isAvailable() = false`.

API для JS:

```ts
isAvailable(): { available: boolean; lidar: boolean; reason?: 'android' | 'ios_version' | 'device' }
startSession(opts): Promise<SessionHandle>          // открывает нативный overlay ObjectCaptureView
// события: 'stateChanged' (detecting|capturing|finished), 'progress' (ring 1..3, shots), 'feedback' (moveCloser|tooFast|lowLight)
finishSession(): Promise<{ folderUri: string; shots: number; lidar: boolean }>
reconstruct(folderUri, { detail: 'reduced' | 'medium' }): Promise<{ usdzUri: string; boundingBoxMm: [x,y,z] | null; scaleConfidence: 'metric' | 'estimated' }>
export(usdzUri, { format: 'glb', maxTriangles: 50000, textureSize: 1024 }): Promise<{ glbUri: string; triangles: number; bytes: number }>
renderViews(glbUri, { size: 1024, views: 6 }): Promise<string[]>   // 6 JPEG на нейтральном фоне, фикс. освещение
```

Реализация: `ObjectCaptureSession` (UI SwiftUI `ObjectCaptureView` в `UIViewController`), `PhotogrammetrySession` с `.reduced`/`.medium`, экспорт в USDZ; конвертация USDZ→GLB и упрощение через **ModelIO + MeshOptimizer** (Swift-обёртка над meshoptimizer, MIT) либо, проще для прототипа, `SCNScene` → OBJ + собственная запись GLB. Рендеры — `SCNRenderer` офскрин с фиксированной камерой и светом (одинаковые для всех сканов — это важно для стабильности вердиктов LLM).

### 3.2 Поток экранов

Изменения минимальны, поток встраивается перед существующим Review:

1. **Камера** получает переключатель режима **«Фото» / «3D-скан»** (виден только при `isAvailable()`). При выборе 3D открывается нативный экран захвата Apple (он же ведёт пользователя: «обойди камень», три кольца, индикатор покрытия). Подсказки на русском задаются через `feedback`.
2. Новый экран **Реконструкция**: прогресс «Строим модель… 40 %», предпросмотр вращающейся модели, кнопки «Переснять» / «Далее». Здесь же — предупреждение «Модель неполная снизу — переверните камень и доснимите» (Object Capture поддерживает переворот объекта).
3. **Review** без изменений по мини-тестам; вместо миниатюр фото — миниатюры 6 рендеров + пометка «3D»; поле «масштаб» скрыто (масштаб известен); баннер «Размеры приблизительно» на устройствах без LiDAR.
4. **Результат/Карточка**: блок «Модель» — интерактивный вьюер (жесты вращения/зума), под ним «42 × 31 × 18 мм · 14 см³ · плотность ~2,9 г/см³ (тяжелее обычного)». Кнопка «Показать в AR» — фаза 2.

Вьюер: `expo-gl` + `three` + `GLTFLoader` (проверенная связка в Expo; ~1 МБ в бандл) с ленивой загрузкой GLB по signed URL и кэшем на диске. Альтернатива для iOS — нативный `SceneKit`/`RealityKit` view в том же модуле (быстрее, но не кроссплатформенно). Для прототипа — three.

### 3.3 Отправка (расширение `submitScan`)

- `scans.source = 'lidar_capture'`, `scans.capture = { shots, lidar, scale_confidence, bbox_mm, device_model, ios_version, reconstruct_ms }`.
- 6 рендеров → `lithos-photos/<user>/<scan>/render_1..6.jpg`, строки `scan_photos` с `kind='render'`, `view='front'|…`. Рендер `front` = `is_primary`.
- Меш → `lithos-models/<user>/<scan>/model.glb` (новый приватный бакет, лимит 8 МБ) + строка `scan_models`. Загрузка меша **не блокирует** постановку в очередь: скан ставится после рендеров; воркер ждёт `scan_models.status='uploaded'` до 60 с, иначе идёт по рендерам и помечает `geometry_pending`, геометрия досчитывается batch-задачей и карточка обновляется (Realtime уже есть).
- Полный USDZ хранится локально (`FileSystem.documentDirectory/scans/<scan_id>.usdz`) и отдаётся в Storage фоновой задачей только по Wi-Fi; нужен для AR и будущего grading.
- Идемпотентность прежняя: детерминированные id по `uuid v5(scan_id | path)`.

---

## 4. Хранилище и схема

Новая миграция `0007_models.sql` (идемпотентно, schema-qualified, RLS «своё»):

```sql
alter table lithos.scans add column if not exists source text not null default 'photos';   -- photos | lidar_capture | photo_series
alter table lithos.scans add column if not exists capture jsonb;
alter table lithos.scan_photos add column if not exists kind text not null default 'photo'; -- photo | render
alter table lithos.scan_photos add column if not exists view text;                           -- front|back|top|bottom|left|right

create table if not exists lithos.scan_models (
  scan_id uuid primary key references lithos.scans(id) on delete cascade,
  storage_path text not null,            -- lithos-models/<user>/<scan>/model.glb
  full_path text,                        -- .../model_full.usdz (после фоновой загрузки)
  format text not null default 'glb',
  triangles int, bytes int,
  scale_confidence text not null,        -- metric | estimated
  status text not null default 'uploaded',   -- uploaded | processed | failed
  geometry jsonb,                        -- результат S0g (см. §5)
  geometry_version text,                 -- версия алгоритма метрик
  shape_hash text,                       -- геометрический хэш для дедупа/антифрода
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table lithos.cards add column if not exists model_scan_id uuid;    -- откуда брать модель для вьюера
alter table lithos.cards add column if not exists dimensions jsonb;      -- {x_mm,y_mm,z_mm,volume_cm3,density_est,scale_confidence}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lithos-models','lithos-models',false, 8388608, array['model/gltf-binary','model/vnd.usdz+zip'])
on conflict (id) do nothing;
-- политики storage.objects по <user_id>/ как в 0002/0003; RLS scan_models через lithos.scans
```

Размер: 50k треугольников + текстура 1024 в GLB ≈ 2–4 МБ. Free-tier Storage 1 ГБ → ~300 моделей. Для прототипа хватает; в v1 — R2 (общий аккаунт уже есть) с lifecycle «полный USDZ 90 дней».

---

## 5. Воркер: ступень S0g Geometry (детерминированная)

Новый модуль `apps/worker/src/geometry/` (Node, без LLM). Парсинг GLB → позиции/индексы (`@gltf-transform/core`), дальше чистая математика:

| Метрика | Как | Куда идёт |
|---|---|---|
| `bbox_mm` (a ≥ b ≥ c), `volume_cm3`, `surface_area` | PCA-ориентированный bounding box; объём по дивергенции (меш должен быть замкнут — Object Capture даёт водонепроницаемый меш, проверяем и при дырах закрываем) | карточка, плотность |
| `sphericity` (Wadell: (36π V²)^(1/3) / A), `zingg` (b/a, c/b → класс: сфероид / диск / стержень / лезвие) | формулы по объёму/площади/осям | **форма: сфероид/яйцо 8, плоский диск → тег `flat`** |
| `roundness` | средняя кривизна рёбер относительно вписанной сферы (упрощённый Wadell) | тег `rounded` vs `angular` |
| `genus` / сквозное отверстие | эйлерова характеристика χ = V − E + F, genus = (2 − χ)/2; ≥ 1 → есть сквозное отверстие; проверка «естественности» — минимальный диаметр канала ≥ 3 мм и отсутствие острых кромок сверления | **`natural_hole` = 20 — самый ценный балл формы, теперь из геометрии, не из картинки** |
| `roughness` | RMS отклонения нормалей от сглаженного меша | `surface` подсказка: окатан / свежий скол (свежий скол = высокая шероховатость на одной грани + плоскость) |
| `symmetry_score` | сравнение с зеркальным отражением по главным осям | подсказка для «узнаваемый силуэт» (не балл, только флаг для LLM) |
| `density_est` | `volume_cm3` + бакет веса пользователя → диапазон г/см³ (легче < 2,3; обычный 2,3–3,0; тяжелее > 3,0) | подсказка LLM (пемза vs базальт vs гематит), карточка |
| `shape_hash` | D2 shape distribution (гистограмма расстояний между случайными парами точек, 64 бина) | дедуп того же камня при пересъёмке (замена/дополнение pHash), антифрод |

Результат — `GeometryReport` (zod-схема в `packages/shared/src/geometry.ts`, версия `geometry-v1`) в `scan_models.geometry` и в `scan_results(stage='geometry')` для идемпотентности. Все пороги (3 мм, классы Zingg, бакеты плотности) — **в `packages/shared/score.ts`/`geometry.ts`**, по правилу проекта.

Тесты: синтетические меши (сфера, эллипсоид, тор = отверстие, куб, плоская пластина, «картофелина» с шумом) с известными ответами; golden set 3D — 20 реальных сканов с ручными замерами штангенциркулем (приёмка: размеры ±5 % на LiDAR, объём ±10 %).

---

## 6. Как меняется конвейер и score

**S1 Gate** — без изменений, вход `render_front`. Дополнительно: если `geometry.volume_cm3 < 1` или `> 2000` → отказ `too_small` / `too_large` (новые коды для клиента).

**S2 Main (промпт `main-v2`)** — вход: 6 рендеров вместо пользовательских фото (стабильный ракурс/свет), плюс блок:

```
Measured geometry (from 3D scan, metric): {geometry_json}
Treat dimensions, volume, sphericity, hole and density_est as ground truth.
Do not guess shape tags — they are computed; describe only lithology, inclusions, texture and lore.
```

`ScanResult.shape` модель по-прежнему возвращает (схема не меняется — провайдеро-нейтральность §2a), но **S4 её игнорирует**, если есть геометрия. Смена промпта — только через `pnpm eval` на обоих golden set'ах (правило dev-plan §5.8).

**S4 Rules** — `computeScore(result, geo, tests, geometry?)`:
- `shapeLayer`: при `geometry` — из метрик (`natural_hole` по genus; `spheroid` по sphericity ≥ 0.9 и Zingg-классу; `banded` остаётся из модели — это текстура, не форма; `heart`/`crescent` — по `symmetry_score` + подтверждение модели, чтобы не давать 15 за случайную симметрию).
- `qualityLayer`: `has_scale_photo` = true при `scale_confidence='metric'`; `fresh_split` подтверждается `roughness`-паттерном, не только словом модели.
- Новое поле карточки `dimensions`, в `score_breakdown.meta.geometry_version`.
- Стабильность: одинаковый камень → одинаковый `shape_hash` (расстояние ≤ порога) → повтор результата без LLM (расширение pHash-кэша S0).

**Отклонение от spec §6.1**, фиксируем: spec считает форму «по shape_tags из модели»; здесь источник — геометрия. Числа таблицы не меняются.

---

## 7. Антифрод, который 3D даёт бесплатно

- Фото с экрана/распечатки не даёт замкнутого меша → отказ на реконструкции ещё до отправки.
- `shape_hash` ловит один и тот же камень под разными фото лучше pHash (фото с другого ракурса — другой pHash, тот же меш — тот же хэш).
- Объём и плотность против заявленной породы: «пемза» с плотностью 2,9 — аномалия для ревью (`verification='pending_review'`, как гео-аномалия).
- Для будущего grading физический камень сверяется с моделью по размерам и shape_hash — основа «один камень = одна карточка».

---

## 8. Фазы (волны, в стиле dev-plan)

### Волна 5 — 3D на iPhone Pro (4 задачи, ~2 недели)

**T5.1 Нативный модуль захвата** — `expo-object-capture` (§3.1), dev client через EAS, тест на реальном камне 5 см: USDZ с масштабом, время реконструкции, `bbox_mm` против штангенциркуля. Приёмка: 10 сканов, размеры ±5 %.
**T5.2 Экспорт, рендеры, отправка** — GLB ≤ 4 МБ, 6 рендеров с фиксированным светом, миграция `0007`, `submitScan` с моделью, фоновая загрузка USDZ. Приёмка: скан уходит в очередь ≤ 15 с после реконструкции на Wi-Fi.
**T5.3 Ступень S0g Geometry** — `apps/worker/src/geometry/`, shared-схема и пороги, синтетические тесты, golden set 3D (20 сканов). Приёмка: тор → `natural_hole`, сфера → сфероид, пластина → `flat`; объём ±10 %.
**T5.4 Rules + промпт main-v2 + eval** — `computeScore` с геометрией, промпт, `pnpm eval --3d`, сравнение стабильности тира фото vs 3D на одних камнях. Приёмка: стабильность тира при 3 пересканах ≥ 90 % (spec §6.5) на 3D-пути.

### Волна 6 — карточка и опыт (3 задачи, ~1 неделя)

**T6.1 3D-вьюер** на Result/Card (expo-gl + three), кэш GLB, плейсхолдер пока грузится. **T6.2 Размеры/объём/плотность** на карточке и в breakdown; пометка «размеры приблизительно» без LiDAR. **T6.3 Полевой тест 3D** — 20 сканов на пляже, таблица как в T4.2, плюс время реконструкции и доля неудачных сканов (цель ≤ 15 %).

### Волна 7 — не-LiDAR и Android (по метрикам волны 5–6)

Серверная фотограмметрия для серии фото: отдельный контейнер на VPS (`meshroom`/`colmap` + `openMVS`, CPU-режим 5–15 мин на модель) через очередь `scan_batch`; масштаб — по монете в кадре (детекция круга известного диаметра). Это дорого по CPU на общем VPS (3,7 ГБ RAM) — либо отдельный VPS с GPU, либо Fly.io GPU on-demand. Решение — после цифр волны 6.

### Позже

AR «поставить на стол» (RealityKit, USDZ уже есть); печать/шеринг модели; grading по модели; свой классификатор на рендерах + геометрии (spec §11 v1) — 6 фиксированных ракурсов резко упрощают дообучение.

---

## 9. Риски и открытые вопросы

| Риск | Митигирование |
|---|---|
| Реконструкция на телефоне 1–3 мин — длинно против «5 с до карточки» | Разделить: карточка по рендерам приходит как сейчас за секунды (рендеры можно снять из превью-меша `.preview` за ~20 с), полная геометрия и точный score догоняют через Realtime. Показать честно: «Форма уточняется по 3D-модели». |
| Мелкие (< 3 см) и очень блестящие/прозрачные камни (кварц, стекло) реконструируются плохо | Object Capture сам сообщает `feedback`; при провале — автоматический откат на фото-скан без потери снятого. Ловушка «стекло/кварц» из golden set — отдельная проверка. |
| Только iPhone Pro на старте | Продуктово честно: 3D — «премиум-режим», фото-скан остаётся для всех. Доля LiDAR-устройств у целевой аудитории (rockhounds США/UK) выше средней. |
| Object Capture API меняется между iOS | Модуль изолирован, JS-контракт стабилен; версия iOS пишется в `scans.capture`. |
| Уход из Expo Go усложняет тестирование | EAS development build ставится один раз, дальше hot reload как обычно; `expo-dev-client` в eas.json профиль `development`. |
| Storage и трафик | Урезанный GLB на скан, полный USDZ только по Wi-Fi, lifecycle; R2 в v1. |
| Юридически: модель камня как «цифровой двойник» для NFT | Не сейчас (spec §10 v2). |

Открытое: (1) нужен ли пользователю сам 3D-скан, если он в 10 раз дольше фото — ответ даст волна 6 (доля сканов в 3D-режиме среди LiDAR-пользователей ≥ 30 % — сигнал, что механика ценна); (2) нужна ли реконструкция `.medium` или хватит `.reduced` для метрик — решит golden set 3D; (3) вьюер three vs нативный — решить по FPS на iPhone 12 Pro.

---

## 10. Оценка

| Волна | Задач | Календарно | Стоимость API |
|---|---|---|---|
| 5 | 4 | 2 недели (T5.1 — самая рискованная, Swift + Object Capture) | golden set 3D ≈ $3 |
| 6 | 3 | 1 неделя + полевой тест | ≈ $2 |
| 7 | 2–3 | 2 недели + инфра с GPU | зависит от объёма |

Ничего из существующего кода не выбрасывается: фото-скан остаётся дефолтом, 3D — второй `source` с теми же `scan_id`, очередями, карточками и вьюером поверх.
