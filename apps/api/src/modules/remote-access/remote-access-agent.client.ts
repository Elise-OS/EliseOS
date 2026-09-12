import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { RemoteAccessStatus } from '@michel/contracts';
import { remoteAccessStatusSchema } from '@michel/contracts';
import http from 'node:http';

@Injectable()
export class RemoteAccessAgentClient {
  private readonly socketPath =
    process.env.ELISE_REMOTE_AGENT_SOCKET ?? '/run/elise-remote-access/agent.sock';

  public status(): Promise<RemoteAccessStatus> {
    return this.request('GET', '/status');
  }

  public connect(hostname?: string): Promise<RemoteAccessStatus> {
    return this.request('POST', '/connect', { hostname });
  }

  public enable(): Promise<RemoteAccessStatus> {
    return this.request('POST', '/enable');
  }

  public disable(): Promise<RemoteAccessStatus> {
    return this.request('POST', '/disable');
  }

  private request(
    method: 'GET' | 'POST',
    path: string,
    payload?: Record<string, unknown>,
  ): Promise<RemoteAccessStatus> {
    const body = payload ? JSON.stringify(payload) : '';
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.socketPath,
          path,
          method,
          headers: body
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
            : undefined,
          timeout: 15_000,
        },
        (response) => {
          let output = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (output += chunk));
          response.on('end', () => {
            try {
              const parsed = JSON.parse(output) as unknown;
              if ((response.statusCode ?? 500) >= 400) {
                const message =
                  typeof parsed === 'object' && parsed && 'error' in parsed
                    ? String(parsed.error)
                    : 'Remote access agent rejected the request';
                reject(new ServiceUnavailableException(message));
                return;
              }
              resolve(remoteAccessStatusSchema.parse(parsed));
            } catch (error) {
              reject(
                error instanceof ServiceUnavailableException
                  ? error
                  : new ServiceUnavailableException('Invalid response from remote access agent'),
              );
            }
          });
        },
      );
      request.on('timeout', () => request.destroy(new Error('Agent request timed out')));
      request.on('error', () =>
        reject(new ServiceUnavailableException('Remote access agent is unavailable')),
      );
      request.end(body);
    });
  }
}
