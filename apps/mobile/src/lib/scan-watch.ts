// Наблюдение за сканом: Supabase Realtime (postgres_changes на lithos.scans / lithos.cards по scan_id)
// + резервный polling каждые 2 с с backoff, если подписка не подтвердилась за 3 с или отвалилась.
// Любое событие → перечитать scans и cards (payload не доверяем: RLS может урезать строку).
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { ensureSession } from './auth';
import type { CardRow, ScanRow } from './card-types';
import { fetchCardByScan, fetchScan } from './cards';
import { logError, MSG, toUserMessage } from './errors';
import { isTerminalSnapshot } from './result-text';
import { supabase } from './supabase';

export const REALTIME_CONFIRM_MS = 3_000;
export const POLL_BASE_MS = 2_000;
export const POLL_MAX_MS = 10_000;
export const POLL_BACKOFF = 1.5;

export interface ScanSnapshot {
  scan: ScanRow | null;
  card: CardRow | null;
}

export interface WatchCallbacks {
  onSnapshot: (s: ScanSnapshot) => void;
  onError: (message: string) => void;
  /** Наблюдение остановлено без карточки (done, а cards так и не появилась) — дальше ждать бессмысленно. */
  onGaveUp?: () => void;
}

export type WatchMode = 'connecting' | 'realtime' | 'polling';


/** Запускает наблюдение; возвращает stop(). Останавливается сам после done/failed. */
export function watchScan(scanId: string, cb: WatchCallbacks, onMode?: (m: WatchMode) => void): () => void {
  let stopped = false;
  let channel: RealtimeChannel | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  let pollDelay = POLL_BASE_MS;
  let inflight: Promise<void> | null = null;
  let done = false;
  let polling = false;
  let dirty = false; // событие пришло, пока читали — перечитать ещё раз после текущего чтения
  let doneWithoutCard = 0; // stage=done, а строки cards ещё нет — ждём ограниченно

  const refresh = (): Promise<void> => {
    if (inflight) { dirty = true; return inflight; }
    inflight = (async () => {
      try {
        const [scan, card] = await Promise.all([fetchScan(scanId), fetchCardByScan(scanId)]);
        if (stopped) return;
        const snap = { scan, card };
        cb.onSnapshot(snap);
        if (scan?.stage === 'done' && !card) {
          doneWithoutCard++;
          restartPolling(POLL_BASE_MS); // событий по scans больше не будет — дочитываем cards частым опросом
        }
        if (isTerminalSnapshot(scan?.stage ?? null, card !== null, doneWithoutCard)) {
          finish();
          if (!card) cb.onGaveUp?.();
        }
      } catch (e) {
        if (stopped) return;
        logError('watch.refresh', e);
        cb.onError(toUserMessage(e, MSG.loadFailed));
      } finally {
        inflight = null;
        if (dirty && !stopped) { dirty = false; void refresh(); }
      }
    })();
    return inflight;
  };

  const schedulePoll = () => {
    if (stopped || done || !polling) return;
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      await refresh();
      pollDelay = Math.min(POLL_MAX_MS, Math.round(pollDelay * POLL_BACKOFF));
      schedulePoll();
    }, pollDelay);
  };

  /** announce=false — страховочный опрос в режиме realtime (mode не меняем). */
  const startPolling = (initialDelay: number = POLL_BASE_MS, announce: boolean = true) => {
    if (polling || stopped || done) return;
    polling = true;
    if (announce) onMode?.('polling');
    pollDelay = initialDelay;
    schedulePoll();
  };

  const stopPolling = () => {
    polling = false;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  };

  /** Перезапустить опрос с заданным интервалом, даже если цикл уже идёт (страховочный 10 с → частый 2 с). */
  const restartPolling = (delay: number) => {
    if (stopped || done) return;
    stopPolling();
    startPolling(delay, false);
  };

  const finish = () => {
    done = true;
    stop();
  };

  const stop = () => {
    stopped = true;
    stopPolling();
    if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
    if (channel) { void supabase.removeChannel(channel); channel = null; }
  };

  const subscribe = async () => {
    try {
      const session = await ensureSession();
      if (stopped) return;
      supabase.realtime.setAuth(session.access_token);
    } catch (e) {
      logError('watch.auth', e);
    }
    if (stopped) return;
    const onChange = () => { void refresh(); };
    channel = supabase
      .channel(`scan:${scanId}`)
      .on('postgres_changes', { event: '*', schema: 'lithos', table: 'scans', filter: `id=eq.${scanId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'lithos', table: 'cards', filter: `scan_id=eq.${scanId}` }, onChange)
      .subscribe((status) => {
        if (stopped) return;
        if (status === 'SUBSCRIBED') {
          if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
          onMode?.('realtime');
          // SUBSCRIBED приходит и когда таблица не в публикации / RLS Realtime молча режет события —
          // поэтому опрос не выключаем, а переводим на редкий страховочный интервал.
          stopPolling();
          startPolling(POLL_MAX_MS, false);
          void refresh(); // что могло измениться, пока подписывались
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          onMode?.('polling');
          restartPolling(POLL_BASE_MS);
        }
      });
    confirmTimer = setTimeout(() => { confirmTimer = null; startPolling(); }, REALTIME_CONFIRM_MS);
  };

  onMode?.('connecting');
  void refresh();
  void subscribe();
  return stop;
}

export interface ScanWatchState extends ScanSnapshot {
  error: string | null;
  mode: WatchMode;
  /** Наблюдение сдалось: скан done, карточки нет — показывать «обрабатываем дольше обычного». */
  gaveUp: boolean;
  /** Обновление вручную (кнопка «Обновить» при ошибке). */
  reload: () => void;
}

export function useScanWatch(scanId: string): ScanWatchState {
  const [snap, setSnap] = useState<ScanSnapshot>({ scan: null, card: null });
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<WatchMode>('connecting');
  const [gaveUp, setGaveUp] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setError(null);
    setGaveUp(false);
    stopRef.current = watchScan(
      scanId,
      { onSnapshot: (s) => { setSnap(s); setError(null); }, onError: setError, onGaveUp: () => setGaveUp(true) },
      setMode,
    );
    return () => { stopRef.current?.(); stopRef.current = null; };
  }, [scanId, epoch]);

  return { ...snap, error, mode, gaveUp, reload: () => setEpoch((e) => e + 1) };
}
