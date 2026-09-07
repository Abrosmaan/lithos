import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CameraScreen } from '../screens/CameraScreen';
import { CardScreen } from '../screens/CardScreen';
import { CollectionScreen } from '../screens/CollectionScreen';
import { ResultScreen } from '../screens/ResultScreen';
import { ReviewScreen } from '../screens/ReviewScreen';
import { SafetyScreen } from '../screens/SafetyScreen';
import { MapScreen, ProfileScreen } from '../screens/Stubs';
import { colors } from '../theme';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Camera"
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="Camera" component={CameraScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Review" component={ReviewScreen} options={{ title: 'Проверка', headerBackTitle: 'Камера' }} />
      <Stack.Screen name="Result" component={ResultScreen} options={{ title: 'Результат', headerBackVisible: false, gestureEnabled: false }} />
      <Stack.Screen name="Card" component={CardScreen} options={{ title: 'Карточка' }} />
      <Stack.Screen name="Safety" component={SafetyScreen} options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="Collection" component={CollectionScreen} options={{ title: 'Коллекция' }} />
      <Stack.Screen name="Map" component={MapScreen} options={{ title: 'Карта' }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Профиль' }} />
    </Stack.Navigator>
  );
}
