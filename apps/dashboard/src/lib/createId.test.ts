import { afterEach, describe, expect, it, vi } from 'vitest';
import { createId } from './createId';

describe('createId', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses crypto.randomUUID when it is available', () => {
    const randomUUID = vi.fn(() => 'f6e83cac-9465-4d42-8d2a-8fa6f6b5b5f0');
    vi.stubGlobal('crypto', { randomUUID });

    expect(createId()).toBe('f6e83cac-9465-4d42-8d2a-8fa6f6b5b5f0');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('creates a v4 UUID with getRandomValues when randomUUID is unavailable', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(0));
    vi.stubGlobal('crypto', { getRandomValues });

    expect(createId()).toBe('00000000-0000-4000-8000-000000000000');
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it('creates a v4 UUID when crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    expect(createId()).toBe('00000000-0000-4000-8000-000000000000');
  });
});
