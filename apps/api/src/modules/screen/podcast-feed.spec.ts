import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]),
}));

import { fetchPodcastEpisodes } from './podcast-feed';

describe('podcast RSS feeds', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads episodes from feeds larger than the former 3 MiB limit', async () => {
    const description = 'x'.repeat(11 * 1024 * 1024 + 1);
    const xml = `<rss><channel><item><title>Épisode récent</title><enclosure url="https://feeds.example.test/episode.mp3" type="audio/mpeg"/><description>${description}</description></item></channel></rss>`;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(xml, {
          headers: { 'content-length': String(Buffer.byteLength(xml)) },
        }),
      ),
    );

    const episodes = await fetchPodcastEpisodes('https://feeds.example.test/show.xml');

    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.title).toBe('Épisode récent');
  });
});
