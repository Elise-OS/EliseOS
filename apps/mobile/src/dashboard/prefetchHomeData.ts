import type { QueryClient } from '@tanstack/react-query';
import { mobileApi } from '../api';
import type { SavedServer } from '../discovery/types';
import { dateKeyInZone, shiftDate } from './homeDates';

const MAX_INITIAL_WAIT_MS = 20_000;

async function loadHomeData(queryClient: QueryClient, server: SavedServer, token: string) {
  const rootKey = ['michel', server.id] as const;
  const homeSummary = queryClient.fetchQuery({
    queryKey: [...rootKey, 'home-summary'],
    queryFn: () => mobileApi.homeSummary(server, token),
    staleTime: 0,
  });
  const primaryData = Promise.allSettled([
    homeSummary,
    queryClient.fetchQuery({
      queryKey: [...rootKey, 'overview'],
      queryFn: () => mobileApi.overview(server, token),
      staleTime: 0,
    }),
    queryClient.fetchQuery({
      queryKey: [...rootKey, 'screen'],
      queryFn: () => mobileApi.screen(server, token),
      staleTime: 0,
    }),
    queryClient.fetchQuery({
      queryKey: [...rootKey, 'schedule'],
      queryFn: () => mobileApi.schedule(server, token),
      staleTime: 0,
    }),
    queryClient.fetchInfiniteQuery({
      queryKey: [...rootKey, 'activity'],
      queryFn: ({ pageParam }) => mobileApi.activity(server, token, pageParam),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page: Awaited<ReturnType<typeof mobileApi.activity>>) =>
        page.nextCursor ?? undefined,
      staleTime: 0,
    }),
  ]);

  const dailySummaries = homeSummary
    .then(({ timezone }) => {
      const today = dateKeyInZone(new Date(), timezone ?? 'Europe/Paris');
      return Promise.allSettled(
        [today, shiftDate(today, -1)].map((date) =>
          queryClient.fetchQuery({
            queryKey: [...rootKey, 'activity-summary-day', date],
            queryFn: () => mobileApi.activitySummary(server, token, date),
            staleTime: 0,
          }),
        ),
      );
    })
    .catch(() => undefined);

  await Promise.all([primaryData, dailySummaries]);
}

export async function prefetchHomeData(
  queryClient: QueryClient,
  server: SavedServer,
  token: string,
) {
  // A disconnected query can pause indefinitely; let the dashboard show its fallback state.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      loadHomeData(queryClient, server, token).catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, MAX_INITIAL_WAIT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
