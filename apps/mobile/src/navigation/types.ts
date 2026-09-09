// Маршруты прототипа (spec §12). Корневой стек: табы (Камера / Коллекция / Карта / Профиль) + экраны
// поверх табов (Review, Result, Card, Safety, Diary). Детальные экраны открываются из любой вкладки.
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CONSENT_VERSION } from '../lib/prefs';
import type { PublicFindRow } from '../lib/publish';

/** Документ политики (apps/mobile/src/legal/) — какой из двух показывает PolicyScreen. */
export type LegalDoc = 'privacy' | 'terms';

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
  /** Пересогласие (T6.1, docs/legal/consent-copy.md §2): welcomeSeen=true, но consentVersion устарела. */
  Consent: undefined;
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  Review: undefined;
  Result: { scanId: string };
  Card: { cardId: string };
  /** Экран безопасности перед первым расколом; после «Понимаю» — Camera с parentCardId. */
  Safety: { parentCardId: string };
  /** Дневник ячейки: cellId — geohash-6 (из карточки); без него — по текущей геопозиции. */
  Diary: { cellId?: string } | undefined;
  /** Политика конфиденциальности / пользовательское соглашение — офлайн-текст из apps/mobile/src/legal/. */
  Policy: { doc: LegalDoc };
  /**
   * Чужая находка (T6.1-E2, публичная витрина): только чтение, без действий владельца. Параметр — уже
   * загруженная строка lithos.public_finds (с карты или из дневника места), а не id: отдельного запроса
   * «получить находку по id» в lib/publish.ts нет — поверхность там сознательно узкая (T6.1-D).
   */
  PublicFind: { find: PublicFindRow };
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;
export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

export interface InitialRouteInput {
  welcomeSeen: boolean;
  /** Версия согласия, сохранённая на устройстве (prefs.getConsentVersion(), 0 если не читалась). */
  consentVersion: number;
}

/**
 * Стартовый маршрут корневого стека (RootNavigator): чистая функция, без AsyncStorage/навигации —
 * покрывается тестом отдельно от рендера. Не видел приветствия → Welcome; видел, но согласие устарело
 * (consentVersion < CONSENT_VERSION) → Consent; иначе — сразу в табы.
 */
export function initialRoute({ welcomeSeen, consentVersion }: InitialRouteInput): 'Welcome' | 'Consent' | 'Tabs' {
  if (!welcomeSeen) return 'Welcome';
  if (consentVersion < CONSENT_VERSION) return 'Consent';
  return 'Tabs';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
