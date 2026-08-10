import { z } from 'zod';

export const anomalyScoreSchema = z.object({
  home_id: z.string(),
  score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  is_anomaly: z.boolean(),
  model_version: z.string(),
  factors: z.array(
    z.object({ feature: z.string(), contribution: z.number(), message: z.string() }),
  ),
});

export type AnomalyScore = z.infer<typeof anomalyScoreSchema>;

export const modelTrainingResultSchema = z.object({
  home_id: z.string(),
  model_version: z.string(),
  samples: z.number().int().positive(),
  sha256: z.string().length(64),
  active: z.boolean(),
});

export type ModelTrainingResult = z.infer<typeof modelTrainingResultSchema>;

export class MichelAiClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly sharedSecret: string,
  ) {}

  public async score(input: Record<string, unknown>): Promise<AnomalyScore> {
    const response = await fetch(`${this.baseUrl}/v1/anomalies/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-michel-secret': this.sharedSecret },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`Michel AI returned ${response.status}`);
    return anomalyScoreSchema.parse(await response.json());
  }

  public async train(input: Record<string, unknown>): Promise<ModelTrainingResult> {
    const response = await fetch(`${this.baseUrl}/v1/models/train`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-michel-secret': this.sharedSecret },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`Michel AI training returned ${response.status}`);
    return modelTrainingResultSchema.parse(await response.json());
  }
}
