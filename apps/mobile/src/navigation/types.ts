// Маршруты прототипа (spec §12). Корневой стек: табы (Камера / Коллекция / Карта / Профиль) + экраны
// поверх табов (Review, Result, Card, Safety, Diary). Детальные экраны открываются из любой вкладки.
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type TabParamList = {
  /** parentCardId — раскол (T2.3): камера открыта для фото свежего скола. */
  Camera: { parentCardId?: string } | undefined;
  Collection: undefined;
  Map: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  /** Приветствие (T5.2): один раз, до первого входа в табы (флаг prefs.isWelcomeSeen). */
  Welcome: undefined;
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  Review: undefined;
  Result: { scanId: string };
  Card: { cardId: string };
  /** Экран безопасности перед первым расколом; после «Понимаю» — Camera с parentCardId. */
  Safety: { parentCardId: string };
  /** Дневник ячейки: cellId — geohash-6 (из карточки); без него — по текущей геопозиции. */
  Diary: { cellId?: string } | undefined;
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;
export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
