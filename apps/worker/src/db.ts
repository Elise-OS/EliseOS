import { EliseAiClient } from '@elise/ai-client';
import pg from 'pg';

const { Pool } = pg;
pg.types.setTypeParser(1114, (value) => new Date(`${value.replace(' ', 'T')}Z`));
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: '-c timezone=UTC',
});
export const ai = new EliseAiClient(
  process.env.AI_BASE_URL ?? 'http://ai:8000',
  process.env.AI_SHARED_SECRET ?? 'development-secret-change-me',
);

export interface OutboxRow {
  id: string;
  homeId: string;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export type AlertType =
  | 'INACTIVITY'
  | 'DOOR_OPEN'
  | 'SOS'
  | 'UNUSUAL_ACTIVITY'
  | 'TEMPERATURE'
  | 'SENSOR_OFFLINE'
  | 'LOW_BATTERY'
  | 'MEDICATION_MISSED'
  | 'SYSTEM';

export type AlertSeverity = 'INFO' | 'ATTENTION' | 'URGENT';

export interface AlertCandidate {
  homeId: string;
  roomId?: string | null;
  ruleKey: string;
  type: AlertType;
  severity: AlertSeverity;
  active: boolean;
  title: string;
  explanation: string;
}
