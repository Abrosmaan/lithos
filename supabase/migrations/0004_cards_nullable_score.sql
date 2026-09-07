-- ============================================================================
-- LITHOS — 0004 (T2.1): карточка без гео — без score и тира (spec §4.1: «без гео — только
-- определение, карточка без score»; shared.computeScore отдаёт score/tier = null). Идемпотентно.
-- ============================================================================
alter table lithos.cards alter column score drop not null;
alter table lithos.cards alter column tier drop not null;

comment on column lithos.cards.score is 'null — скан без гео (spec §4.1); breakdown.internal_score считается всегда';
comment on column lithos.cards.tier is 'null — скан без гео (spec §4.1); fallback-провайдер ограничивает тир shared.FALLBACK_MAX_TIER';
