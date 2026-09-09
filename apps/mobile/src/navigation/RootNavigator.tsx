import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { isWelcomeSeen } from '../lib/prefs';
import { CardScreen } from '../screens/CardScreen';
import { DiaryScreen } from '../screens/DiaryScreen';
import { ResultScreen } from '../screens/ResultScreen';
import { ReviewScreen } from '../screens/ReviewScreen';
import { SafetyScreen } from '../screens/SafetyScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { colors } from '../theme';
import { TabNavigator } from './TabNavigator';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  // Приветствие — один раз (prefs.isWelcomeSeen). Пока флаг не прочитан, держим пустой тёмный экран:
  // мигания между Welcome и Tabs заметнее, чем 20–30 мс задержки на AsyncStorage.
  const [initialRoute, setInitialRoute] = useState<'Welcome' | 'Tabs' | null>(null);

  useEffect(() => {
    let alive = true;
    isWelcomeSeen().then((seen) => { if (alive) setInitialRoute(seen ? 'Tabs' : 'Welcome'); });
    return () => { alive = false; };
  }, []);

  if (!initialRoute) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="Tabs" component={TabNavigator} options={{ headerShown: false }} />
      <Stack.Screen name="Review" component={ReviewScreen} options={{ title: 'Проверка', headerBackTitle: 'Камера' }} />
      <Stack.Screen name="Result" component={ResultScreen} options={{ title: 'Результат', headerBackVisible: false, gestureEnabled: false }} />
      <Stack.Screen name="Card" component={CardScreen} options={{ title: 'Карточка' }} />
      <Stack.Screen name="Safety" component={SafetyScreen} options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="Diary" component={DiaryScreen} options={{ title: 'Дневник места' }} />
    </Stack.Navigator>
  );
}
