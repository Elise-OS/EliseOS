import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { DiscoveredServer, SavedServer } from './types';

const SERVERS_KEY = '@michel:servers';
const LAST_SERVER_KEY = '@michel:last-server';
const tokenKey = (serverId: string) =>
  `michel-session-${serverId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
const webTokens = new Map<string, string>();

const webSessionStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const readServers = async (): Promise<SavedServer[]> => {
  const raw = await AsyncStorage.getItem(SERVERS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SavedServer[];
  } catch {
    return [];
  }
};

export class ServerRegistry {
  static async list(): Promise<SavedServer[]> {
    return (await readServers()).sort((a, b) => b.lastConnectedAt.localeCompare(a.lastConnectedAt));
  }

  static async last(): Promise<SavedServer | null> {
    const [id, servers] = await Promise.all([AsyncStorage.getItem(LAST_SERVER_KEY), this.list()]);
    return id ? (servers.find((server) => server.id === id) ?? null) : null;
  }

  static async save(server: DiscoveredServer): Promise<SavedServer> {
    const servers = await this.list();
    const previous = servers.find((item) => item.instanceId === server.instanceId);
    const urls = [
      ...new Set(
        [
          server.url,
          ...(previous?.urls ?? [previous?.url].filter((value): value is string => Boolean(value))),
          server.localUrl,
          server.remoteUrl,
        ].filter((value): value is string => Boolean(value)),
      ),
    ];
    const saved: SavedServer = {
      id: server.instanceId,
      instanceId: server.instanceId,
      instanceName: server.instanceName,
      version: server.version,
      apiVersion: server.apiVersion,
      serverTime: server.serverTime,
      supportsMobile: true,
      setupRequired: server.setupRequired,
      url: server.url,
      urls,
      localUrl: server.localUrl ?? previous?.localUrl ?? null,
      remoteUrl:
        server.remoteUrl ??
        (server.url.startsWith('https://') ? server.url : previous?.remoteUrl) ??
        null,
      source: server.source,
      lastConnectedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(
      SERVERS_KEY,
      JSON.stringify([saved, ...servers.filter((item) => item.instanceId !== saved.instanceId)]),
    );
    await AsyncStorage.setItem(LAST_SERVER_KEY, saved.id);
    return saved;
  }

  static async remember(server: SavedServer): Promise<void> {
    await AsyncStorage.setItem(LAST_SERVER_KEY, server.id);
  }

  static async saveToken(serverId: string, token: string): Promise<void> {
    if (Platform.OS === 'web') {
      const key = tokenKey(serverId);
      webTokens.set(key, token);
      try {
        webSessionStorage()?.setItem(key, token);
      } catch {
        // Keep the token in memory for this tab if browser storage is unavailable.
      }
      return;
    }
    await SecureStore.setItemAsync(tokenKey(serverId), token);
  }

  static async token(serverId: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      const key = tokenKey(serverId);
      try {
        const stored = webSessionStorage()?.getItem(key);
        if (stored) {
          webTokens.set(key, stored);
          return stored;
        }
      } catch {
        // Fall back to the in-memory token for this tab.
      }
      return webTokens.get(key) ?? null;
    }
    return SecureStore.getItemAsync(tokenKey(serverId));
  }

  static async clearToken(serverId: string): Promise<void> {
    if (Platform.OS === 'web') {
      const key = tokenKey(serverId);
      webTokens.delete(key);
      try {
        webSessionStorage()?.removeItem(key);
      } catch {
        // The in-memory copy is already cleared.
      }
    } else {
      await SecureStore.deleteItemAsync(tokenKey(serverId));
    }
    await AsyncStorage.removeItem(LAST_SERVER_KEY);
  }
}
