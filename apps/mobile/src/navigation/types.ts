// Маршруты прототипа (spec §12). Map/Profile — заглушки до волны 3.
export type RootStackParamList = {
  /** parentCardId — раскол (T2.3): камера открыта для фото свежего скола. */
  Camera: { parentCardId?: string } | undefined;
  Review: undefined;
  Result: { scanId: string };
  Card: { cardId: string };
  /** Экран безопасности перед первым расколом; после «Понимаю» — Camera с parentCardId. */
  Safety: { parentCardId: string };
  Collection: undefined;
  Map: undefined;
  Profile: undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
