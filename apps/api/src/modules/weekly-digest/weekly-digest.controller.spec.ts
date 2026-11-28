import { BadRequestException, StreamableFile } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { WeeklyDigestController } from './weekly-digest.controller';
import type { WeeklyDigestService } from './weekly-digest.service';

const request = (locale?: string) =>
  ({
    userId: 'user-1',
    headers: locale ? { 'x-elise-locale': locale } : {},
  }) as unknown as AuthenticatedRequest;

function controller() {
  const digests = {
    digest: vi.fn().mockResolvedValue({ weekStart: '2026-11-16' }),
    pdf: vi.fn().mockResolvedValue({
      fileName: 'weekly-summary-2026-11-16.pdf',
      bytes: new Uint8Array([37, 80, 68, 70]),
    }),
  };
  return {
    digests,
    controller: new WeeklyDigestController(digests as unknown as WeeklyDigestService),
  };
}

describe('WeeklyDigestController', () => {
  it('reads the week asked for, and refuses a date that is not one', async () => {
    const { digests, controller: api } = controller();
    await api.digest(request(), { week: '2026-11-18' });
    expect(digests.digest).toHaveBeenCalledWith('user-1', '2026-11-18');
    expect(() => api.digest(request(), { week: '18/11/2026' })).toThrow(BadRequestException);
  });

  it('sends the PDF as a download, in the language of the app', async () => {
    const { digests, controller: api } = controller();
    const response = { set: vi.fn() };
    const file = await api.pdf(request('en-GB'), {}, response as never);
    expect(digests.pdf).toHaveBeenCalledWith('user-1', undefined, 'en');
    expect(file).toBeInstanceOf(StreamableFile);
    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Disposition': 'attachment; filename="weekly-summary-2026-11-16.pdf"',
      }),
    );
    await api.pdf(request('en-GB'), { lang: 'it', week: '2026-11-16' }, response as never);
    expect(digests.pdf).toHaveBeenLastCalledWith('user-1', '2026-11-16', 'it');
  });
});
