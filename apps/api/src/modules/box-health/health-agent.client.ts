import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import http from 'node:http';

@Injectable()
export class HealthAgentClient {
  private readonly socketPath = process.env.ELISE_HEALTH_AGENT_SOCKET ?? '/run/elise-health/agent.sock';

  public status(): Promise<Record<string, any>> { return this.request('GET', '/status'); }
  public backup(): Promise<{ accepted: boolean }> { return this.request('POST', '/backup'); }

  private request<T>(method: 'GET' | 'POST', path: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = http.request({ socketPath: this.socketPath, path, method, timeout: 5000 }, (res) => {
        let output = ''; res.setEncoding('utf8'); res.on('data', (chunk) => output += chunk);
        res.on('end', () => {
          try { const value: unknown = JSON.parse(output); if ((res.statusCode ?? 500) >= 400) throw new Error('agent rejected request'); resolve(value as T); }
          catch { reject(new ServiceUnavailableException('Agent de santé indisponible')); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', () => reject(new ServiceUnavailableException('Agent de santé indisponible')));
      req.end();
    });
  }
}
