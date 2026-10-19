import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { SavedServer } from './discovery/types';
import { mobileApi } from './api';

export type NotificationDestination = 'alerts' | 'journal';
export type PushRegistrationStatus =
  'registered' | 'permission-denied' | 'device-required' | 'project-id-missing';

const navigationListeners = new Set<(destination: NotificationDestination) => void>();
let pendingDestination: NotificationDestination | null = null;
let handledResponseId: string | null = null;

function handleNotificationResponse(response: Notifications.NotificationResponse) {
  const responseId = response.notification.request.identifier;
  if (handledResponseId === responseId) return;
  handledResponseId = responseId;
  const data = response.notification.request.content.data;
  if (!data) return;
  const destination =
    data.kind === 'liaison' ? 'journal' : data.kind === 'alert' || data.alertId ? 'alerts' : null;
  if (!destination) return;
  if (navigationListeners.size === 0) pendingDestination = destination;
  else navigationListeners.forEach((listener) => listener(destination));
}

Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
});

Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
void Notifications.getLastNotificationResponseAsync()
  .then((response) => {
    if (response) handleNotificationResponse(response);
  })
  .catch(() => undefined);

export const subscribeNotificationNavigation = (
  listener: (destination: NotificationDestination) => void,
) => {
  navigationListeners.add(listener);
  if (pendingDestination) {
    listener(pendingDestination);
    pendingDestination = null;
  }
  return () => {
    navigationListeners.delete(listener);
  };
};

export async function registerPushNotifications(
  server: SavedServer,
  token: string,
): Promise<PushRegistrationStatus> {
  if (!Device.isDevice || Platform.OS === 'web') return 'device-required';
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
  if (permission.status !== Notifications.PermissionStatus.GRANTED) return 'permission-denied';
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
  if (!projectId) return 'project-id-missing';
  const expoPushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const deviceName = Device.deviceName ?? Device.modelName ?? undefined;
  await mobileApi.registerPush(server, token, {
    expoPushToken,
    platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
    ...(deviceName ? { deviceName } : {}),
  });
  return 'registered';
}
