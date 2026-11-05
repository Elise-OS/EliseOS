import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';

export interface EliseMqttOptions {
  url: string;
  clientId: string;
  username?: string;
  password?: string;
}

export function connectEliseMqtt(options: EliseMqttOptions): MqttClient {
  const clientOptions: IClientOptions = {
    clientId: options.clientId,
    clean: false,
    reconnectPeriod: 2_000,
    connectTimeout: 10_000,
  };
  if (options.username !== undefined) clientOptions.username = options.username;
  if (options.password !== undefined) clientOptions.password = options.password;
  return mqtt.connect(options.url, clientOptions);
}
