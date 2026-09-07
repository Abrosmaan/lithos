// Клиент Supabase для приложения: схема lithos, сессия в AsyncStorage, только anon-ключ.
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { ENV_OK, SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

// При отсутствии env клиент всё равно создаётся (иначе падает импорт и приложение не стартует);
// App показывает экран «не настроено» и до сетевых вызовов дело не доходит.
export const supabase = createClient(ENV_OK ? SUPABASE_URL : 'https://env-missing.invalid', ENV_OK ? SUPABASE_ANON_KEY : 'missing', {
  db: { schema: 'lithos' },
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Обновление токена только пока приложение на экране (рекомендация supabase-js для RN).
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
