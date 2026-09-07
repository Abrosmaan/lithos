// Черновик скана, общий для Camera и Review (в params навигации не кладём — несериализуемо и громоздко).
// scan_id живёт здесь до успешной отправки: повтор после сбоя — тот же id; любое изменение — новый.
import type { UserTests } from '@lithos/shared';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { deleteFileQuietly } from './preflight';
import { type DraftPhoto, MAX_PHOTOS } from './scan';

export type DraftTests = Omit<UserTests, 'has_scale_photo'>;

const EMPTY_TESTS: DraftTests = { weight: null, scratch: null, wet: null };

interface ScanDraft {
  photos: DraftPhoto[];
  tests: DraftTests;
  scanId: string | null;
  /** Раскол: id закрытой родительской карточки; null — обычный скан. */
  parentCardId: string | null;
  addPhoto: (photo: Omit<DraftPhoto, 'isScale'>) => void;
  removePhoto: (index: number) => void;
  setScalePhoto: (index: number | null) => void;
  setTests: (patch: Partial<DraftTests>) => void;
  setScanId: (id: string | null) => void;
  /** Начать раскол: очистить черновик и запомнить родителя. */
  startSplit: (parentCardId: string) => void;
  reset: () => void;
}

const Ctx = createContext<ScanDraft | null>(null);

export function ScanDraftProvider({ children }: { children: ReactNode }) {
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [tests, setTestsState] = useState<DraftTests>(EMPTY_TESTS);
  const [scanId, setScanId] = useState<string | null>(null);
  const [parentCardId, setParentCardId] = useState<string | null>(null);

  const addPhoto = useCallback((photo: Omit<DraftPhoto, 'isScale'>) => {
    setPhotos((prev) => (prev.length >= MAX_PHOTOS ? prev : [...prev, { ...photo, isScale: false }]));
    setScanId(null);
  }, []);
  const removePhoto = useCallback((index: number) => {
    setPhotos((prev) => {
      const gone = prev[index];
      if (gone) deleteFileQuietly(gone.uri);
      return prev.filter((_, i) => i !== index);
    });
    setScanId(null);
  }, []);
  const setScalePhoto = useCallback((index: number | null) => {
    setPhotos((prev) => prev.map((p, i) => ({ ...p, isScale: i === index })));
    setScanId(null);
  }, []);
  const setTests = useCallback((patch: Partial<DraftTests>) => {
    setTestsState((prev) => ({ ...prev, ...patch }));
    setScanId(null);
  }, []);
  const reset = useCallback(() => {
    setPhotos((prev) => {
      prev.forEach((p) => deleteFileQuietly(p.uri));
      return [];
    });
    setTestsState(EMPTY_TESTS);
    setScanId(null);
    setParentCardId(null);
  }, []);
  const startSplit = useCallback((id: string) => {
    reset();
    setParentCardId(id);
  }, [reset]);

  const value = useMemo<ScanDraft>(
    () => ({ photos, tests, scanId, parentCardId, addPhoto, removePhoto, setScalePhoto, setTests, setScanId, startSplit, reset }),
    [photos, tests, scanId, parentCardId, addPhoto, removePhoto, setScalePhoto, setTests, startSplit, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useScanDraft(): ScanDraft {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useScanDraft вне ScanDraftProvider');
  return ctx;
}
