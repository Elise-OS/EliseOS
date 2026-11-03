import {
  type ArgumentsHost,
  Catch,
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';
import { translateDeep } from './english';

/** The caregiver apps send the language chosen on the device with each request. */
export const LOCALE_HEADER = 'x-elise-locale';

const wantsEnglish = (request: Request | undefined) => request?.headers?.[LOCALE_HEADER] === 'en';

// The plan is edited and saved back as a whole: its texts must reach the editor unchanged.
const keepsOriginalTexts = (request: Request) => /\/plan(\/|$)/.test(request.path ?? '');

@Injectable()
export class LocaleInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request | undefined>();
    if (!request || !wantsEnglish(request) || keepsOriginalTexts(request)) return next.handle();
    return next.handle().pipe(map((body: unknown) => translateDeep(body)));
  }
}

@Catch()
export class LocaleExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<Request | undefined>();
    if (!(exception instanceof HttpException) || !wantsEnglish(request))
      return super.catch(exception, host);
    const answer = exception.getResponse();
    const translated = new HttpException(translateDeep(answer), exception.getStatus(), {
      cause: exception,
    });
    return super.catch(translated, host);
  }
}
