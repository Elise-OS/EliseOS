import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  updateCredentialsSchema,
  updateStatusSchema,
  type UpdateCredentials,
  type UpdateStatus,
} from '@michel/contracts';
import http from 'node:http';

@Injectable()
export class UpdateAgentClient {
  private readonly socketPath =
    process.env.ELISE_UPDATE_AGENT_SOCKET ?? '/run/elise-update/agent.sock';

  public status(): Promise<UpdateStatus> {
    return this.request('GET', '/status');
  }

  public check(): Promise<UpdateStatus> {
    return this.request('GET', '/check');
  }

  public credentials(input: UpdateCredentials): Promise<UpdateStatus> {
    return this.request('POST', '/credentials', updateCredentialsSchema.parse(input));
  }

  public deleteCredentials(): Promise<UpdateStatus> {
    return this.request('POST', '/credentials/delete');
  }

  public install(version: string): Promise<UpdateStatus> {
    return this.request('POST', '/install', { version });
  }

  private request(
    method: 'GET' | 'POST',
    path: string,
    payload?: Record<string, unknown>,
  ): Promise<UpdateStatus> {
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
          timeout: 20_000,
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
                    : 'Update agent rejected the request';
                reject(new ServiceUnavailableException(message));
                return;
              }
              resolve(updateStatusSchema.parse(parsed));
            } catch (error) {
              reject(
                error instanceof ServiceUnavailableException
                  ? error
                  : new ServiceUnavailableException('Invalid response from update agent'),
              );
            }
          });
        },
      );
      request.on('timeout', () => request.destroy(new Error('Update agent request timed out')));
      request.on('error', () =>
        reject(new ServiceUnavailableException('Update agent is unavailable')),
      );
      request.end(body);
    });
  }
}
