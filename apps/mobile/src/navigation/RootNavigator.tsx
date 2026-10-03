import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { isWelcomeSeen } from '../lib/prefs';
import { CardScreen } from '../screens/CardScreen';
import { DiaryScreen } from '../screens/DiaryScreen';
import { PolicyScreen } from '../screens/PolicyScreen';
import { PublicFindScreen } from '../screens/PublicFindScreen';
import { ResultScreen } from '../screens/ResultScreen';
import { ReviewScreen } from '../screens/ReviewScreen';
import { SafetyScreen } from '../screens/SafetyScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { colors } from '../theme';
import { TabNavigator } from './TabNavigator';
import { initialRoute as computeInitialRoute, type RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  // Приветствие — читается один раз при старте (prefs.isWelcomeSeen), маршрут считает чистая initialRoute
  // (navigation/types.ts, покрыта тестом). Пока не прочитано, держим пустой тёмный экран: мигания между
  // экранами заметнее, чем 20–30 мс задержки на AsyncStorage.
  const [route, setRoute] = useState<'Welcome' | 'Tabs' | null>(null);

  useEffect(() => {
    let alive = true;
    isWelcomeSeen().then((welcomeSeen) => {
      if (alive) setRoute(computeInitialRoute({ welcomeSeen }));
    });
    return () => { alive = false; };
  }, []);

  if (!route) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <Stack.Navigator
      initialRouteName={route}
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
      <Stack.Screen name="PublicFind" component={PublicFindScreen} options={{ title: 'Находка' }} />
      <Stack.Screen
        name="Policy"
        component={PolicyScreen}
        options={({ route: r }) => ({ title: r.params.doc === 'privacy' ? 'Политика конфиденциальности' : 'Пользовательское соглашение' })}
      />
    </Stack.Navigator>
  );
}
