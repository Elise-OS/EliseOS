import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ZIGBEE_AGENT_UNAVAILABLE, ZigbeeAgentClient } from './zigbee-agent.client';

const idleInstall = {
  state: 'IDLE',
  step: null,
  steps: ['check', 'backup', 'configure', 'restart', 'verify'].map((id) => ({
    id,
    state: 'pending',
  })),
  progress: null,
  startedAt: null,
  finishedAt: null,
  target: null,
  networkMode: 'keep',
  errorCode: null,
  detail: null,
  rolledBack: false,
  backupId: null,
  coordinator: null,
};

const servers: http.Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  delete process.env.ELISE_ZIGBEE_AGENT_SOCKET;
});

async function agentReturning(handler: http.RequestListener) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'zigbee-agent-'));
  const socket = path.join(folder, 'agent.sock');
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  process.env.ELISE_ZIGBEE_AGENT_SOCKET = socket;
  return new ZigbeeAgentClient();
}

describe('ZigbeeAgentClient', () => {
  it('reads the installation progress through the agent socket and validates it', async () => {
    const seen: string[] = [];
    const client = await agentReturning((request, response) => {
      seen.push(`${request.method} ${request.url}`);
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(idleInstall));
    });
    await expect(client.installProgress()).resolves.toMatchObject({ state: 'IDLE' });
    expect(seen).toEqual(['GET /install']);
  });

  it('sends the installation as JSON to the fixed install path', async () => {
    let received = '';
    const client = await agentReturning((request, response) => {
      request.on('data', (chunk) => (received += String(chunk)));
      request.on('end', () => {
        response.end(JSON.stringify({ ...idleInstall, state: 'RUNNING' }));
      });
    });
    await client.install({ candidateId: 'a1b2c3d4e5f6', adapter: 'ember' });
    expect(JSON.parse(received)).toEqual({ candidateId: 'a1b2c3d4e5f6', adapter: 'ember' });
  });

  it('turns a refusal of the agent into a 400 and its failures into a 503', async () => {
    const refusing = await agentReturning((_request, response) => {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: 'Ce port série n’existe pas ou n’est pas branché.' }));
    });
    await expect(refusing.install({})).rejects.toBeInstanceOf(BadRequestException);
    const failing = await agentReturning((_request, response) => {
      response.statusCode = 503;
      response.end(JSON.stringify({ error: 'docker indisponible' }));
    });
    await expect(failing.status()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects an answer that does not match the contract', async () => {
    const client = await agentReturning((_request, response) => {
      response.end(JSON.stringify({ state: 'WHATEVER' }));
    });
    await expect(client.status()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('reports a missing agent with a recognisable message', async () => {
    process.env.ELISE_ZIGBEE_AGENT_SOCKET = '/nonexistent/agent.sock';
    await expect(new ZigbeeAgentClient().status()).rejects.toMatchObject({
      message: ZIGBEE_AGENT_UNAVAILABLE,
    });
  });
});
