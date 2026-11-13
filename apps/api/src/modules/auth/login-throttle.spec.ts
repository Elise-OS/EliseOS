import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller';
import {
  FAILURE_WINDOW_MS,
  LoginThrottle,
  MAX_FAILURES_PER_ACCOUNT,
  MAX_FAILURES_PER_ADDRESS,
} from './login-throttle';

class ClockedThrottle extends LoginThrottle {
  public at = 1_000_000;
  protected override now(): number {
    return this.at;
  }
}

const statusOf = (action: () => void): number | undefined => {
  try {
    action();
    return undefined;
  } catch (error) {
    return error instanceof HttpException ? error.getStatus() : -1;
  }
};

describe('LoginThrottle', () => {
  it('blocks an account after too many wrong passwords, whatever the letter case', () => {
    const throttle = new ClockedThrottle();
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i += 1) {
      expect(statusOf(() => throttle.assertAllowed('Paul', `10.0.0.${i}`))).toBeUndefined();
      throttle.recordFailure('Paul', `10.0.0.${i}`);
    }
    expect(statusOf(() => throttle.assertAllowed('paul', '10.0.0.200'))).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect(statusOf(() => throttle.assertAllowed('marie', '10.0.0.200'))).toBeUndefined();
  });

  it('lets the account try again once the window has passed', () => {
    const throttle = new ClockedThrottle();
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i += 1) throttle.recordFailure('paul', undefined);
    throttle.at += FAILURE_WINDOW_MS;
    expect(statusOf(() => throttle.assertAllowed('paul', undefined))).toBeUndefined();
  });

  it('blocks one address that tries many accounts', () => {
    const throttle = new ClockedThrottle();
    for (let i = 0; i < MAX_FAILURES_PER_ADDRESS; i += 1) {
      throttle.recordFailure(`user-${i}`, '192.168.1.50');
    }
    expect(statusOf(() => throttle.assertAllowed('someone', '192.168.1.50'))).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect(statusOf(() => throttle.assertAllowed('someone', '192.168.1.51'))).toBeUndefined();
  });

  it('forgets the account failures after a successful sign-in', () => {
    const throttle = new ClockedThrottle();
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT - 1; i += 1) throttle.recordFailure('paul', 'a');
    throttle.recordSuccess('PAUL');
    throttle.recordFailure('paul', 'a');
    expect(statusOf(() => throttle.assertAllowed('paul', 'b'))).toBeUndefined();
  });
});

describe('AuthController login throttling', () => {
  it('counts wrong passwords and refuses before checking the password again', async () => {
    const auth = {
      login: vi.fn().mockRejectedValue(new UnauthorizedException('Invalid credentials')),
    };
    const controller = new AuthController(auth as never, new LoginThrottle());
    const request = { ip: '192.168.1.20' } as never;
    const body = { identifier: 'paul', password: 'wrong-password-1' };

    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i += 1) {
      await expect(controller.mobileLogin(body, request)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    await expect(controller.mobileLogin(body, request)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(auth.login).toHaveBeenCalledTimes(MAX_FAILURES_PER_ACCOUNT);
  });
});
