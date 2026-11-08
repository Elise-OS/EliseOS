import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  type HttpException,
} from '@nestjs/common';
import {
  zigbeeInstallSchema,
  zigbeeProbeResultSchema,
  zigbeeStatusSchema,
  type ZigbeeInstall,
  type ZigbeeProbeResult,
  type ZigbeeStatus,
} from '@elise/contracts';
import http from 'node:http';
import type { z } from 'zod';

/** Message of the 503 returned when the box has no (or a stopped) Zigbee agent. */
export const ZIGBEE_AGENT_UNAVAILABLE = 'ZIGBEE_AGENT_UNAVAILABLE';

/**
 * Talks to the root agent of the box over its Unix socket. Only fixed paths and validated JSON
 * go through: the agent never runs anything the API sends it.
 */
@Injectable()
export class ZigbeeAgentClient {
  private readonly socketPath =
    process.env.ELISE_ZIGBEE_AGENT_SOCKET ?? '/run/elise-zigbee/agent.sock';

  public status(): Promise<ZigbeeStatus> {
    return this.request('GET', '/status', zigbeeStatusSchema);
  }

  public scan(network: boolean): Promise<ZigbeeStatus> {
    return this.request('POST', '/scan', zigbeeStatusSchema, { network });
  }

  public probe(candidateId: string): Promise<ZigbeeProbeResult> {
    return this.request('POST', '/probe', zigbeeProbeResultSchema, { candidateId }, 40_000);
  }

  public testNetwork(host: string, port: number): Promise<ZigbeeProbeResult> {
    return this.request('POST', '/network/test', zigbeeProbeResultSchema, { host, port });
  }

  public forgetNetwork(candidateId: string): Promise<ZigbeeStatus> {
    return this.request('POST', '/network/forget', zigbeeStatusSchema, { candidateId });
  }

  public install(payload: Record<string, unknown>): Promise<ZigbeeInstall> {
    return this.request('POST', '/install', zigbeeInstallSchema, payload);
  }

  public installProgress(): Promise<ZigbeeInstall> {
    return this.request('GET', '/install', zigbeeInstallSchema);
  }

  public cancelInstall(): Promise<ZigbeeInstall> {
    return this.request('POST', '/install/cancel', zigbeeInstallSchema);
  }

  private request<TSchema extends z.ZodType>(
    method: 'GET' | 'POST',
    path: string,
    schema: TSchema,
    payload?: Record<string, unknown>,
    timeout = 20_000,
  ): Promise<z.infer<TSchema>> {
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
          timeout,
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
                    : 'Zigbee agent rejected the request';
                reject(
                  response.statusCode === 400
                    ? new BadRequestException({ code: 'ZIGBEE_REQUEST_REFUSED', message })
                    : new ServiceUnavailableException(message),
                );
                return;
              }
              resolve(schema.parse(parsed));
            } catch (error) {
              reject(
                isHttpException(error)
                  ? error
                  : new ServiceUnavailableException('Invalid response from Zigbee agent'),
              );
            }
          });
        },
      );
      request.on('timeout', () => request.destroy(new Error('Zigbee agent request timed out')));
      request.on('error', () => reject(new ServiceUnavailableException(ZIGBEE_AGENT_UNAVAILABLE)));
      request.end(body);
    });
  }
}

function isHttpException(error: unknown): error is HttpException {
  return error instanceof BadRequestException || error instanceof ServiceUnavailableException;
}
