import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { onlineManager, QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { isMobileApiNetworkError } from '../src/api';

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      gcTime: 7 * 86_400_000,
      retry: (failureCount, error) => isMobileApiNetworkError(error) && failureCount < 1,
      retryDelay: (attemptIndex) => Math.min(1_000 * 2 ** attemptIndex, 4_000),
    },
    mutations: { retry: 0 },
  },
});

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: '@michel:dashboard-cache',
});

export default function Layout() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 7 * 86_400_000, buster: 'dashboard-v1' }}
    >
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </PersistQueryClientProvider>
  );
}
