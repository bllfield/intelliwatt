import { prisma } from '@/lib/db';

export type OpenAIUsageLogParams = {
  module: string;
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  requestId?: string | null;
  userId?: string | null;
  houseId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Best-effort logger for OpenAI usage.
 *
 * This should never throw; failures are logged and swallowed so primary
 * customer flows are not impacted by observability issues.
 */
export async function logOpenAIUsage(
  params: OpenAIUsageLogParams,
): Promise<void> {
  try {
    await prisma.openAIUsageEvent.create({
      data: {
        module: params.module.slice(0, 64),
        operation: params.operation.slice(0, 128),
        model: params.model.slice(0, 64),
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        totalTokens: params.totalTokens,
        costUsd: params.costUsd,
        requestId: params.requestId ? params.requestId.slice(0, 128) : null,
        userId: params.userId ? params.userId.slice(0, 64) : null,
        houseId: params.houseId ? params.houseId.slice(0, 64) : null,
        metadataJson: params.metadata ?? undefined,
      },
    });
  } catch (error) {
    // Logging must never break primary flows
    // eslint-disable-next-line no-console
    console.error('[openai-usage] Failed to log OpenAI usage', error);
  }
}


