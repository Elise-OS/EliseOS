import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { SavedServer } from './discovery/types';
import { mobileApi } from './api';

const navigationListeners = new Set<() => void>();

Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
});

Notifications.addNotificationResponseReceivedListener((response) => {
  const data = response.notification.request.content.data;
  if (data && (data.kind === 'alert' || data.alertId))
    navigationListeners.forEach((listener) => listener());
});

export const subscribeNotificationNavigation = (listener: () => void) => {
  navigationListeners.add(listener);
  return () => {
    navigationListeners.delete(listener);
  };
};

export async function registerPushNotifications(server: SavedServer, token: string): Promise<void> {
  if (!Device.isDevice || Platform.OS === 'web') return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Informations Élise',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const permission =
    current.status === Notifications.PermissionStatus.GRANTED
      ? current
      : await Notifications.requestPermissionsAsync();
  if (permission.status !== Notifications.PermissionStatus.GRANTED) return;
  const publicProjectId: unknown = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  const extra: unknown = Constants.expoConfig?.extra;
  const extraProjectId =
    extra && typeof extra === 'object' && 'eas' in extra
      ? (extra.eas as { projectId?: unknown } | undefined)?.projectId
      : undefined;
  const projectId =
    typeof publicProjectId === 'string'
      ? publicProjectId
      : (Constants.easConfig?.projectId ??
        (typeof extraProjectId === 'string' ? extraProjectId : undefined));
  if (!projectId) return;
  const expoPushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const deviceName = Device.deviceName ?? Device.modelName ?? undefined;
  await mobileApi.registerPush(server, token, {
    expoPushToken,
    platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
    ...(deviceName ? { deviceName } : {}),
  });
}
