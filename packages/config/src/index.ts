import { z } from 'zod';

export const coreEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  MQTT_URL: z.string().default('mqtt://localhost:1883'),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  AI_BASE_URL: z.url().default('http://localhost:8000'),
  AI_SHARED_SECRET: z.string().min(16),
  SESSION_SECRET: z.string().min(32),
});

export type CoreEnvironment = z.infer<typeof coreEnvironmentSchema>;
