// Маршруты прототипа (spec §12). Result/Card/Collection/Map/Profile — заглушки до волн 2–3.
export type RootStackParamList = {
  Camera: undefined;
  Review: undefined;
  Result: { scanId: string };
  Card: { cardId: string };
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
