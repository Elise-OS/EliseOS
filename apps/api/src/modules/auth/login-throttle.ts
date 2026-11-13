import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/** Wrong passwords tolerated for one account before Élise asks to wait. */
export const MAX_FAILURES_PER_ACCOUNT = 10;
/** Wrong passwords tolerated from one address, whatever the accounts tried. */
export const MAX_FAILURES_PER_ADDRESS = 30;
export const FAILURE_WINDOW_MS = 15 * 60_000;

export const TOO_MANY_ATTEMPTS_MESSAGE =
  'Trop de tentatives de connexion. Réessayez dans quelques minutes.';

interface Failures {
  count: number;
  firstAt: number;
}

/**
 * Slows down password guessing on the login routes. Counters live in memory: the API is a
 * single process on the home box, and a restart only gives a guesser a fresh window.
 */
@Injectable()
export class LoginThrottle {
  private readonly accounts = new Map<string, Failures>();
  private readonly addresses = new Map<string, Failures>();

  /** Overridable clock, for tests. */
  protected now(): number {
    return Date.now();
  }

  /** Refuses the attempt while the account or the address is cooling down. */
  public assertAllowed(account: string, address: string | undefined): void {
    const waitMs = Math.max(
      this.remainingBlock(this.accounts, account.toLowerCase(), MAX_FAILURES_PER_ACCOUNT),
      address ? this.remainingBlock(this.addresses, address, MAX_FAILURES_PER_ADDRESS) : 0,
    );
    if (waitMs > 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: TOO_MANY_ATTEMPTS_MESSAGE,
          retryAfterSeconds: Math.ceil(waitMs / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  public recordFailure(account: string, address: string | undefined): void {
    this.bump(this.accounts, account.toLowerCase());
    if (address) this.bump(this.addresses, address);
    this.prune();
  }

  public recordSuccess(account: string): void {
    this.accounts.delete(account.toLowerCase());
  }

  private remainingBlock(map: Map<string, Failures>, key: string, limit: number): number {
    const entry = map.get(key);
    if (!entry) return 0;
    const elapsed = this.now() - entry.firstAt;
    if (elapsed >= FAILURE_WINDOW_MS) {
      map.delete(key);
      return 0;
    }
    return entry.count >= limit ? FAILURE_WINDOW_MS - elapsed : 0;
  }

  private bump(map: Map<string, Failures>, key: string): void {
    const entry = map.get(key);
    if (!entry || this.now() - entry.firstAt >= FAILURE_WINDOW_MS) {
      map.set(key, { count: 1, firstAt: this.now() });
    } else {
      entry.count += 1;
    }
  }

  // Keeps memory bounded when many different names or addresses are tried.
  private prune(): void {
    if (this.accounts.size + this.addresses.size < 5_000) return;
    const now = this.now();
    for (const map of [this.accounts, this.addresses]) {
      for (const [key, entry] of map) {
        if (now - entry.firstAt >= FAILURE_WINDOW_MS) map.delete(key);
      }
    }
  }
}
