import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CardScreen } from '../screens/CardScreen';
import { DiaryScreen } from '../screens/DiaryScreen';
import { ResultScreen } from '../screens/ResultScreen';
import { ReviewScreen } from '../screens/ReviewScreen';
import { SafetyScreen } from '../screens/SafetyScreen';
import { colors } from '../theme';
import { TabNavigator } from './TabNavigator';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Tabs"
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="Tabs" component={TabNavigator} options={{ headerShown: false }} />
      <Stack.Screen name="Review" component={ReviewScreen} options={{ title: 'Проверка', headerBackTitle: 'Камера' }} />
      <Stack.Screen name="Result" component={ResultScreen} options={{ title: 'Результат', headerBackVisible: false, gestureEnabled: false }} />
      <Stack.Screen name="Card" component={CardScreen} options={{ title: 'Карточка' }} />
      <Stack.Screen name="Safety" component={SafetyScreen} options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="Diary" component={DiaryScreen} options={{ title: 'Дневник места' }} />
    </Stack.Navigator>
  );
}
